/**
 * Tests for src/common/utils.js
 *
 * Run: node test/utils.test.js
 */

var utils = require('../src/common/utils');
var buildQueryString = utils.buildQueryString;

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

console.log('utils.js tests\n');

// Normal params
var qs = buildQueryString({ a: '1', b: '2' });
assert(qs === '?a=1&b=2', 'normal params produce ?a=1&b=2');

// Empty object
assert(buildQueryString({}) === '', 'empty object returns empty string');

// Null value is excluded
var qs2 = buildQueryString({ x: 'hello', y: null });
assert(qs2 === '?x=hello', 'null values are excluded');

// Undefined value is excluded
var qs3 = buildQueryString({ x: 'hello', y: undefined });
assert(qs3 === '?x=hello', 'undefined values are excluded');

// Special characters are encoded
var qs4 = buildQueryString({ q: 'hello world' });
assert(qs4 === '?q=hello%20world', 'spaces are encoded');

var qs5 = buildQueryString({ key: 'a&b=c' });
assert(qs5.indexOf('a%26b%3Dc') !== -1, 'ampersand and equals are encoded');

// Numeric values
var qs6 = buildQueryString({ lat: 51.5, lon: -0.1 });
assert(qs6 === '?lat=51.5&lon=-0.1', 'numeric values are stringified correctly');

// Zero is included (falsy but not null/undefined)
var qs7 = buildQueryString({ count: 0 });
assert(qs7 === '?count=0', 'zero value is included');

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
