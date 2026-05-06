/**
 * Tests for src/pkjs/timeline.js
 *
 * Run: node test/timeline.test.js
 *
 * Browser APIs (XMLHttpRequest, Pebble, setTimeout) are stubbed below
 * so the module can be exercised in a plain Node.js environment.
 */

var passed = 0;
var failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log('  \u2713 ' + message);
    } else {
        failed++;
        console.error('  \u2717 ' + message);
    }
}

// ===== Minimal Browser API Stubs =====

// Pebble stub — getTimelineToken calls successCallback with the configured token,
// or failureCallback if _pebbleTokenError is set.
var _pebbleToken = null;
var _pebbleTokenError = null;
global.Pebble = {
    getTimelineToken: function(success, failure) {
        if (_pebbleTokenError) {
            failure(_pebbleTokenError);
        } else {
            success(_pebbleToken);
        }
    }
};

// Capture XHR calls for inspection rather than actually making HTTP requests
var _xhrCalls = [];
function FakeXHR() {
    this.headers = {};
    this.method = null;
    this.url = null;
    this.body = null;
    this.timeout = 0;
    this.onload = null;
    this.onerror = null;
    this.ontimeout = null;
    _xhrCalls.push(this);
}
FakeXHR.prototype.open = function(method, url) {
    this.method = method;
    this.url = url;
};
FakeXHR.prototype.setRequestHeader = function(key, val) {
    this.headers[key] = val;
};
FakeXHR.prototype.send = function(body) {
    this.body = body || null;
};
global.XMLHttpRequest = FakeXHR;

// setTimeout stub — records scheduled timers without running them
var _timers = [];
global.setTimeout = function(fn, ms) {
    _timers.push({ fn: fn, ms: ms });
};

// ===== Helpers =====

function resetXhr() { _xhrCalls = []; }
function resetTimers() { _timers = []; }

function resetAll() {
    resetXhr();
    resetTimers();
    _pebbleToken = null;
    _pebbleTokenError = null;
}

// ===== Load module after stubs are in place =====
var Timeline = require('../src/pkjs/timeline');

console.log('timeline.js tests\n');

// ===== pushQuickViewPin — getTimelineToken error =====
console.log('pushQuickViewPin (getTimelineToken failure)');

resetAll();
_pebbleTokenError = 'not logged in';
Timeline.pushQuickViewPin('test-pin', 'Title', 'Body', 60);
assert(_xhrCalls.length === 0, 'no XHR fired when getTimelineToken fails');

// ===== pushQuickViewPin — sends correct PUT request =====
console.log('\npushQuickViewPin (with token)');

resetAll();
_pebbleToken = 'mytoken';
Timeline.pushQuickViewPin('rsalert-bghigh', 'BG High Alert', 'BG: 210', 300);

assert(_xhrCalls.length === 1, 'one XHR created for the PUT');
var xhr = _xhrCalls[0];
assert(xhr.method === 'PUT', 'method is PUT');
assert(xhr.url === 'https://timeline-api.rebble.io/v1/user/pins/rsalert-bghigh',
    'URL contains encoded pin ID');
assert(xhr.headers['Content-Type'] === 'application/json', 'Content-Type header set');
assert(xhr.headers['X-User-Token'] === 'mytoken', 'X-User-Token header equals token from Pebble');
assert(typeof xhr.body === 'string', 'body is a string (serialised JSON)');

var pinBody = JSON.parse(xhr.body);
assert(pinBody.id === 'rsalert-bghigh', 'pin id in body');
assert(pinBody.layout.title === 'BG High Alert', 'pin title in body');
assert(pinBody.layout.body === 'BG: 210', 'pin body text');
assert(pinBody.layout.type === 'genericPin', 'layout type is genericPin');
assert(pinBody.duration === 300 / 60, 'duration converted to minutes');

// Simulating onload success should schedule a DELETE timer
assert(_timers.length === 0, 'no timer before onload fires');
xhr.status = 200;
xhr.onload();
assert(_timers.length === 1, 'DELETE timer scheduled after successful PUT');
assert(_timers[0].ms === 300 * 1000, 'DELETE timer fires after duration_s milliseconds');

// Running the timer should fire a DELETE XHR
_timers[0].fn();
assert(_xhrCalls.length === 2, 'DELETE XHR created when timer fires');
var deleteXhr = _xhrCalls[1];
assert(deleteXhr.method === 'DELETE', 'DELETE method');
assert(deleteXhr.headers['X-User-Token'] === 'mytoken', 'DELETE carries token');

// ===== pushQuickViewPin — default duration =====
console.log('\npushQuickViewPin (default duration)');

resetAll();
_pebbleToken = 'tok';
Timeline.pushQuickViewPin('rsalert-hourly', 'Hourly', 'Hourly reminder');  // no duration_s
var pinBody2 = JSON.parse(_xhrCalls[0].body);
assert(pinBody2.duration === 5, 'default duration is 300 s = 5 min');

// ===== pushQuickViewPin — pin ID is URL-encoded =====
console.log('\npushQuickViewPin (URL encoding)');

resetAll();
_pebbleToken = 'tok';
Timeline.pushQuickViewPin('pin with spaces', 'T', 'B', 60);
assert(_xhrCalls[0].url.indexOf('pin%20with%20spaces') !== -1 ||
       _xhrCalls[0].url.indexOf('pin+with+spaces') !== -1,
    'pin ID with spaces is properly URL-encoded');

// ===== pushQuickViewPin — failed PUT does not schedule timer =====
console.log('\npushQuickViewPin (PUT failure)');

resetAll();
_pebbleToken = 'tok';
Timeline.pushQuickViewPin('rsalert-bglow', 'Low', 'BG: 55', 120);
var failXhr = _xhrCalls[0];
failXhr.status = 500;
failXhr.onload();
assert(_timers.length === 0, 'no DELETE timer scheduled after failed PUT');

// ===== Summary =====
console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
