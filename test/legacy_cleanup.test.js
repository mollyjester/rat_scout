/**
 * Tests for src/pkjs/legacy_cleanup.js (Dexcom data left by watchface versions before the
 * Rat Scout Glucose plugin).
 *
 * Run: node test/legacy_cleanup.test.js
 */

var Cleanup = require('../src/pkjs/legacy_cleanup');

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

function storage(values) {
    var m = {};
    Object.keys(values).forEach(function(k) { m[k] = values[k]; });
    return {
        m: m,
        getItem: function(k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
        setItem: function(k, v) { m[k] = String(v); },
        removeItem: function(k) { delete m[k]; }
    };
}

console.log('legacy_cleanup.js tests\n');

(function() {
    var s = storage({
        'clay-settings': JSON.stringify({ DEX_LOGIN: 'u', DEX_PASSWORD: 'secret', DEX_REGION: 'ous', BG_UNITS: 'mmol/L' }),
        accountId: 'a', sessionId: 's', 'ratscout.auth.badcreds': '{}', cachedWeatherData: 'w'
    });
    assert(Cleanup.purgeLegacyDexcomData(s) === true, 'reports that credentials were removed');
    var clay = JSON.parse(s.m['clay-settings']);
    assert(!('DEX_LOGIN' in clay) && !('DEX_PASSWORD' in clay) && !('DEX_REGION' in clay), 'Dexcom fields removed from clay-settings');
    assert(clay.BG_UNITS === 'mmol/L', 'other settings kept');
    assert(JSON.stringify(s.m).indexOf('secret') === -1, 'password gone from storage');
    assert(s.m.accountId === undefined && s.m.sessionId === undefined && s.m['ratscout.auth.badcreds'] === undefined, 'session and guard keys removed');
    assert(s.m.cachedWeatherData === 'w', 'unrelated keys kept');
    assert(Cleanup.purgeLegacyDexcomData(s) === false, 'second run: nothing to remove');
})();

(function() {
    assert(Cleanup.purgeLegacyDexcomData(storage({})) === false, 'no clay-settings: no-op');
    var bad = storage({ 'clay-settings': '{not json' });
    var origError = console.error;
    console.error = function() {};
    var r = Cleanup.purgeLegacyDexcomData(bad);
    console.error = origError;
    assert(r === false && bad.m['clay-settings'] === '{not json', 'corrupt clay-settings left alone');
})();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
