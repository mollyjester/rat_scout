/**
 * Tests for src/pkjs/astronomy.js pure functions.
 *
 * Run: node test/astronomy.test.js
 */

var astronomy = require('../src/pkjs/astronomy');
var timeToMinutes = astronomy.timeToMinutes;
var moonPhaseToIndex = astronomy.moonPhaseToIndex;
var buildAstronomyCache = astronomy.buildAstronomyCache;
var getTomorrowDateString = astronomy.getTomorrowDateString;
var determineTomorrowMoonEvent = astronomy.determineTomorrowMoonEvent;

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

console.log('astronomy.js tests\n');

// --- timeToMinutes ---
console.log('timeToMinutes');
assert(timeToMinutes('06:30') === 390, 'valid 06:30 → 390');
assert(timeToMinutes('00:00') === 0, 'valid 00:00 → 0');
assert(timeToMinutes('23:59') === 1439, 'valid 23:59 → 1439');
assert(timeToMinutes('N/A') === null, 'N/A → null');
assert(timeToMinutes(null) === null, 'null → null');
assert(timeToMinutes('') === null, 'empty string → null');
assert(timeToMinutes('abc') === null, 'malformed → null');
assert(timeToMinutes('12') === null, 'missing colon → null');
assert(timeToMinutes('aa:bb') === null, 'non-numeric parts → null');

// --- moonPhaseToIndex ---
console.log('\nmoonPhaseToIndex');
assert(moonPhaseToIndex('New Moon') === 0, 'New Moon → 0');
assert(moonPhaseToIndex('Waxing Crescent') === 1, 'Waxing Crescent → 1');
assert(moonPhaseToIndex('First Quarter') === 2, 'First Quarter → 2');
assert(moonPhaseToIndex('Waxing Gibbous') === 3, 'Waxing Gibbous → 3');
assert(moonPhaseToIndex('Full Moon') === 4, 'Full Moon → 4');
assert(moonPhaseToIndex('Waning Gibbous') === 5, 'Waning Gibbous → 5');
assert(moonPhaseToIndex('Third Quarter') === 6, 'Third Quarter → 6');
assert(moonPhaseToIndex('Last Quarter') === 6, 'Last Quarter → 6');
assert(moonPhaseToIndex('Waning Crescent') === 7, 'Waning Crescent → 7');
assert(moonPhaseToIndex('Unknown Phase') === 0, 'unknown → 0');
assert(moonPhaseToIndex(null) === 0, 'null → 0');
assert(moonPhaseToIndex('') === 0, 'empty string → 0');

// --- buildAstronomyCache ---
console.log('\nbuildAstronomyCache');
var astroData = {
    sunrise: '06:15',
    sunset: '20:30',
    moonrise: '22:00',
    moonset: '08:45',
    moonPhase: 'Full Moon'
};
var cache = buildAstronomyCache(astroData);
assert(cache.sunrise === '06:15', 'sunrise copied');
assert(cache.sunset === '20:30', 'sunset copied');
assert(cache.moonrise === '22:00', 'moonrise copied');
assert(cache.moonset === '08:45', 'moonset copied');
assert(cache.moonPhase === 'Full Moon', 'moonPhase copied');
assert(cache.tomorrowSunrise === null, 'tomorrowSunrise is null');
assert(cache.tomorrowMoonrise === null, 'tomorrowMoonrise is null');
assert(cache.tomorrowMoonset === null, 'tomorrowMoonset is null');

// --- getTomorrowDateString ---
console.log('\ngetTomorrowDateString');
var dateStr = getTomorrowDateString();
assert(/^\d{4}-\d{2}-\d{2}$/.test(dateStr), 'format is YYYY-MM-DD');
var tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
var expected = tomorrow.getFullYear() + '-' +
    String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' +
    String(tomorrow.getDate()).padStart(2, '0');
assert(dateStr === expected, 'date is tomorrow (' + expected + ')');

// --- determineTomorrowMoonEvent ---
console.log('\ndetermineTomorrowMoonEvent');
// Rise only (set is null)
var r1 = determineTomorrowMoonEvent('22:00', 'N/A');
assert(r1.needMoonrise === true && r1.needMoonset === false, 'rise-only → needMoonrise');

// Set only (rise is null)
var r2 = determineTomorrowMoonEvent('N/A', '08:00');
assert(r2.needMoonrise === false && r2.needMoonset === true, 'set-only → needMoonset');

// Normal order (rise before set): need tomorrow moonrise
var r3 = determineTomorrowMoonEvent('06:00', '18:00');
assert(r3.needMoonrise === true && r3.needMoonset === false, 'normal order → needMoonrise');

// Inverted order (set before rise): need tomorrow moonset
var r4 = determineTomorrowMoonEvent('18:00', '06:00');
assert(r4.needMoonrise === false && r4.needMoonset === true, 'inverted order → needMoonset');

// Both null
var r5 = determineTomorrowMoonEvent('N/A', 'N/A');
assert(r5.needMoonrise === false && r5.needMoonset === false, 'both null → neither needed');

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
