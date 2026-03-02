/**
 * Tests for src/pkjs/garbage.js
 *
 * Run: node test/garbage.test.js
 */

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

console.log('garbage.js tests\n');

// --- daysToBitmask ---
console.log('daysToBitmask');

assert(Garbage.daysToBitmask(null) === 0, 'null returns 0');
assert(Garbage.daysToBitmask(undefined) === 0, 'undefined returns 0');
assert(Garbage.daysToBitmask('not array') === 0, 'string returns 0');
assert(Garbage.daysToBitmask([]) === 0, 'empty array returns 0');
assert(Garbage.daysToBitmask([true]) === 1, '[true] → 1 (Monday)');
assert(Garbage.daysToBitmask([false, true]) === 2, '[false, true] → 2 (Tuesday)');
assert(Garbage.daysToBitmask([true, true, true, true, true, true, true]) === 127, 'all days → 127');
assert(Garbage.daysToBitmask([false, false, false, false, false, false, true]) === 64, 'Sunday only → 64');
assert(Garbage.daysToBitmask([true, false, true, false, true]) === 21, 'Mon/Wed/Fri → 21');

// --- Constants ---
console.log('\nconstants');

assert(Garbage.GARBAGE_BAG_NONE === 0, 'GARBAGE_BAG_NONE is 0');
assert(Garbage.GARBAGE_BAG_ORGANIC === 1, 'GARBAGE_BAG_ORGANIC is 1');
assert(Garbage.GARBAGE_BAG_GREY === 2, 'GARBAGE_BAG_GREY is 2');
assert(Garbage.GARBAGE_BAG_BLACK === 3, 'GARBAGE_BAG_BLACK is 3');

// --- computeGarbageBag ---
console.log('\ncomputeGarbageBag');

// Test with no pickup days configured → NONE
var settingsEmpty = {
    GARBAGE_PICKUP_TIME: '9',
    GARBAGE_ORGANIC_DAYS: [],
    GARBAGE_GREY_DAYS: [],
    GARBAGE_BLACK_DAYS: []
};
assert(Garbage.computeGarbageBag(settingsEmpty) === Garbage.GARBAGE_BAG_NONE, 'no days configured → NONE');

// Test default pickup hour when not a number
var settingsNaN = {
    GARBAGE_PICKUP_TIME: 'abc',
    GARBAGE_ORGANIC_DAYS: [true, true, true, true, true, true, true],
    GARBAGE_GREY_DAYS: [],
    GARBAGE_BLACK_DAYS: []
};
// With all days organic and default pickup hour 9, should return ORGANIC
// (the result depends on current time/day, but with all days set it must be ORGANIC)
var resultNaN = Garbage.computeGarbageBag(settingsNaN);
assert(resultNaN === Garbage.GARBAGE_BAG_ORGANIC, 'NaN pickup time defaults to 9, all organic days → ORGANIC');

// Test priority: organic > grey > black
var settingsAllDays = {
    GARBAGE_PICKUP_TIME: '9',
    GARBAGE_ORGANIC_DAYS: [true, true, true, true, true, true, true],
    GARBAGE_GREY_DAYS: [true, true, true, true, true, true, true],
    GARBAGE_BLACK_DAYS: [true, true, true, true, true, true, true]
};
assert(Garbage.computeGarbageBag(settingsAllDays) === Garbage.GARBAGE_BAG_ORGANIC, 'organic has priority over grey and black');

// Test grey when no organic
var settingsGreyOnly = {
    GARBAGE_PICKUP_TIME: '9',
    GARBAGE_ORGANIC_DAYS: [],
    GARBAGE_GREY_DAYS: [true, true, true, true, true, true, true],
    GARBAGE_BLACK_DAYS: [true, true, true, true, true, true, true]
};
assert(Garbage.computeGarbageBag(settingsGreyOnly) === Garbage.GARBAGE_BAG_GREY, 'grey has priority over black');

// Test black when no organic or grey
var settingsBlackOnly = {
    GARBAGE_PICKUP_TIME: '9',
    GARBAGE_ORGANIC_DAYS: [],
    GARBAGE_GREY_DAYS: [],
    GARBAGE_BLACK_DAYS: [true, true, true, true, true, true, true]
};
assert(Garbage.computeGarbageBag(settingsBlackOnly) === Garbage.GARBAGE_BAG_BLACK, 'black when no organic or grey');

// Test with undefined days arrays
var settingsUndefined = {
    GARBAGE_PICKUP_TIME: '9'
};
assert(Garbage.computeGarbageBag(settingsUndefined) === Garbage.GARBAGE_BAG_NONE, 'undefined day arrays → NONE');

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
