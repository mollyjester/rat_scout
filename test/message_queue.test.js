/**
 * Tests for src/pkjs/message_queue.js (the watch message queue and the change filter).
 *
 * Run: node test/message_queue.test.js
 */

var MQ = require('../src/pkjs/message_queue');

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

/**
 * Queue with a fake sendAppMessage and fake timers.
 * @returns {Object} Harness: q, sends (each {dict, ok(), fail()}), advance(ms)
 */
function harness() {
    var h = { t: 0, timers: [], sends: [] };
    h.q = MQ.create({
        sendAppMessage: function(dict, onOk, onFail) { h.sends.push({ dict: dict, ok: onOk, fail: onFail }); },
        setTimeout: function(fn, ms) { h.timers.push({ fn: fn, at: h.t + ms, done: false }); return h.timers.length - 1; },
        clearTimeout: function(id) { if (h.timers[id]) h.timers[id].done = true; }
    });
    h.advance = function(ms) {
        h.t += ms;
        h.timers.forEach(function(tm) { if (!tm.done && tm.at <= h.t) { tm.done = true; tm.fn(); } });
    };
    return h;
}

console.log('message_queue.js tests\n');

console.log('one in flight, in order');
(function() {
    var h = harness();
    h.q.push({ a: 1 }, 'A');
    h.q.push({ b: 2 }, 'B');
    assert(h.sends.length === 1 && h.sends[0].dict.a === 1, 'only the first is sent');
    h.sends[0].ok();
    assert(h.sends.length === 2 && h.sends[1].dict.b === 2, 'the second after the first is acknowledged');
    var failedB = false;
    h.q.push({ c: 3 }, 'C');
    h.sends[1].fail();
    assert(h.sends.length === 3, 'a failure also moves on');
    var h2 = harness();
    h2.q.push({ x: 1 }, 'X', function() { failedB = true; });
    h2.sends[0].fail();
    assert(failedB, 'onFailure called on failure');
})();

console.log('\nno answer: timeout');
(function() {
    var h = harness();
    var timedOut = false;
    h.q.push({ a: 1 }, 'A', function() { timedOut = true; });
    h.q.push({ b: 2 }, 'B');
    h.advance(MQ.SEND_TIMEOUT_MS - 1);
    assert(h.sends.length === 1 && !timedOut, 'still waiting just before the timeout');
    h.advance(1);
    assert(timedOut && h.sends.length === 2, 'after ' + (MQ.SEND_TIMEOUT_MS / 1000) + ' s: counted as failed, next one sent');
    var called = 0;
    var h3 = harness();
    h3.q.push({ a: 1 }, 'A', function() { called++; });
    h3.q.push({ b: 2 }, 'B');
    h3.advance(MQ.SEND_TIMEOUT_MS);
    h3.sends[0].ok();
    h3.sends[0].fail();
    assert(called === 1 && h3.sends.length === 2, 'a late answer after the timeout is ignored');
    var h4 = harness();
    h4.q.push({ a: 1 }, 'A');
    h4.sends[0].ok();
    h4.advance(MQ.SEND_TIMEOUT_MS);
    assert(h4.timers.every(function(tm) { return tm.done; }), 'the timer is cleared on success');
})();

console.log('\nsendAppMessage throws');
(function() {
    var sent = [];
    var failedA = false;
    var q = MQ.create({
        sendAppMessage: function(dict, ok) { if (dict.bad) throw new Error('boom'); sent.push(dict); ok(); },
        setTimeout: function() { return 0; },
        clearTimeout: function() {}
    });
    q.push({ bad: true }, 'A', function() { failedA = true; });
    q.push({ good: true }, 'B');
    assert(failedA && sent.length === 1 && sent[0].good, 'counted as failed; the queue goes on');
})();

console.log('\nchange filter');
(function() {
    var f = MQ.createChangeFilter();
    assert(f.changed('weather', { t: '5' }), 'first: changed');
    assert(!f.changed('weather', { t: '5' }), 'same again: unchanged');
    assert(f.changed('astronomy', { t: '5' }), 'kinds are separate');
    assert(f.changed('weather', { t: '6' }), 'new value: changed');
    f.forget('weather');
    assert(f.changed('weather', { t: '6' }), 'after forget (failed send): sent again');
})();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
