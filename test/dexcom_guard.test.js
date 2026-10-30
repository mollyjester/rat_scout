/**
 * Tests for src/common/dexcom_guard.js, alone and as the plugin uses it.
 * Dexcom is always mocked: lockout behaviour is never tested against the
 * real service.
 *
 * Run: node test/dexcom_guard.test.js
 */

var Guard = require('../src/common/dexcom_guard');
var host = require('./helpers/plugin_host');

var s = host.suite('dexcom_guard tests');
var assert = s.assert;
var test = s.test;

var CREDS = { DEX_LOGIN: 'user', DEX_PASSWORD: 'pw', DEX_REGION: 'ous' };
var REQ = { category: 'health', item: 'glucose' };
var ZERO = '00000000-0000-0000-0000-000000000000';

function memStorage() {
    var m = {};
    return {
        m: m,
        getItem: function(k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
        setItem: function(k, v) { m[k] = String(v); },
        removeItem: function(k) { delete m[k]; }
    };
}

test('credKey', function() {
    var a = Guard.credKey(CREDS);
    assert(a === Guard.credKey({ DEX_LOGIN: 'user', DEX_PASSWORD: 'pw', DEX_REGION: 'ous' }), 'stable');
    assert(a !== Guard.credKey({ DEX_LOGIN: 'user', DEX_PASSWORD: 'pw2', DEX_REGION: 'ous' }), 'password changes it');
    assert(a !== Guard.credKey({ DEX_LOGIN: 'user', DEX_PASSWORD: 'pw', DEX_REGION: 'us' }), 'region changes it');
    assert(a.indexOf('pw') === -1 && /^[0-9a-f]+$/.test(a), 'hex, no plaintext');
});

test('isAuthRejection', function() {
    assert(Guard.isAuthRejection('Invalid credentials'), 'refused password (500 AccountPasswordInvalid or zero account GUID)');
    assert(Guard.isAuthRejection('Max authentication attempts exceeded'), 'Dexcom lockout answer');
    assert(Guard.isAuthRejection('Login failed'), 'zero session GUID');
    assert(!Guard.isAuthRejection('Error fetching account ID: 500'), 'HTTP 500 at account step is transient');
    assert(!Guard.isAuthRejection('Error fetching session ID: 401'), 'HTTP 401 at session step is transient');
    assert(!Guard.isAuthRejection('Error fetching account ID: 0'), 'network failure (status 0) is not a rejection');
    assert(!Guard.isAuthRejection('Network error'), 'network error is not a rejection');
    assert(!Guard.isAuthRejection('Timeout'), 'timeout is not a rejection');
});

test('a fresh inflight lock blocks a second caller; expires after 45 s', function() {
    var st = memStorage();
    var t = 1000000;
    var clock = function() { return t; };
    var plugin = Guard.create(st, 'plugin', clock);
    var pkjs = Guard.create(st, 'pkjs', clock);
    var key = Guard.credKey(CREDS);
    assert(plugin.begin(key) === null, 'first caller takes the lock');
    assert(pkjs.begin(key) === 'inflight', 'second caller is blocked');
    t += Guard.INFLIGHT_TTL_MS - 1;
    assert(pkjs.blockReason(key) === 'inflight', 'still blocked at 45 s - 1 ms');
    t += 1;
    assert(pkjs.begin(key) === null, 'lock expired at 45 s');
});

test('lock released on success and on error; only by its owner', function() {
    var st = memStorage();
    var key = Guard.credKey(CREDS);
    var plugin = Guard.create(st, 'plugin');
    var pkjs = Guard.create(st, 'pkjs');
    plugin.begin(key);
    pkjs.end(key, 'Network error');
    assert(st.getItem(Guard.INFLIGHT_KEY) !== null, 'the other side cannot release it');
    plugin.end(key, null);
    assert(st.getItem(Guard.INFLIGHT_KEY) === null, 'released on success');
    assert(st.getItem(Guard.SESSION_CREDKEY_KEY) === key, 'success records the session\'s credentials');
    plugin.begin(key);
    plugin.end(key, 'Timeout');
    assert(st.getItem(Guard.INFLIGHT_KEY) === null, 'released on error');
    assert(st.getItem(Guard.BADCREDS_KEY) === null, 'a timeout sets no pause');
});

test('bad credentials pause for 15 minutes for that key only', function() {
    var st = memStorage();
    var t = 5000000;
    var g = Guard.create(st, 'plugin', function() { return t; });
    var key = Guard.credKey(CREDS);
    g.begin(key);
    g.end(key, 'Invalid credentials');
    assert(g.blockReason(key) === 'badcreds', 'paused');
    assert(g.blockReason(Guard.credKey({ DEX_LOGIN: 'user', DEX_PASSWORD: 'new' })) === null, 'other credentials not paused');
    t += Guard.BADCREDS_PAUSE_MS - 1;
    assert(g.blockReason(key) === 'badcreds', 'still paused at 15 min - 1 ms');
    t += 1;
    assert(g.blockReason(key) === null, 'pause over at 15 min');
});

test('Dexcom lockout answer pauses for LOCKOUT_PAUSE_MS', function() {
    var st = memStorage();
    var t = 5000000;
    var g = Guard.create(st, 'plugin', function() { return t; });
    var key = Guard.credKey(CREDS);
    g.begin(key);
    g.end(key, 'Max authentication attempts exceeded');
    assert(Guard.LOCKOUT_PAUSE_MS === 60 * 60 * 1000, 'one hour');
    t += Guard.LOCKOUT_PAUSE_MS - 1;
    assert(g.blockReason(key) === 'badcreds', 'still paused at 1 h - 1 ms');
    t += 1;
    assert(g.blockReason(key) === null, 'pause over at 1 h');
});

test('sessionUsable', function() {
    var st = memStorage();
    var g = Guard.create(st, 'pkjs');
    assert(g.sessionUsable('abc'), 'no recorded key: trusted (session written by direct-mode PKJS)');
    st.setItem(Guard.SESSION_CREDKEY_KEY, 'abc');
    assert(g.sessionUsable('abc') && !g.sessionUsable('def'), 'recorded key must match');
});

test('plugin: after a rejected login (zero GUID), no auth fetch for 15 minutes', function() {
    var f = host.fakeDexcom({ accountId: ZERO });
    var t0 = 1700000100000;
    var h = host.load({ fetch: f, now: t0, storage: { 'clay-settings': JSON.stringify(CREDS) } });
    return h.request(REQ).then(function(r) {
        assert(f.endpoints().join(',') === 'account', 'one login attempt');
        assert(r.data.instances.length === 0, 'empty instances');
        assert(h.store['ratscout.auth.inflight'] === undefined, 'lock released');
        var polls = [];
        for (var i = 1; i <= 14; i++) polls.push(i);
        return polls.reduce(function(p, i) {
            return p.then(function() { h.setNow(t0 + i * 60000); return h.request(REQ); });
        }, Promise.resolve());
    }).then(function() {
        assert(f.calls.length === 1, '14 more polls over 14 minutes make no Dexcom call');
        h.setNow(t0 + Guard.BADCREDS_PAUSE_MS + 1000);
        return h.request(REQ);
    }).then(function() {
        assert(f.calls.length === 2, 'one new attempt after the pause');
    });
});

test('plugin: changing the password re-authenticates at once', function() {
    var f = host.fakeDexcom({ accountId: ZERO });
    var t0 = 1700000100000;
    var h = host.load({ fetch: f, now: t0, storage: { 'clay-settings': JSON.stringify(CREDS) } });
    return h.request(REQ).then(function() {
        h.setNow(t0 + 60000);
        h.store['clay-settings'] = JSON.stringify({ DEX_LOGIN: 'user', DEX_PASSWORD: 'fixed', DEX_REGION: 'ous' });
        return h.request(REQ);
    }).then(function() {
        assert(f.endpoints().join(',') === 'account,account', 'new credentials try again immediately');
    });
});

test('plugin: lastAttempt throttles Dexcom calls to one per 55 s', function() {
    var f = host.fakeDexcom({ fail: { readings: true } });
    var t0 = 1700000100000;
    var h = host.load({ fetch: f, now: t0, storage: { 'clay-settings': JSON.stringify(CREDS), accountId: 'a', sessionId: 's' } });
    return h.request(REQ).then(function() {
        assert(f.calls.length === 1, 'first poll calls Dexcom');
        h.setNow(t0 + 30000);
        return h.request(REQ);
    }).then(function(r) {
        assert(f.calls.length === 1, 'a poll 30 s later is throttled');
        assert(r.data.instances.length === 1 && r.data.instances[0].properties.status.shortText.text === 'busy',
            'throttled with no cache answers busy');
        h.setNow(t0 + 55000);
        return h.request(REQ);
    }).then(function() {
        assert(f.calls.length > 1, 'a poll 55 s later calls Dexcom again');
    });
});

s.run();
