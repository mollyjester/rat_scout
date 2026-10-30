/**
 * Tests for src/pkjs/glucose.js
 *
 * Run: node test/glucose.test.js
 */

var Glucose = require('../src/pkjs/glucose');

var passed = 0;
var failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log('  ✓ ' + message);
    } else {
        failed++;
        console.error('  ✗ ' + message);
    }
}

console.log('glucose.js tests\n');

// --- Constants ---
console.log('constants');

assert(Glucose.MMOL_CONVERSION_FACTOR === 18.0182, 'MMOL_CONVERSION_FACTOR is 18.0182');
assert(Glucose.DEFAULT_BG_UNITS === 'mg/dL', 'DEFAULT_BG_UNITS is mg/dL');

// --- formatBGValue ---
console.log('\nformatBGValue');

assert(Glucose.formatBGValue(120, 'mg/dL') === '120', 'mg/dL returns string of integer');
assert(Glucose.formatBGValue(85, 'mg/dL') === '85', 'mg/dL low value');
assert(Glucose.formatBGValue(120, 'mmol/L') === (120 / 18.0182).toFixed(1), 'mmol/L converts correctly');
assert(Glucose.formatBGValue(0, 'mg/dL') === '0', 'zero mg/dL');
assert(Glucose.formatBGValue(180, 'mmol/L') === (180 / 18.0182).toFixed(1), 'mmol/L high value');

// --- formatBGDelta ---
console.log('\nformatBGDelta');

assert(Glucose.formatBGDelta(5, 'mg/dL') === '+5', 'positive delta mg/dL has + prefix');
assert(Glucose.formatBGDelta(-3, 'mg/dL') === '-3', 'negative delta mg/dL');
assert(Glucose.formatBGDelta(0, 'mg/dL') === '0', 'zero delta mg/dL has no prefix');
assert(Glucose.formatBGDelta(5, 'mmol/L') === '+' + (5 / 18.0182).toFixed(1), 'positive delta mmol/L');
assert(Glucose.formatBGDelta(-3, 'mmol/L') === ((-3) / 18.0182).toFixed(1), 'negative delta mmol/L');

// --- buildGlucoseDictionary ---
console.log('\nbuildGlucoseDictionary');

var mockResult = {
    current: {
        _datetime: new Date('2025-01-15T10:30:00Z'),
        _value: 120,
        _delta: 5,
        _json: { WT: 'test' }
    }
};

var settingsMgDl = {
    BG_UNITS: 'mg/dL',
    BG_SHOW_DELTA: true,
    BG_SHOW_TIMEDELTA: true
};

var dict = Glucose.buildGlucoseDictionary(mockResult, settingsMgDl, 1);
assert(dict.MSG_TYPE === 1, 'MSG_TYPE matches passed constant');
assert(dict.BG_UNITS === 'mg/dL', 'BG_UNITS from settings');
assert(dict.BG === '120', 'BG formatted as mg/dL');
assert(dict.BGDELTA === '+5', 'BGDELTA with positive sign');
assert(dict.BG_SHOW_DELTA === 1, 'BG_SHOW_DELTA truthy → 1');
assert(dict.BG_SHOW_TIMEDELTA === 1, 'BG_SHOW_TIMEDELTA truthy → 1');
assert(dict.TIMESTAMP === Math.floor(new Date('2025-01-15T10:30:00Z').getTime() / 1000), 'TIMESTAMP in seconds');

// Test with mmol/L
var settingsMmol = {
    BG_UNITS: 'mmol/L',
    BG_SHOW_DELTA: false,
    BG_SHOW_TIMEDELTA: false
};

var dictMmol = Glucose.buildGlucoseDictionary(mockResult, settingsMmol, 1);
assert(dictMmol.BG === (120 / 18.0182).toFixed(1), 'BG formatted as mmol/L');
assert(dictMmol.BG_SHOW_DELTA === 0, 'BG_SHOW_DELTA falsy → 0');
assert(dictMmol.BG_SHOW_TIMEDELTA === 0, 'BG_SHOW_TIMEDELTA falsy → 0');

// Test default BG_UNITS
var settingsNoUnits = {};
var dictDefault = Glucose.buildGlucoseDictionary(mockResult, settingsNoUnits, 1);
assert(dictDefault.BG_UNITS === 'mg/dL', 'defaults to mg/dL when no BG_UNITS');

// --- fetchGlucoseReading: optional guard argument ---
console.log('\nfetchGlucoseReading guard');

var DexcomGuard = require('../src/common/dexcom_guard');
var store = {};
global.window = { localStorage: {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
    removeItem: function(k) { delete store[k]; }
} };
var CFG = { STORAGE_KEYS: { ACCOUNT_ID: 'accountId', SESSION_ID: 'sessionId' } };
var CREDS = { DEX_LOGIN: 'u', DEX_PASSWORD: 'p', DEX_REGION: 'ous', BG_UNITS: 'mg/dL' };

/**
 * Fake Dexcom constructor: records instances; outcome 'ok' or an error string.
 */
function fakeDexcom(outcome, made) {
    return function(user, pass, onResults, region, onError) {
        var self = this;
        made.push(self);
        self.accountId = null;
        self.sessionId = null;
        self.getLatestGlucoseWithDelta = function() {
            self.startedWith = { accountId: self.accountId, sessionId: self.sessionId };
            if (outcome === 'ok') {
                self.accountId = self.accountId || 'acc-new';
                self.sessionId = self.sessionId || 'sess-new';
                onResults({ current: { _value: 120, _delta: 5, _datetime: new Date(1700000000000), _json: { WT: 'x' } } });
            } else {
                onError(outcome);
            }
        };
    };
}

function reset(values) {
    Object.keys(store).forEach(function(k) { delete store[k]; });
    Object.keys(values || {}).forEach(function(k) { store[k] = values[k]; });
}

(function() {
    reset({ accountId: 'a0', sessionId: 's0', 'ratscout.auth.sessionCredKey': 'not-these-creds' });
    var made = [];
    var sent = [];
    Glucose.fetchGlucoseReading(CREDS, CFG, function(d) { sent.push(d); }, function() {}, fakeDexcom('ok', made), 1);
    assert(made.length === 1 && made[0].startedWith.sessionId === 's0', 'guard undefined: cached session used as before (sessionCredKey ignored)');
    assert(sent.length === 1 && sent[0].BG === '120', 'guard undefined: reading sent');
    assert(store['ratscout.auth.inflight'] === undefined, 'guard undefined: no lock written');
})();

(function() {
    reset({ accountId: 'a0', sessionId: 's0' });
    var made = [];
    var g = DexcomGuard.create(window.localStorage, 'pkjs');
    Glucose.fetchGlucoseReading(CREDS, CFG, function() {}, function() {}, fakeDexcom('ok', made), 1, g);
    assert(made[0].startedWith.sessionId === 's0', 'guard: usable cached session skips the lock');
    assert(store['ratscout.auth.sessionCredKey'] === DexcomGuard.credKey(CREDS), 'guard: success records the session credKey');
})();

(function() {
    reset({ 'ratscout.auth.inflight': JSON.stringify({ owner: 'plugin', at: Date.now() }) });
    var made = [];
    var sent = [];
    var g = DexcomGuard.create(window.localStorage, 'pkjs');
    Glucose.fetchGlucoseReading(CREDS, CFG, function(d) { sent.push(d); }, function() {}, fakeDexcom('ok', made), 1, g);
    assert(made.length === 0, 'guard: login skipped while the plugin holds the lock');
    assert(sent.length === 0, 'guard: nothing sent, so the display keeps its value');
})();

(function() {
    reset({});
    var made = [];
    var sent = [];
    var g = DexcomGuard.create(window.localStorage, 'pkjs');
    Glucose.fetchGlucoseReading(CREDS, CFG, function(d) { sent.push(d); }, function() {}, fakeDexcom('Invalid credentials', made), 1, g);
    assert(made.length === 1 && made[0].startedWith.accountId === null, 'guard: logs in when no session');
    assert(store['ratscout.auth.inflight'] === undefined, 'guard: lock released on error');
    assert(store['ratscout.auth.badcreds'] !== undefined, 'guard: rejection pauses logins');
    assert(sent.length === 1 && sent[0].BG === '---', 'guard: "---" sent on failure as before');
    Glucose.fetchGlucoseReading(CREDS, CFG, function(d) { sent.push(d); }, function() {}, fakeDexcom('ok', made), 1, g);
    assert(made.length === 1, 'guard: no second login while paused');
})();

(function() {
    reset({ accountId: 'a0', sessionId: 's0', 'ratscout.auth.sessionCredKey': 'other' });
    var made = [];
    var g = DexcomGuard.create(window.localStorage, 'pkjs');
    Glucose.fetchGlucoseReading(CREDS, CFG, function() {}, function() {}, fakeDexcom('ok', made), 1, g);
    assert(made[0].startedWith.accountId === null, 'guard: session from other credentials is not reused');
})();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
