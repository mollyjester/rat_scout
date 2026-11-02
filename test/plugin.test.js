/**
 * Tests for the Rat Scout Glucose plugin bundle (plugin/plugin.js, built from src/plugin-src/).
 * The bundle runs in a vm context with mock fetch/localStorage/Pebble and no
 * setTimeout or XMLHttpRequest, as the plugin runtime documents.
 *
 * Run: node test/plugin.test.js
 */

var fs = require('fs');
var path = require('path');
var host = require('./helpers/plugin_host');
var Guard = require('../src/plugin-src/dexcom_guard');
var pkg = require('../plugin/package.json');
var facePkg = require('../package.json');
var Settings = require('../src/plugin-src/settings');
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
    return o;
}

function props(r) {
    return r.data.instances[0].properties;
}

test('registration', function() {
    var h = host.load();
    assert(typeof h.handlers.source === 'function', 'registerSourceHandler called with a function');
    // Under the simulated lockdown these are throwing getters; the bundle must leave them alone.
    ['XMLHttpRequest', 'setTimeout'].forEach(function(k) {
        var d = Object.getOwnPropertyDescriptor(h.context, k);
        assert(d && typeof d.get === 'function' && !('value' in d), 'bundle does not replace the global ' + k);
    });
});

test('no credentials: empty instances, no fetch', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f, settings: {} });
    return h.request(REQ).then(function(r) {
        assert(r.data && r.data.instances.length === 0, 'instances is empty');
        assert(r.data.validUntilMs === h.now() + 60000, 'validUntilMs is now + 60 s');
        assert(f.calls.length === 0, 'no fetch made');
    });
});

test('happy path (mg/dL): every shape, glucose_mgdl is the raw value', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f, settings: settings({ BG_UNITS: 'mg/dL' }) });
    return h.request(REQ).then(function(r) {
        var p = props(r);
        assert(f.endpoints().join(',') === 'account,session,readings', 'authenticates then reads');
        assert(r.data.instances[0].instanceId === 'dexcom', 'instanceId is dexcom');
        assert(p.glucose_mgdl.numericValue.value === 120, 'glucose_mgdl is 120');
        assert(p.glucose.shortText.text === '120', 'glucose shortText is "120"');
        assert(p.glucose.numericValue.value === 120 && p.glucose.numericValue.unit === 'mg/dL', 'glucose numericValue in mg/dL');
        assert(p.glucose.numericValue.min === 40 && p.glucose.numericValue.max === 400, 'mg/dL range 40-400');
        assert(p.glucose.longText.text === '120 mg/dL', 'glucose longText is the reading only (no trend)');
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
        assert(!Object.keys(hdr).some(function(k) { return k.toLowerCase() === 'user-agent'; }), 'no custom User-Agent (as pydexcom)');
    });
});

test('mmol/L: glucose 6.7 while glucose_mgdl stays 120', function() {
    var h = host.load({ settings: settings({ BG_UNITS: 'mmol/L' }) });
    return h.request(REQ).then(function(r) {
        var p = props(r);
        assert(p.glucose.shortText.text === '6.7', 'glucose shortText 6.7');
        assert(p.glucose.numericValue.value === 6.7 && p.glucose.numericValue.unit === 'mmol/L', 'numericValue 6.7 mmol/L');
        assert(p.glucose.numericValue.min === 2.2 && p.glucose.numericValue.max === 22.2, 'mmol range 2.2-22.2');
        assert(p.glucose_mgdl.numericValue.value === 120, 'glucose_mgdl still 120');
        assert(p.delta.shortText.text === '+0.3', 'delta +0.3 mmol/L');
    });
});

test('trend arrows follow pydexcom (None empty, RateOutOfRange "-")', function() {
    function run(trend) {
        var f = host.fakeDexcom({ readings: [{ WT: 'Date(1700000000000)', ST: '', DT: '', Value: 120, Trend: trend }] });
        var h = host.load({ fetch: f, settings: settings() });
        return h.request(REQ).then(function(r) { return props(r); });
    }
    return run('None').then(function(p) {
        assert(p.trend.shortText.text === '', 'None: empty arrow');
        assert(p.glucose.longText.text === '120 mg/dL', 'None: long text is the reading');
        return run('RateOutOfRange');
    }).then(function(p) {
        assert(p.trend.shortText.text === '-', 'RateOutOfRange: "-"');
        return run('NotComputable');
    }).then(function(p) {
        assert(p.trend.shortText.text === '?', 'NotComputable: "?"');
        return run('SomethingNew');
    }).then(function(p) {
        assert(p.trend.shortText.text === '?', 'unknown trend: "?"');
    });
});

test('single reading: no delta properties', function() {
    var f = host.fakeDexcom({ readings: [{ WT: 'Date(1700000000000)', Value: 99, Trend: 'SingleUp' }] });
    var h = host.load({ fetch: f, settings: settings() });
    return h.request(REQ).then(function(r) {
        var p = props(r);
        assert(p.delta === undefined && p.delta_mgdl === undefined, 'delta and delta_mgdl omitted');
        assert(p.trend.shortText.text === '↑', 'SingleUp arrow');
    });
});

test('cached session skips authentication', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f, settings: settings(), storage: { accountId: 'a0', sessionId: 's0' } });
    return h.request(REQ).then(function(r) {
        assert(f.endpoints().join(',') === 'readings', 'only the readings endpoint is called');
        assert(JSON.parse(f.calls[0].body).sessionId === 's0', 'uses the cached sessionId');
        assert(props(r).glucose_mgdl.numericValue.value === 120, 'returns the reading');
    });
});

test('fresh cache: no fetch, validUntilMs from the reading', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f, settings: settings() });
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
    var h = host.load({ settings: settings({ BG_UNITS: 'mg/dL' }) });
    return h.request(REQ).then(function() {
        h.setSettings(settings({ BG_UNITS: 'mmol/L' }));
        return h.request(REQ);
    }).then(function(r) {
        assert(props(r).glucose.shortText.text === '6.7', 'unit change applies to the cached reading');
    });
});

test('changed credentials refetch', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f, settings: settings() });
    return h.request(REQ).then(function() {
        f.calls.length = 0;
        h.setNow(h.now() + 60000);
        h.setSettings({ DEX_LOGIN: 'other', DEX_PASSWORD: 'pw', DEX_REGION: 'ous' });
        return h.request(REQ);
    }).then(function(r) {
        assert(f.endpoints().join(',') === 'account,session,readings', 'old cache and session ignored; re-authenticates');
        assert(r.data.instances.length === 1, 'returns the new reading');
    });
});

test('fetch TypeError on readings: empty instances, valid session kept', function() {
    var f = host.fakeDexcom({ fail: { readings: true } });
    var h = host.load({ fetch: f, settings: settings(), storage: { accountId: 'a0', sessionId: 's0' } });
    return h.request(REQ).then(function(r) {
        assert(r.data && r.data.instances.length === 0, 'instances is empty');
        assert(h.store.accountId === 'a0' && h.store.sessionId === 's0', 'session kept');
        assert(h.store['ratscout.auth.badcreds'] === undefined, 'no pause');
    });
});

test('no readings available: session kept, next poll reads without logging in', function() {
    // Seen on the phone: with the session dropped, every 60 s poll was a full login.
    var f = host.fakeDexcom({ readings: [] });
    var t0 = 1700000100000;
    var h = host.load({ fetch: f, now: t0, settings: settings() });
    return h.request(REQ).then(function(r) {
        assert(f.endpoints().join(',') === 'account,session,readings', 'first poll logs in and reads');
        assert(r.data.instances.length === 0, 'instances is empty');
        assert(h.store.sessionId === 'sess-1', 'session stored');
        h.setNow(t0 + 60000);
        return h.request(REQ);
    }).then(function() {
        assert(f.endpoints().join(',') === 'account,session,readings,readings', 'second poll only reads');
    });
});

test('login-step failure clears the session', function() {
    var f = host.fakeDexcom({ sessionResponse: { status: 503, body: 'x' } });
    var h = host.load({ fetch: f, settings: settings(), storage: { accountId: 'a0' } });
    return h.request(REQ).then(function() {
        assert(h.store.accountId === undefined && h.store.sessionId === undefined, 'session keys removed');
    });
});

// Wrong-password answer as recorded from Dexcom in pydexcom's test cassettes (HTTP 500).
var PASSWORD_INVALID = JSON.stringify({ Code: 'AccountPasswordInvalid', Message: 'Publisher account password failed' });

test('500 AccountPasswordInvalid at the account step pauses logins for 15 minutes', function() {
    var f = host.fakeDexcom({ accountResponse: { status: 500, body: PASSWORD_INVALID } });
    var t0 = 1700000100000;
    var h = host.load({ fetch: f, now: t0, settings: settings() });
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
    var h = host.load({ fetch: f, settings: settings() });
    return h.request(REQ).then(function() {
        assert(f.endpoints().join(',') === 'account,session', 'account then session');
        assert(h.store['ratscout.auth.badcreds'] !== undefined, 'logins paused');
    });
});

test('500 SSO_AuthenticateMaxAttemptsExceeded pauses logins for an hour', function() {
    var f = host.fakeDexcom({ accountResponse: { status: 500, body: JSON.stringify({ Code: 'SSO_AuthenticateMaxAttemptsExceeded', Message: 'x' }) } });
    var t0 = 1700000100000;
    var h = host.load({ fetch: f, now: t0, settings: settings() });
    return h.request(REQ).then(function() {
        var bad = JSON.parse(h.store['ratscout.auth.badcreds']);
        assert(bad.until === t0 + Guard.LOCKOUT_PAUSE_MS, 'paused for LOCKOUT_PAUSE_MS');
    });
});

test('other 500 at the account step is transient (no pause)', function() {
    var f = host.fakeDexcom({ accountResponse: { status: 500, body: '<html>bad gateway</html>' } });
    var h = host.load({ fetch: f, settings: settings() });
    return h.request(REQ).then(function(r) {
        assert(r.data && r.data.instances.length === 0, 'instances is empty');
        assert(h.store['ratscout.auth.badcreds'] === undefined, 'no pause');
    });
});

test('network failure at the account step still answers', function() {
    var f = host.fakeDexcom({ fail: { account: true } });
    var h = host.load({ fetch: f, settings: settings() });
    return h.request(REQ).then(function(r) {
        assert(r.data && r.data.instances.length === 0, 'instances is empty');
        assert(h.store['ratscout.auth.inflight'] === undefined, 'lock released');
        assert(h.store['ratscout.auth.badcreds'] === undefined, 'a network failure does not pause logins');
    });
});

test('500 SessionIdNotFound re-authenticates and succeeds', function() {
    var f = host.fakeDexcom({ readingsQueue: [{ status: 500, body: JSON.stringify({ Code: 'SessionIdNotFound', Message: 'x' }) }] });
    var h = host.load({ fetch: f, settings: settings(), storage: { accountId: 'a0', sessionId: 's0' } });
    return h.request(REQ).then(function(r) {
        assert(f.endpoints().join(',') === 'readings,session,readings', 'reads, renews the session, reads again');
        assert(props(r).glucose_mgdl.numericValue.value === 120, 'returns the reading');
        assert(h.store.sessionId === 'sess-1', 'stores the new session');
    });
});

test('second session error in one run: no further re-login (one retry, as pydexcom)', function() {
    var expired = { status: 500, body: JSON.stringify({ Code: 'SessionNotValid', Message: 'x' }) };
    var f = host.fakeDexcom({ readingsQueue: [expired, expired] });
    var h = host.load({ fetch: f, settings: settings(), storage: { accountId: 'a0', sessionId: 's0' } });
    return h.request(REQ).then(function(r) {
        assert(f.endpoints().join(',') === 'readings,session,readings', 'one re-login, then gives up');
        assert(r.data && r.data.instances.length === 0, 'instances is empty');
    });
});

test('wrong category or item: INVALID_REQUEST', function() {
    var h = host.load({ settings: settings() });
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
    var h = host.load({ fetch: f, now: now, settings: settings(), storage: {
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
    var key = require('../src/plugin-src/dexcom_guard').credKey(CREDS);
    var h = host.load({ fetch: f, now: now, settings: settings(), storage: {
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
    var h = host.load({ settings: settings() });
    var lockNow = h.now();
    var busy = host.load({ now: lockNow, settings: settings(), storage: {
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
    assert(pkg.pebble.projectType === 'plugin', 'plugin-only project');
    assert(pkg.pebble.uuid !== facePkg.pebble.uuid, 'own uuid, not the watchface\'s');
    assert(pl.script === 'plugin.js', 'plugin.script points at the bundle');
    assert(fs.existsSync(path.join(__dirname, '..', 'plugin', pl.script)), 'plugin.script exists');
    assert(fs.existsSync(path.join(__dirname, '..', 'plugin', pkg.pebble.configPage)), 'configPage exists');
    var perms = pkg.pebble.usesPermissions;
    assert(perms.length === 1 && perms[0].name === 'Internet' &&
        perms[0].parameters.domains.every(function(d) { return /\.dexcom\.(com|jp)$/.test(d); }),
        'plugin uses only Dexcom domains');
    assert(!facePkg.pebble.plugin, 'watchface carries no plugin');
    var faceGlucose = facePkg.pebble.usesPermissions.filter(function(p) { return p.name === 'Glucose'; });
    assert(faceGlucose.length === 1 && faceGlucose[0].plugin === pkg.pebble.uuid, 'watchface declares Glucose for the plugin uuid');
    assert(require('../src/pkjs/glucose_plugin').PLUGIN_UUID === pkg.pebble.uuid, 'watchface subscribes to the plugin uuid');
    var faceDomains = [];
    facePkg.pebble.usesPermissions.forEach(function(p) { if (p.parameters) faceDomains = faceDomains.concat(p.parameters.domains); });
    assert(!faceDomains.some(function(d) { return /dexcom/.test(d); }), 'watchface has no Dexcom domains');
    assert(pl.sources[0].category === 'health' && pl.sources[0].items[0] === 'glucose', 'serves health/glucose');
    assert(pl.definesPermissions[0].kind === 'read', 'Glucose permission kind is read');
    assert(/^[A-Za-z][A-Za-z0-9]*$/.test(pl.definesPermissions[0].name), 'permission name alphanumeric');
});

test('bundle registers under strict, function-wrapped evaluation (this undefined)', function() {
    // The phone answered "no source handler registered" for a bundle that read globals via `this`.
    var src = fs.readFileSync(host.BUNDLE, 'utf8');
    var handler = null;
    var Pebble = { registerSourceHandler: function(h) { handler = h; } };
    (new Function('Pebble', 'fetch', 'localStorage', '"use strict";\n' + src))
        .call(undefined, Pebble, function() { return Promise.reject(new TypeError('x')); }, { getItem: function() { return null; } });
    assert(typeof handler === 'function', 'source handler registered');
});

test('bundle registers under the Android lockdown (throwing setTimeout/XMLHttpRequest getters)', function() {
    // Pebble app 1.16.0.5: an unguarded `typeof setTimeout` threw during evaluation, the WebView
    // swallowed it, and every request answered "no source handler registered".
    var old = 'var x = typeof setTimeout === "function";\nPebble.registerSourceHandler(function () {});';
    var threw = false;
    try { host.load({ source: old }); } catch (e) { threw = /not available to plugins/.test(e.message); }
    assert(threw, 'the simulated lockdown throws on an unguarded typeof setTimeout');
    var h = host.load({ settings: settings() });
    assert(typeof h.handlers.source === 'function', 'real bundle registers its source handler');
});

test('frequent requests (face resubscribes on overdue pings): at most one Dexcom call per 55 s', function() {
    // The face resubscribes on watch pings while a reading is late, on top of the host's own
    // polls; each one runs the plugin. Dexcom has reading A until 340 s after it, then B
    // (300 s after A). Requests every 30 s from +50 s to +700 s.
    var T0 = 1700000000;
    var A = [{ WT: 'Date(' + (T0 * 1000) + ')', ST: '', DT: '', Value: 120, Trend: 'Flat' },
        { WT: 'Date(' + ((T0 - 300) * 1000) + ')', ST: '', DT: '', Value: 115, Trend: 'Flat' }];
    var B = [{ WT: 'Date(' + ((T0 + 300) * 1000) + ')', ST: '', DT: '', Value: 125, Trend: 'Flat' }].concat(A.slice(0, 1));
    var clock = (T0 + 50) * 1000;
    var fa = host.fakeDexcom({ readings: A });
    var fb = host.fakeDexcom({ readings: B });
    var calls = [];
    function fetch(url, o) {
        var f = clock < (T0 + 340) * 1000 ? fa : fb;
        var r = f(url, o);
        calls.push({ t: clock, ep: f.calls[f.calls.length - 1].ep });
        return r;
    }
    var h = host.load({ fetch: fetch, now: clock, settings: settings(), storage: { accountId: 'a0', sessionId: 's0' } });
    var seen = [];
    var chain = Promise.resolve();
    for (var t = T0 + 50; t <= T0 + 700; t += 30) {
        (function(at) {
            chain = chain.then(function() {
                clock = at * 1000;
                h.setNow(clock);
                return h.request(REQ);
            }).then(function(r) {
                seen.push({ t: at, ts: r.data.instances.length ? props(r).reading_time.timestamp.value : 0 });
            });
        })(t);
    }
    return chain.then(function() {
        var reads = calls.filter(function(c) { return c.ep === 'readings'; });
        assert(calls.every(function(c) { return c.ep === 'readings'; }), 'no logins: the session is reused');
        var minGap = Infinity;
        for (var i = 1; i < reads.length; i++) minGap = Math.min(minGap, reads[i].t - reads[i - 1].t);
        assert(minGap >= 55000, 'reading requests at least 55 s apart (closest ' + (minGap / 1000) + ' s)');
        assert(!reads.some(function(c) { return c.t > (T0 + 50) * 1000 && c.t < (T0 + 310) * 1000; }), 'no Dexcom call while A is fresh');
        assert(!reads.some(function(c) { return c.t > (T0 + 380) * 1000 && c.t < (T0 + 610) * 1000; }), 'no Dexcom call while B is fresh');
        var firstB = seen.filter(function(x) { return x.ts === T0 + 300; })[0];
        assert(firstB && firstB.t === T0 + 380, 'B served at the first unthrottled request after it appeared (+380 s)');
        var forB = reads.filter(function(c) { return c.t >= (T0 + 310) * 1000 && c.t <= (T0 + 380) * 1000; }).length;
        assert(forB === 2, 'two reading requests for B when Dexcom has it late (one too early, one that finds it)');
    });
});

test('settings page: load never returns the password', function() {
    var h = host.load({ settings: settings({ BG_UNITS: 'mmol/L' }) });
    return h.config({ type: 'load' }).then(function(r) {
        assert(r.login === 'user' && r.region === 'ous' && r.units === 'mmol/L', 'login, region, units');
        assert(r.hasPassword === true && !('password' in r) && JSON.stringify(r).indexOf('pw') === -1, 'only hasPassword');
    });
});

test('settings page: save stores the account, password in secureStorage, and refreshes', function() {
    var h = host.load({ storage: { accountId: 'a0', sessionId: 's0', 'ratscout.plugin.lastAttempt': '1' } });
    return h.config({ type: 'save', login: ' me@example.com ', password: 'secret', region: 'us', units: 'mmol/L' }).then(function(r) {
        assert(r.ok === true, 'ok');
        assert(h.store[Settings.LOGIN_KEY] === 'me@example.com', 'login trimmed, in localStorage');
        assert(h.secure[Settings.PASSWORD_KEY] === 'secret', 'password in secureStorage');
        assert(JSON.stringify(h.store).indexOf('secret') === -1, 'password not in localStorage');
        assert(h.store[Settings.REGION_KEY] === 'us' && h.store[Settings.UNITS_KEY] === 'mmol/L', 'region, units');
        assert(h.store.accountId === undefined && h.store.sessionId === undefined, 'old session dropped');
        assert(h.store['ratscout.plugin.lastAttempt'] === undefined, 'throttle reset');
        assert(h.refreshed.length === 1 && h.refreshed[0][0] === 'health/glucose', 'refreshSources(health/glucose)');
        return h.config({ type: 'save', login: 'me@example.com', password: '', region: 'nowhere', units: 'x' });
    }).then(function(r) {
        assert(r.ok === true && h.secure[Settings.PASSWORD_KEY] === 'secret', 'empty password keeps the stored one');
        assert(h.store[Settings.REGION_KEY] === 'ous' && h.store[Settings.UNITS_KEY] === 'mg/dL', 'bad values fall back');
        return h.config({ type: 'nope' });
    }).then(function(r) {
        assert(r.ok === false, 'unknown message type refused');
    });
});

test('settings page: a saved account is used by the next request', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f });
    return h.request(REQ).then(function(r) {
        assert(r.data.instances.length === 0 && f.calls.length === 0, 'no account: no Dexcom call');
        return h.config({ type: 'save', login: 'user', password: 'pw', region: 'ous', units: 'mg/dL' });
    }).then(function() {
        return h.request(REQ);
    }).then(function(r) {
        assert(f.endpoints().join(',') === 'account,session,readings', 'logs in with the saved account');
        assert(JSON.parse(f.calls[0].body).password === 'pw', 'password read from secureStorage');
        assert(props(r).glucose_mgdl.numericValue.value === 120, 'serves the reading');
    });
});

test('settings page: saving units or the same account keeps the session and throttle', function() {
    var h = host.load({ settings: settings(), storage: { accountId: 'a0', sessionId: 's0', 'ratscout.plugin.lastAttempt': '123' } });
    return h.config({ type: 'save', login: 'user', password: '', region: 'ous', units: 'mmol/L' }).then(function(r) {
        assert(r.ok && h.store.sessionId === 's0' && h.store['ratscout.plugin.lastAttempt'] === '123', 'units only: kept');
        return h.config({ type: 'save', login: 'user', password: 'pw', region: 'ous', units: 'mmol/L' });
    }).then(function() {
        assert(h.store.sessionId === 's0' && h.store['ratscout.plugin.lastAttempt'] === '123', 'same password typed again: kept');
        assert(h.refreshed.length === 2, 'subscribers refreshed each time');
        return h.config({ type: 'save', login: 'user', password: 'new', region: 'ous', units: 'mmol/L' });
    }).then(function() {
        assert(h.store.sessionId === undefined && h.store['ratscout.plugin.lastAttempt'] === undefined, 'new password: dropped, tried at once');
        assert(h.store['ratscout.settings.credVersion'] === '1', 'credential version bumped');
        return h.config({ type: 'save', login: 'other', password: '', region: 'ous', units: 'mmol/L' });
    }).then(function() {
        assert(h.store['ratscout.settings.credVersion'] === '1', 'a login change needs no version bump (login is in the key)');
    });
});

test('nothing derived from the password is stored', function() {
    var f = host.fakeDexcom();
    var h = host.load({ fetch: f, settings: settings({ DEX_PASSWORD: 'Secret-pw-123' }) });
    return h.request(REQ).then(function() {
        var all = JSON.stringify(h.store);
        var withPw = require('../src/plugin-src/dexcom_guard').credKey({ DEX_LOGIN: 'user', DEX_REGION: 'ous', DEX_CRED_VERSION: 'Secret-pw-123' });
        assert(all.indexOf('Secret-pw-123') === -1, 'no plaintext password in localStorage');
        assert(JSON.parse(h.store['ratscout.plugin.lastReading']).credKey === require('../src/plugin-src/dexcom_guard').credKey({ DEX_LOGIN: 'user', DEX_REGION: 'ous' }),
            'cache key is login|region|version');
        assert(all.indexOf(withPw) === -1, 'sanity: the key differs from one built with the password');
    });
});

test('secure storage that throws: the source request and the settings page still get an answer', function() {
    var h = host.load({ settings: settings() });
    h.context.Pebble.secureStorage.getItem = function() { throw new Error('keystore locked'); };
    h.context.Pebble.secureStorage.setItem = function() { throw new Error('keystore locked'); };
    return h.request(REQ).then(function(r) {
        assert(r.error === 'UNKNOWN' && /keystore locked/.test(r.message), 'source: UNKNOWN with the reason');
        return h.config({ type: 'load' });
    }).then(function(r) {
        assert(r.ok === false && /keystore locked/.test(r.error), 'page load: error reply');
        return h.config({ type: 'save', login: 'user', password: 'x', region: 'ous', units: 'mg/dL' });
    }).then(function(r) {
        assert(r.ok === false && /keystore locked/.test(r.error), 'page save: error reply');
    });
});

test('a Dexcom server error is logged by code, not by its free-text message', function() {
    var f = host.fakeDexcom({ readingsQueue: [{ status: 500, body: JSON.stringify({ Code: 'InvalidArgument', Message: 'user@example.com something' }) }] });
    var h = host.load({ fetch: f, settings: settings(), storage: { accountId: 'a0', sessionId: 's0' } });
    return h.request(REQ).then(function() {
        var logs = h.logs.join('\n');
        assert(/Server error: InvalidArgument/.test(logs), 'code logged');
        assert(logs.indexOf('user@example.com') === -1, 'message not logged');
    });
});

test('test runner: a test that never settles fails the suite', function() {
    var cp = require('child_process');
    var helper = JSON.stringify(path.join(__dirname, 'helpers', 'plugin_host.js'));
    var r = cp.spawnSync(process.execPath, ['-e',
        'var s = require(' + helper + ').suite("hang"); s.test("hangs", function() { return new Promise(function() {}); }); s.run();'],
        { encoding: 'utf8' });
    assert(r.status === 1, 'exit status 1 (got ' + r.status + ')');
    assert(/never finished: hangs/.test(r.stderr), 'names the test that never finished');
    var d = cp.spawnSync(process.execPath, ['-e',
        'var h = require(' + helper + '); var s = h.suite("twice"); s.test("double", function() {' +
        ' var p = h.load({ source: "Pebble.registerSourceHandler(function(q, r) { r.data({ instances: [] }); r.error(\'UNKNOWN\'); });" });' +
        ' return p.request({ category: "health", item: "glucose" }); }); s.run();'],
        { encoding: 'utf8' });
    assert(d.status === 1 && /answered twice/.test(d.stderr), 'a second respond fails the suite');
});

test('committed bundle equals build() output', function() {
    assert(fs.readFileSync(builder.OUT, 'utf8') === builder.build(), 'plugin/plugin.js is up to date');
});

s.run();
