/**
 * Tests for the plugin bundle (src/plugin/index.js, built from src/plugin-src/).
 * The bundle runs in a vm context with mock fetch/localStorage/Pebble and no
 * setTimeout or XMLHttpRequest, as the plugin runtime documents.
 *
 * Run: node test/plugin.test.js
 */

var fs = require('fs');
var path = require('path');
var host = require('./helpers/plugin_host');
var Guard = require('../src/common/dexcom_guard');
var pkg = require('../package.json');
var builder = require('../scripts/build-plugin');

var s = host.suite('plugin tests');
var assert = s.assert;
var test = s.test;

var CREDS = { DEX_LOGIN: 'user', DEX_PASSWORD: 'pw', DEX_REGION: 'ous' };
var REQ = { category: 'health', item: 'glucose' };

function settings(extra) {
    var o = {};
    Object.keys(CREDS).forEach(function(k) { o[k] = CREDS[k]; });
    Object.keys(extra || {}).forEach(function(k) { o[k] = extra[k]; });
    return JSON.stringify(o);
}

function props(r) {
    return r.data.instances[0].properties;
}

test('registration', function() {
    var h = host.load();
    assert(typeof h.handlers.source === 'function', 'registerSourceHandler called with a function');
    assert(typeof h.context.XMLHttpRequest === 'undefined', 'bundle does not install a global XMLHttpRequest');
    assert(typeof h.context.setTimeout === 'undefined', 'bundle does not install a global setTimeout');
});

test('no credentials: empty instances, no fetch', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f, storage: { 'clay-settings': '{}' } });
    return h.request(REQ).then(function(r) {
        assert(r.data && r.data.instances.length === 0, 'instances is empty');
        assert(r.data.validUntilMs === h.now() + 60000, 'validUntilMs is now + 60 s');
        assert(f.calls.length === 0, 'no fetch made');
    });
});

test('happy path (mg/dL): every shape, glucose_mgdl is the raw value', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f, storage: { 'clay-settings': settings({ BG_UNITS: 'mg/dL' }) } });
    return h.request(REQ).then(function(r) {
        var p = props(r);
        assert(f.endpoints().join(',') === 'account,session,readings', 'authenticates then reads');
        assert(r.data.instances[0].instanceId === 'dexcom', 'instanceId is dexcom');
        assert(p.glucose_mgdl.numericValue.value === 120, 'glucose_mgdl is 120');
        assert(p.glucose.shortText.text === '120', 'glucose shortText is "120"');
        assert(p.glucose.numericValue.value === 120 && p.glucose.numericValue.unit === 'mg/dL', 'glucose numericValue in mg/dL');
        assert(p.glucose.numericValue.min === 40 && p.glucose.numericValue.max === 400, 'mg/dL range 40-400');
        assert(p.glucose.longText.text === '120 mg/dL →', 'glucose longText');
        assert(p.delta.shortText.text === '+5' && p.delta.numericValue.value === 5, 'delta +5');
        assert(p.delta_mgdl.numericValue.value === 5, 'delta_mgdl 5');
        assert(p.trend.shortText.text === '→' && p.trend.longText.text === 'Steady', 'trend arrow + text');
        assert(p.trend_code.longText.text === 'Flat', 'trend_code is raw Dexcom Trend');
        assert(p.reading_time.timestamp.value === 1700000000, 'reading_time epoch seconds');
        assert(p.status.shortText.text === 'ok', 'status ok');
        assert(r.data.validUntilMs === (1700000000 + 310) * 1000, 'validUntilMs is reading + 310 s');
        assert(h.store.accountId === 'acc-1' && h.store.sessionId === 'sess-1', 'session cached in shared keys');
        var c = JSON.parse(h.store['ratscout.plugin.lastReading']);
        assert(c.value === 120 && c.delta === 5 && c.ts === 1700000000, 'reading cached raw');
        var hdr = f.calls[0].headers;
        assert(hdr['Content-Type'] === 'application/json', 'dexcom.js headers pass through the shim');
    });
});

test('mmol/L: glucose 6.7 while glucose_mgdl stays 120', function() {
    var h = host.load({ storage: { 'clay-settings': settings({ BG_UNITS: 'mmol/L' }) } });
    return h.request(REQ).then(function(r) {
        var p = props(r);
        assert(p.glucose.shortText.text === '6.7', 'glucose shortText 6.7');
        assert(p.glucose.numericValue.value === 6.7 && p.glucose.numericValue.unit === 'mmol/L', 'numericValue 6.7 mmol/L');
        assert(p.glucose.numericValue.min === 2.2 && p.glucose.numericValue.max === 22.2, 'mmol range 2.2-22.2');
        assert(p.glucose_mgdl.numericValue.value === 120, 'glucose_mgdl still 120');
        assert(p.delta.shortText.text === '+0.3', 'delta +0.3 mmol/L');
    });
});

test('single reading: no delta properties', function() {
    var f = host.fakeDexcom({ readings: [{ WT: 'Date(1700000000000)', Value: 99, Trend: 'SingleUp' }] });
    var h = host.load({ fetch: f, storage: { 'clay-settings': settings() } });
    return h.request(REQ).then(function(r) {
        var p = props(r);
        assert(p.delta === undefined && p.delta_mgdl === undefined, 'delta and delta_mgdl omitted');
        assert(p.trend.shortText.text === '↑', 'SingleUp arrow');
    });
});

test('cached session skips authentication', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f, storage: { 'clay-settings': settings(), accountId: 'a0', sessionId: 's0' } });
    return h.request(REQ).then(function(r) {
        assert(f.endpoints().join(',') === 'readings', 'only the readings endpoint is called');
        assert(JSON.parse(f.calls[0].body).sessionId === 's0', 'uses the cached sessionId');
        assert(props(r).glucose_mgdl.numericValue.value === 120, 'returns the reading');
    });
});

test('fresh cache: no fetch, validUntilMs from the reading', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f, storage: { 'clay-settings': settings() } });
    return h.request(REQ).then(function() {
        f.calls.length = 0;
        h.setNow(1700000200000);
        return h.request(REQ);
    }).then(function(r) {
        assert(f.calls.length === 0, 'no fetch while the reading is fresh');
        assert(props(r).glucose_mgdl.numericValue.value === 120, 'answers from cache');
        assert(r.data.validUntilMs === 1700000310000, 'validUntilMs = (ts + 310) * 1000');
    });
});

test('cache is formatted in the current units', function() {
    var h = host.load({ storage: { 'clay-settings': settings({ BG_UNITS: 'mg/dL' }) } });
    return h.request(REQ).then(function() {
        h.store['clay-settings'] = settings({ BG_UNITS: 'mmol/L' });
        return h.request(REQ);
    }).then(function(r) {
        assert(props(r).glucose.shortText.text === '6.7', 'unit change applies to the cached reading');
    });
});

test('changed credentials refetch', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f, storage: { 'clay-settings': settings() } });
    return h.request(REQ).then(function() {
        f.calls.length = 0;
        h.setNow(h.now() + 60000);
        h.store['clay-settings'] = JSON.stringify({ DEX_LOGIN: 'other', DEX_PASSWORD: 'pw', DEX_REGION: 'ous' });
        return h.request(REQ);
    }).then(function(r) {
        assert(f.endpoints().join(',') === 'account,session,readings', 'old cache and session ignored; re-authenticates');
        assert(r.data.instances.length === 1, 'returns the new reading');
    });
});

test('fetch TypeError on readings: empty instances, session keys cleared', function() {
    var f = host.fakeDexcom({ fail: { readings: true } });
    var h = host.load({ fetch: f, storage: { 'clay-settings': settings(), accountId: 'a0', sessionId: 's0' } });
    return h.request(REQ).then(function(r) {
        assert(r.data && r.data.instances.length === 0, 'instances is empty');
        assert(h.store.accountId === undefined && h.store.sessionId === undefined, 'session keys removed');
    });
});

// Wrong-password answer as recorded from Dexcom in pydexcom's test cassettes (HTTP 500).
var PASSWORD_INVALID = JSON.stringify({ Code: 'AccountPasswordInvalid', Message: 'Publisher account password failed' });

test('500 AccountPasswordInvalid at the account step pauses logins for 15 minutes', function() {
    var f = host.fakeDexcom({ accountResponse: { status: 500, body: PASSWORD_INVALID } });
    var t0 = 1700000100000;
    var h = host.load({ fetch: f, now: t0, storage: { 'clay-settings': settings() } });
    return h.request(REQ).then(function(r) {
        assert(f.endpoints().join(',') === 'account', 'one login attempt');
        assert(r.data && r.data.instances.length === 0, 'instances is empty');
        assert(h.store['ratscout.auth.badcreds'] !== undefined, 'logins paused');
        h.setNow(t0 + 5 * 60000);
        return h.request(REQ);
    }).then(function() {
        assert(f.calls.length === 1, 'no Dexcom call 5 minutes later');
    });
});

test('500 AccountPasswordInvalid at the session step pauses logins', function() {
    var f = host.fakeDexcom({ sessionResponse: { status: 500, body: PASSWORD_INVALID } });
    var h = host.load({ fetch: f, storage: { 'clay-settings': settings() } });
    return h.request(REQ).then(function() {
        assert(f.endpoints().join(',') === 'account,session', 'account then session');
        assert(h.store['ratscout.auth.badcreds'] !== undefined, 'logins paused');
    });
});

test('500 SSO_AuthenticateMaxAttemptsExceeded pauses logins for an hour', function() {
    var f = host.fakeDexcom({ accountResponse: { status: 500, body: JSON.stringify({ Code: 'SSO_AuthenticateMaxAttemptsExceeded', Message: 'x' }) } });
    var t0 = 1700000100000;
    var h = host.load({ fetch: f, now: t0, storage: { 'clay-settings': settings() } });
    return h.request(REQ).then(function() {
        var bad = JSON.parse(h.store['ratscout.auth.badcreds']);
        assert(bad.until === t0 + Guard.LOCKOUT_PAUSE_MS, 'paused for LOCKOUT_PAUSE_MS');
    });
});

test('other 500 at the account step is transient (no pause)', function() {
    var f = host.fakeDexcom({ accountResponse: { status: 500, body: '<html>bad gateway</html>' } });
    var h = host.load({ fetch: f, storage: { 'clay-settings': settings() } });
    return h.request(REQ).then(function(r) {
        assert(r.data && r.data.instances.length === 0, 'instances is empty');
        assert(h.store['ratscout.auth.badcreds'] === undefined, 'no pause');
    });
});

test('network failure at the account step still answers', function() {
    var f = host.fakeDexcom({ fail: { account: true } });
    var h = host.load({ fetch: f, storage: { 'clay-settings': settings() } });
    return h.request(REQ).then(function(r) {
        assert(r.data && r.data.instances.length === 0, 'instances is empty');
        assert(h.store['ratscout.auth.inflight'] === undefined, 'lock released');
        assert(h.store['ratscout.auth.badcreds'] === undefined, 'a network failure does not pause logins');
    });
});

test('500 SessionIdNotFound re-authenticates and succeeds', function() {
    var f = host.fakeDexcom({ readingsQueue: [{ status: 500, body: JSON.stringify({ Code: 'SessionIdNotFound', Message: 'x' }) }] });
    var h = host.load({ fetch: f, storage: { 'clay-settings': settings(), accountId: 'a0', sessionId: 's0' } });
    return h.request(REQ).then(function(r) {
        assert(f.endpoints().join(',') === 'readings,session,readings', 'reads, renews the session, reads again');
        assert(props(r).glucose_mgdl.numericValue.value === 120, 'returns the reading');
        assert(h.store.sessionId === 'sess-1', 'stores the new session');
    });
});

test('wrong category or item: INVALID_REQUEST', function() {
    var h = host.load({ storage: { 'clay-settings': settings() } });
    return h.request({ category: 'weather', item: 'location' }).then(function(r) {
        assert(r.error === 'INVALID_REQUEST', 'weather/location refused');
        return h.request({ category: 'health', item: 'steps' });
    }).then(function(r) {
        assert(r.error === 'INVALID_REQUEST', 'health/steps refused');
    });
});

test('lock held elsewhere, no cache: "busy" instance, no fetch', function() {
    var f = host.fakeDexcom();
    var now = 1700000100000;
    var h = host.load({ fetch: f, now: now, storage: {
        'clay-settings': settings(),
        'ratscout.auth.inflight': JSON.stringify({ owner: 'pkjs', at: now - 1000 })
    } });
    return h.request(REQ).then(function(r) {
        assert(f.calls.length === 0, 'no fetch');
        assert(r.data.instances.length === 1, 'one instance');
        assert(props(r).status.shortText.text === 'busy', 'status is busy');
        assert(props(r).glucose === undefined, 'no glucose property');
        assert(r.data.validUntilMs === now + 30000, 'validUntilMs is now + 30 s');
        assert(h.store['ratscout.auth.inflight'].indexOf('pkjs') !== -1, 'other side\'s lock untouched');
    });
});

test('lock held elsewhere, stale cache: answers the cached reading', function() {
    var f = host.fakeDexcom();
    var now = 1700000000000 + 400000;
    var key = require('../src/common/dexcom_guard').credKey(CREDS);
    var h = host.load({ fetch: f, now: now, storage: {
        'clay-settings': settings(),
        'ratscout.plugin.lastReading': JSON.stringify({ credKey: key, value: 101, delta: 2, trend: 'Flat', arrow: '→', ts: 1700000000 }),
        'ratscout.auth.inflight': JSON.stringify({ owner: 'pkjs', at: now - 1000 })
    } });
    return h.request(REQ).then(function(r) {
        assert(f.calls.length === 0, 'no fetch');
        assert(props(r).glucose_mgdl.numericValue.value === 101, 'cached reading served');
    });
});

test('every emitted property and shape is declared in package.json', function() {
    var declared = pkg.pebble.plugin.sources[0].properties;
    var h = host.load({ storage: { 'clay-settings': settings() } });
    var lockNow = h.now();
    var busy = host.load({ now: lockNow, storage: {
        'clay-settings': settings(),
        'ratscout.auth.inflight': JSON.stringify({ owner: 'pkjs', at: lockNow })
    } });
    return Promise.all([h.request(REQ), busy.request(REQ)]).then(function(rs) {
        var ok = true;
        var undeclared = [];
        rs.forEach(function(r) {
            var p = props(r);
            Object.keys(p).forEach(function(name) {
                Object.keys(p[name]).forEach(function(shape) {
                    if (!declared[name] || declared[name].indexOf(shape) === -1) {
                        ok = false;
                        undeclared.push(name + '.' + shape);
                    }
                });
            });
        });
        assert(ok, 'no undeclared shapes' + (undeclared.length ? ': ' + undeclared.join(', ') : ''));
    });
});

test('manifest', function() {
    var pl = pkg.pebble.plugin;
    assert(pl.script === 'src/plugin/index.js', 'plugin.script points at the bundle');
    assert(fs.existsSync(path.join(__dirname, '..', pl.script)), 'plugin.script exists');
    assert(pl.sources[0].category === 'health' && pl.sources[0].items[0] === 'glucose', 'serves health/glucose');
    assert(pl.definesPermissions[0].kind === 'read', 'Glucose permission kind is read');
    assert(/^[A-Za-z][A-Za-z0-9]*$/.test(pl.definesPermissions[0].name), 'permission name alphanumeric');
});

test('committed bundle equals build() output', function() {
    assert(fs.readFileSync(builder.OUT, 'utf8') === builder.build(), 'src/plugin/index.js is up to date');
});

s.run();
