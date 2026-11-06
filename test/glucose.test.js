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

// --- Failures: keep the last reading unless the login was refused or the account changed ---
console.log('\nfetchGlucoseReading failures');

(function() {
    function storage(init) {
        var data = {};
        Object.keys(init || {}).forEach(function(k) { data[k] = init[k]; });
        return {
            getItem: function(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
            setItem: function(k, v) { data[k] = String(v); },
            removeItem: function(k) { delete data[k]; }
        };
    }
    var CONFIG = { STORAGE_KEYS: { ACCOUNT_ID: 'accountId', SESSION_ID: 'sessionId' } };
    var settings = { DEX_LOGIN: 'user', DEX_PASSWORD: 'pw', DEX_REGION: 'ous', BG_UNITS: 'mg/dL' };
    var realLog = console.log;
    var realError = console.error;
    function quiet(fn) {
        console.log = function() {};
        console.error = function() {};
        try { fn(); } finally { console.log = realLog; console.error = realError; }
    }
    function run(error, init) {
        var sent = [];
        global.window = { localStorage: storage(init) };
        function FakeDexcom(login, password, onSuccess, region, onError) {
            this.getLatestGlucoseWithDelta = function() { onError(error); };
        }
        quiet(function() {
            Glucose.fetchGlucoseReading(settings, CONFIG, function(d, type) { sent.push({ d: d, type: type }); },
                function() {}, FakeDexcom, 1);
        });
        return sent;
    }
    var known = {};
    known[Glucose.LAST_ACCOUNT_KEY] = Glucose.accountFingerprint(settings);

    assert(run('Network error', known).length === 0, 'network error: nothing sent (the watch keeps its reading)');
    assert(run('Timeout', known).length === 0, 'timeout: nothing sent');
    assert(run('Error fetching account ID: 504', known).length === 0, 'server error at login: nothing sent');
    assert(run('Server error: Internal Server Error', known).length === 0, 'readings 500: nothing sent');
    assert(run('No readings available', known).length === 0, 'no recent readings: nothing sent (the watch ages its own)');
    var refused = run('Invalid credentials', known);
    assert(refused.length === 1 && refused[0].d.BG === '---' && refused[0].d.TIMESTAMP === 0, 'invalid credentials: "---"');
    assert(run('Login failed', known)[0].d.BG === '---', 'login failed: "---"');
    assert(run('Network error', {})[0].d.BG === '---', 'no reading from this account yet: "---"');
    var other = {};
    other[Glucose.LAST_ACCOUNT_KEY] = Glucose.accountFingerprint({ DEX_LOGIN: 'someone-else', DEX_REGION: 'ous' });
    assert(run('Network error', other)[0].d.BG === '---', 'account changed since the last reading: "---"');
    var region = {};
    region[Glucose.LAST_ACCOUNT_KEY] = Glucose.accountFingerprint({ DEX_LOGIN: 'user', DEX_REGION: 'us' });
    assert(run('Network error', region)[0].d.BG === '---', 'region changed: "---"');
    assert(Glucose.accountFingerprint(settings).indexOf('user') === -1, 'the fingerprint does not contain the login');

    var ok = storage();
    global.window = { localStorage: ok };
    function OkDexcom(login, password, onSuccess) {
        var self = this;
        this.getLatestGlucoseWithDelta = function() {
            self.accountId = 'a';
            self.sessionId = 's';
            onSuccess({ current: { _value: 120, _delta: 2, _datetime: new Date(1700000000000), _json: { WT: 'x' } } });
        };
    }
    quiet(function() { Glucose.fetchGlucoseReading(settings, CONFIG, function() {}, function() {}, OkDexcom, 1); });
    assert(ok.getItem(Glucose.LAST_ACCOUNT_KEY) === Glucose.accountFingerprint(settings), 'success records the account fingerprint');
    delete global.window;
})();

// --- Summary ---
console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
