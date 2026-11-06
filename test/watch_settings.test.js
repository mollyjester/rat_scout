/**
 * Tests for src/pkjs/watch_settings.js (settings dictionary, night window, garbage bag).
 *
 * Run: node test/watch_settings.test.js
 */

var WS = require('../src/pkjs/watch_settings');
var Garbage = require('../src/pkjs/garbage');

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

function at(hour, weekday) {
    // 2026-11-02 is a Monday; weekday 0 = Monday.
    return new Date(2026, 10, 2 + (weekday || 0), hour, 30, 0);
}

console.log('watch_settings.js tests\n');

var S = {
    BG_LOW_THRESHOLD: '70', BG_HIGH_THRESHOLD: '180',
    BG_NIGHT_LOW_THRESHOLD: '80', BG_NIGHT_HIGH_THRESHOLD: '250',
    BG_NIGHT_START: '22', BG_NIGHT_END: '7',
    GARBAGE_PICKUP_TIME: '9',
    GARBAGE_ORGANIC_DAYS: [true, false, false, false, false, false, false],
    GARBAGE_GREY_DAYS: [false, true, false, false, false, false, false]
};

console.log('night window');
assert(!WS.isNightWindow(S, at(21)), '21:30 is day');
assert(WS.isNightWindow(S, at(22)), '22:30 is night');
assert(WS.isNightWindow(S, at(6)), '06:30 is night (crosses midnight)');
assert(!WS.isNightWindow(S, at(7)), '07:30 is day');
assert(!WS.isNightWindow({ BG_NIGHT_START: '22', BG_NIGHT_END: '7' }, at(23)), 'no night thresholds: never night');
assert(WS.isNightWindow({ BG_NIGHT_START: '1', BG_NIGHT_END: '5', BG_NIGHT_HIGH_THRESHOLD: '200' }, at(3)), 'window within one day');

console.log('\nthresholds');
var day = WS.build(S, at(21), 0);
var night = WS.build(S, at(23), 0);
assert(day.BG_LOW_THRESHOLD === 700 && day.BG_HIGH_THRESHOLD === 1800, 'day thresholds x10');
assert(night.BG_LOW_THRESHOLD === 800 && night.BG_HIGH_THRESHOLD === 2500, 'night thresholds x10');
var onlyHigh = WS.build({ BG_LOW_THRESHOLD: '70', BG_NIGHT_HIGH_THRESHOLD: '250', BG_NIGHT_START: '22', BG_NIGHT_END: '7' }, at(23), 0);
assert(onlyHigh.BG_LOW_THRESHOLD === 700 && onlyHigh.BG_HIGH_THRESHOLD === 2500, 'night with only a high threshold keeps the day low');
assert(!('BG_UNITS' in day), 'no BG_UNITS (the watch never read it)');

console.log('\ntime-of-day part');
assert(WS.timedPart(day) !== WS.timedPart(night), 'differs between day and night');
assert(WS.timedPart(WS.build(S, at(12), 0)) === WS.timedPart(WS.build(S, at(13), 0)), 'same within the day');
var beforePickup = WS.build(S, at(8, 0), 0);
var afterPickup = WS.build(S, at(10, 0), 0);
assert(beforePickup.GARBAGE_BAG === Garbage.GARBAGE_BAG_ORGANIC, 'Monday 08:30: today\'s bag (organic)');
assert(afterPickup.GARBAGE_BAG === Garbage.GARBAGE_BAG_GREY, 'Monday 10:30: after pickup, tomorrow\'s bag (grey)');
assert(WS.timedPart(beforePickup) !== WS.timedPart(afterPickup), 'the pickup rollover changes it');

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
