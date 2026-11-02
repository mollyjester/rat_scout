/**
 * Tests for src/pkjs/glucose_plugin.js (the watchface's glucose source: the Rat Scout Glucose
 * plugin only).
 *
 * Run: node test/glucose_plugin.test.js
 */

var fs = require('fs');
var path = require('path');
var GP = require('../src/pkjs/glucose_plugin');
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

var MSG = 1;

var UUID = require('../plugin/package.json').pebble.uuid;
var LISTED = [{ uuid: UUID, name: 'Rat Scout', sources: [{ category: 'health', items: ['glucose'] }] }];

/**
 * Build a selector with mocks.
 * @param {Object} opts - {plugins, noApi, enumerateThrows, settings}
 * @returns {Object} Harness
 */
function harness(opts) {
    opts = opts || {};
    var h = {
        t: 1700000000000,
        sent: [],
        subs: [],
        timers: [],
        settings: opts.settings || { BG_UNITS: 'mg/dL', BG_SHOW_DELTA: true }
    };
    var pebble = {};
    if (!opts.noApi) {
        pebble.enumeratePlugins = function() {
            if (opts.enumerateThrows) throw new Error('boom');
            return opts.plugins === undefined ? LISTED : opts.plugins;
        };
        pebble.subscribeToSource = function(cfg) {
            var sub = { cfg: cfg, unsubscribed: false };
            sub.unsubscribe = function() { sub.unsubscribed = true; };
            h.subs.push(sub);
            return sub;
        };
    }
    h.pebble = pebble;
    h.gp = GP.create({
        Pebble: pebble,
        Glucose: Glucose,
        settings: function() { return h.settings; },
        msgType: MSG,
        send: function(d, type, onFailure) { h.sent.push(d); h.failNext = onFailure; },
        now: function() { return h.t; },
        setTimeout: function(fn, ms) { h.timers.push({ fn: fn, at: h.t + ms, done: false }); return h.timers.length - 1; },
        clearTimeout: function(id) { if (h.timers[id]) h.timers[id].done = true; }
    });
    h.advance = function(ms) {
        h.t += ms;
        h.timers.forEach(function(tm) { if (!tm.done && tm.at <= h.t) { tm.done = true; tm.fn(); } });
    };
    h.sub = function() { return h.subs[h.subs.length - 1]; };
    h.data = function(env) { h.sub().cfg.onData(env); };
    h.error = function(code) { h.sub().cfg.onError({ code: code, message: 'x' }); };
    return h;
}

function reading(mgdl, delta, ts) {
    var p = {
        name: { shortText: { text: 'Dexcom' } },
        glucose_mgdl: { numericValue: { value: mgdl, unit: 'mg/dL' } },
        reading_time: { timestamp: { value: ts || 1700000000 } }
    };
    if (delta !== null && delta !== undefined) p.delta_mgdl = { numericValue: { value: delta, unit: 'mg/dL' } };
    return { pluginUuid: UUID, instances: [{ instanceId: 'dexcom', properties: p }] };
}

function directDict(mgdl, delta, ts, settings) {
    return Glucose.buildGlucoseDictionary({
        current: { _value: mgdl, _delta: delta, _datetime: new Date((ts || 1700000000) * 1000) }
    }, settings, MSG);
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

console.log('glucose_plugin.js tests\n');

// 1. Detection
console.log('detection');
(function() {
    var cases = [
        ['no plugin API', { noApi: true }],
        ['empty plugin list (not installed, or preview off)', { plugins: [] }],
        ['enumeratePlugins throws', { enumerateThrows: true }],
        ['plugin uuid without the source', { plugins: [{ uuid: UUID, sources: [{ category: 'health', items: ['steps'] }] }] }],
        ['another plugin serving health/glucose', { plugins: [{ uuid: 'other', sources: [{ category: 'health', items: ['glucose'] }] }] }]
    ];
    cases.forEach(function(c) {
        var h = harness(c[1]);
        h.gp.start();
        assert(h.gp.mode() === 'unavailable' && h.subs.length === 0, c[0] + ' → unavailable, no subscription');
        assert(h.sent.length === 1 && h.sent[0].BG === '---' && h.sent[0].TIMESTAMP === 0, c[0] + ' → "---" sent');
    });
    var h = harness();
    h.gp.start();
    assert(h.gp.mode() === 'pending' && h.sent.length === 0, 'available → pending, nothing sent yet');
    assert(h.sub().cfg.plugin === UUID, 'subscribes with plugin: PLUGIN_UUID');
    assert(h.sub().cfg.category === 'health' && h.sub().cfg.item === 'glucose', 'subscribes to health/glucose');
})();

// 2. Lossless output
console.log('\nlossless output');
(function() {
    var ok = true;
    ['mg/dL', 'mmol/L'].forEach(function(units) {
        for (var v = 40; v <= 400; v++) {
            var settings = { BG_UNITS: units, BG_SHOW_DELTA: true, BG_SHOW_TIMEDELTA: false };
            var a = GP.envelopeToDictionary(reading(v, (v % 11) - 5), settings, Glucose, MSG);
            var b = directDict(v, (v % 11) - 5, 1700000000, settings);
            if (!same(a, b)) { ok = false; console.error('    mismatch ' + v + ' ' + units); }
        }
    });
    assert(ok, '40-400 mg/dL x both units: plugin dictionary equals buildGlucoseDictionary');
    var mg = GP.envelopeToDictionary(reading(120, 5), { BG_UNITS: 'mg/dL' }, Glucose, MSG);
    var mm = GP.envelopeToDictionary(reading(120, 5), { BG_UNITS: 'mmol/L' }, Glucose, MSG);
    assert(mg.BG === '120' && mm.BG === '6.7', '120 → "120" and "6.7"');
    assert(mg.BGDELTA === '+5', 'delta 5 → "+5"');
    var noDelta = GP.envelopeToDictionary(reading(120, null), { BG_UNITS: 'mg/dL' }, Glucose, MSG);
    assert(same(noDelta, directDict(120, null, 1700000000, { BG_UNITS: 'mg/dL' })), 'no delta_mgdl → same as direct with _delta = null');
    var empty = GP.envelopeToDictionary({ instances: [] }, {}, Glucose, MSG);
    assert(empty.BG === '---' && empty.TIMESTAMP === 0, 'empty instances → "---"');
    var busy = GP.envelopeToDictionary({ instances: [{ instanceId: 'dexcom', properties: {
        status: { shortText: { text: 'busy' } } } }] }, {}, Glucose, MSG);
    assert(busy === null, 'busy instance → send nothing');
})();

// 3. Gate
console.log('\ngate');
(function() {
    var h = harness();
    h.gp.start();
    h.data(reading(120, 5));
    h.data(reading(120, 5));
    assert(h.sent.length === 1 && h.gp.mode() === 'plugin', 'same envelope twice sends once; mode plugin');
    h.data(reading(125, 5, 1700000300));
    assert(h.sent.length === 2, 'new reading is sent');
    h.data({ instances: [] });
    h.data({ instances: [] });
    assert(h.sent.length === 3 && h.sent[2].BG === '---', 'empty instances send "---" once');
    h.data({ instances: [{ instanceId: 'dexcom', properties: { status: { shortText: { text: 'busy' } } } }] });
    assert(h.sent.length === 3, 'busy envelope sends nothing (display keeps its value)');

    var u = harness({ plugins: [] });
    u.gp.start();
    u.gp.start();
    assert(u.sent.length === 1, 'repeated "---" while unavailable is sent once');
})();

// 4. Errors
console.log('\nerrors');
(function() {
    ['PERMISSION_DENIED', 'PLUGIN_UNAVAILABLE'].forEach(function(code) {
        var h = harness();
        h.gp.start();
        h.data(reading(120, 5));
        h.error(code);
        assert(h.gp.mode() === 'unavailable' && h.sent[h.sent.length - 1].BG === '---', code + ' → unavailable, "---"');
        assert(!h.sub().unsubscribed, code + ' keeps the subscription');
        h.data(reading(125, 5, 1700000300));
        assert(h.gp.mode() === 'plugin' && h.sent[h.sent.length - 1].BG === '125', 'a later envelope returns to plugin');
    });

    var t = harness();
    t.gp.start();
    t.data(reading(120, 5));
    t.error('TIMEOUT');
    assert(t.gp.mode() === 'plugin' && t.sent.length === 1, 'one TIMEOUT in plugin mode keeps the reading on screen');
    t.error('TIMEOUT');
    assert(t.gp.mode() === 'unavailable' && t.sent[1].BG === '---', 'second consecutive error → unavailable');

    var p = harness();
    p.gp.start();
    p.error('TIMEOUT');
    assert(p.gp.mode() === 'unavailable', 'any error while pending → unavailable');

    var i = harness();
    i.gp.start();
    i.data(reading(120, 5));
    i.error('INVALID_REQUEST');
    assert(i.sub().unsubscribed && i.gp.mode() === 'unavailable', 'INVALID_REQUEST → unsubscribed, unavailable');

    var g = harness();
    g.gp.start();
    g.advance(GP.PLUGIN_GRACE_MS - 1);
    assert(g.gp.mode() === 'pending', 'still pending just before the grace period ends');
    g.advance(1);
    assert(g.gp.mode() === 'unavailable' && g.sent[0].BG === '---', 'grace expiry → unavailable, "---"');
    g.data(reading(120, 5));
    assert(g.gp.mode() === 'plugin', 'a late envelope still returns to plugin');
})();

// 4b. The phone closed the subscription (plugin retired)
console.log('\nsubscription closed by the phone');
(function() {
    var CLOSED = { code: 'UNKNOWN', message: 'Rat Scout Glucose was updated or removed; subscribe again' };
    // Plugin updated or reinstalled: still listed → subscribe again at once.
    var u = harness();
    u.gp.start();
    u.data(reading(120, 5));
    var first = u.sub();
    first.cfg.onError(CLOSED);
    assert(first.unsubscribed && u.subs.length === 2 && u.sub().cfg.plugin === UUID, 'still listed → old subscription dropped, subscribed again');
    assert(u.gp.mode() === 'pending' && u.sent.length === 1, 'pending, the last reading stays on screen');
    u.data(reading(125, 5, 1700000300));
    assert(u.gp.mode() === 'plugin' && u.sent.length === 2, 'new subscription delivers');

    // Preview turned off (or plugin removed): no longer listed → "---" now, re-check later.
    var opts = {};
    var p = harness(opts);
    p.gp.start();
    p.data(reading(120, 5));
    opts.plugins = [];
    p.sub().cfg.onError(CLOSED);
    assert(p.gp.mode() === 'unavailable' && p.sent[p.sent.length - 1].BG === '---', 'not listed → unavailable, "---" at once (not after the 11 min watchdog)');
    assert(p.subs.length === 1 && p.subs[0].unsubscribed, 'no new subscription');
    opts.plugins = LISTED;
    assert(p.gp.recheck() === true && p.gp.mode() === 'pending', 'preview back on → the re-check subscribes again');

    // An ordinary UNKNOWN is still a soft error.
    var s = harness();
    s.gp.start();
    s.data(reading(120, 5));
    s.sub().cfg.onError({ code: 'UNKNOWN', message: 'boom' });
    assert(s.gp.mode() === 'plugin' && s.subs.length === 1, 'other UNKNOWN errors: one is tolerated');
})();

// 5. Re-check while unavailable
console.log('\nre-check');
(function() {
    // The plugin installed, or the preview turned on, while the face runs.
    var opts = { plugins: [] };
    var h = harness(opts);
    h.gp.start();
    assert(h.gp.recheck() === false && h.subs.length === 0 && h.sent.length === 1, 'still missing → no subscription, no second "---"');
    opts.plugins = LISTED;
    assert(h.gp.recheck() === true && h.gp.mode() === 'pending' && h.sub().cfg.plugin === UUID, 'plugin appeared → subscribes');
    assert(h.gp.recheck() === false && h.subs.length === 1, 'recheck while pending does nothing');
    h.data(reading(120, 5));
    assert(h.gp.mode() === 'plugin' && h.sent[h.sent.length - 1].BG === '120', 'first envelope → plugin, sent');

    var f = harness();
    f.gp.start();
    f.error('PERMISSION_DENIED');
    assert(f.gp.recheck() === false && f.subs.length === 1, 'unavailable with a live subscription: recheck does nothing');

    var i = harness();
    i.gp.start();
    i.error('INVALID_REQUEST');
    assert(i.gp.recheck() === false && i.subs.length === 1, 'INVALID_REQUEST pins: no re-subscribe');
})();

// 6. Watchdog
console.log('\nwatchdog');
(function() {
    var h = harness();
    h.gp.start();
    h.data(reading(120, 5));
    h.gp.checkStall(h.t + 10 * 60 * 1000);
    assert(h.gp.mode() === 'plugin', 'no envelope for 10 min: still plugin');
    h.gp.checkStall(h.t + GP.STALL_MS + 1);
    assert(h.gp.mode() === 'unavailable' && h.sent[h.sent.length - 1].BG === '---', 'more than 11 min: unavailable, "---"');
    assert(!h.sub().unsubscribed, 'subscription kept');
    h.data(reading(125, 5, 1700000300));
    assert(h.gp.mode() === 'plugin', 'a later envelope returns to plugin');
    var p = harness();
    p.gp.start();
    p.gp.checkStall(p.t + GP.STALL_MS + 1);
    assert(p.gp.mode() === 'pending', 'watchdog does not act while pending');
})();

// 7. Settings saved
console.log('\nonSettingsChanged');
(function() {
    var h = harness();
    h.gp.start();
    h.data(reading(120, 5));
    var first = h.sub();
    h.gp.onSettingsChanged();
    assert(first.unsubscribed && h.subs.length === 2, 'resubscribes');
    h.data(reading(120, 5));
    assert(h.sent.length === 2, 'gate cleared: the same reading is sent again (new units/delta apply)');
})();

// 8. Overdue reading: resubscribe so the host reads now
console.log('\nrefreshIfOverdue');
(function() {
    var TS = 1700000000;
    var DUE = GP.READING_DUE_SEC;
    var GAP = GP.RESUBSCRIBE_MIN_MS;
    // Plugin mode, one reading at TS received at clock TS + 60 s.
    function live() {
        var h = harness();
        h.t = (TS + 60) * 1000;
        h.gp.start();
        h.data(reading(120, 5, TS));
        return h;
    }
    var h = live();
    h.t = (TS + DUE) * 1000;
    assert(!h.gp.refreshIfOverdue(h.t) && h.subs.length === 1, 'at ' + DUE + ' s: not overdue yet');
    h.t = (TS + DUE + 1) * 1000;
    var first = h.sub();
    assert(h.gp.refreshIfOverdue(h.t) && h.subs.length === 2, 'overdue, quiet: resubscribes');
    assert(first.unsubscribed && h.sub().cfg.plugin === UUID && h.sub().cfg.item === 'glucose', 'old one unsubscribed; new one pinned to the plugin');
    assert(h.gp.mode() === 'plugin' && h.sent.length === 1, 'mode kept, nothing sent');
    h.t += GAP - 1000;
    assert(!h.gp.refreshIfOverdue(h.t) && h.subs.length === 2, 'rate limit: not again within ' + (GAP / 1000) + ' s');
    h.t += 1000;
    assert(h.gp.refreshIfOverdue(h.t) && h.subs.length === 3, 'again after ' + (GAP / 1000) + ' s');
    h.data(reading(120, 5, TS));
    assert(h.sent.length === 1, 'the same reading again is skipped by the gate');
    h.t += GAP;
    h.data(reading(125, 5, TS + 300));
    assert(h.sent.length === 2 && h.sent[1].TIMESTAMP === TS + 300, 'the new reading is sent');
    assert(!h.gp.refreshIfOverdue(h.t + 1000), 'new reading: not overdue');
    h.t = (TS + 300 + DUE + 1) * 1000;
    assert(h.gp.refreshIfOverdue(h.t), 'overdue counts from the newest reading');

    var e = live();
    e.t = (TS + DUE + 30) * 1000;
    e.data(reading(120, 5, TS));
    e.t += GAP - 1000;
    assert(!e.gp.refreshIfOverdue(e.t), 'an envelope less than ' + (GAP / 1000) + ' s ago: no resubscribe');
    e.t += 1000;
    assert(e.gp.refreshIfOverdue(e.t), 'and ' + (GAP / 1000) + ' s after it: resubscribes');

    // Phone, 2026-11-02: a cached host answer at ts + 303 s held the 16:04 ping back a minute.
    var c0 = live();
    c0.t = (TS + 303) * 1000;
    c0.data(reading(120, 5, TS));
    c0.t = (TS + 355) * 1000;
    assert(c0.gp.refreshIfOverdue(c0.t), 'an envelope from before the plugin cache went stale does not hold it back');
    var c1 = live();
    c1.t = (TS + GP.PLUGIN_FRESH_SEC) * 1000;
    c1.data(reading(120, 5, TS));
    c1.t += GAP - 1000;
    assert(!c1.gp.refreshIfOverdue(c1.t), 'an envelope from when the plugin could have called Dexcom does');
    var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'plugin-src', 'main.js'), 'utf8');
    var m = /var READING_FRESH_SEC = (\d+);/.exec(src);
    assert(m && +m[1] === GP.PLUGIN_FRESH_SEC, 'PLUGIN_FRESH_SEC matches the plugin\'s READING_FRESH_SEC');

    var p = harness();
    p.gp.start();
    assert(!p.gp.refreshIfOverdue(p.t + 3600000) && p.subs.length === 1, 'pending: never');
    var u = harness({ plugins: [] });
    u.gp.start();
    assert(!u.gp.refreshIfOverdue(u.t + 3600000) && u.subs.length === 0, 'unavailable: never');
    var n = live();
    n.t = (TS + 600) * 1000;
    n.error('PLUGIN_UNAVAILABLE');
    assert(!n.gp.refreshIfOverdue(n.t + GAP) && n.subs.length === 1, 'unavailable with the subscription kept: never');
    var z = harness();
    z.gp.start();
    z.data({ instances: [] });
    assert(!z.gp.refreshIfOverdue(z.t + 3600000) && z.subs.length === 1, 'no reading yet ("---"): never');
    var b = harness();
    b.gp.start();
    b.data({ instances: [{ instanceId: 'dexcom', properties: { status: { shortText: { text: 'busy' } } } }] });
    assert(!b.gp.refreshIfOverdue(b.t + 3600000), 'only a busy answer so far: never');
    var i = live();
    i.error('INVALID_REQUEST');
    assert(!i.gp.refreshIfOverdue(i.t + 3600000) && i.subs.length === 1, 'after INVALID_REQUEST: never');

    // Settings saved resubscribes; the fetchAllData() that follows must not do it again.
    var s = live();
    s.t = (TS + 400) * 1000;
    s.gp.onSettingsChanged();
    assert(s.subs.length === 2 && !s.gp.refreshIfOverdue(s.t) && s.subs.length === 2, 'settings resubscribe counts for the rate limit');

    // Callbacks of the replaced subscription are ignored.
    var o = live();
    o.t = (TS + 400) * 1000;
    var old = o.sub();
    o.gp.refreshIfOverdue(o.t);
    old.cfg.onData(reading(130, 5, TS + 300));
    old.cfg.onError({ code: 'PERMISSION_DENIED', message: 'x' });
    assert(o.sent.length === 1 && o.gp.mode() === 'plugin', 'old subscription: data and errors ignored');
    o.data(reading(130, 5, TS + 300));
    assert(o.sent.length === 2, 'new subscription: data handled');

    // A host that answers inside subscribeToSource still reaches onData.
    var y = live();
    y.pebble.subscribeToSource = function(cfg) {
        cfg.onData(reading(140, 5, TS + 300));
        return { unsubscribe: function() {} };
    };
    y.gp.refreshIfOverdue((TS + 400) * 1000);
    assert(y.sent.length === 2 && y.sent[1].TIMESTAMP === TS + 300, 'synchronous answer on resubscribe is handled');

    // Resubscribing doesn't feed the stall watchdog.
    var w = live();
    var start = w.t;
    for (var k = 1; k <= 11; k++) {
        w.t = start + k * 60000;
        w.gp.checkStall(w.t);
        w.gp.refreshIfOverdue(w.t);
    }
    w.t = start + GP.STALL_MS + 1000;
    w.gp.checkStall(w.t);
    assert(w.gp.mode() === 'unavailable' && w.sent[w.sent.length - 1].BG === '---', 'no envelope for 11 min despite resubscribes: watchdog shows "---"');
    assert(!w.gp.refreshIfOverdue(w.t + GAP), 'and stops resubscribing once unavailable');

    // Errors on the new subscription follow the usual rules.
    var r = live();
    r.gp.refreshIfOverdue((TS + 400) * 1000);
    r.error('TIMEOUT');
    assert(r.gp.mode() === 'plugin', 'first soft error on the new subscription keeps the reading');
    r.error('TIMEOUT');
    assert(r.gp.mode() === 'unavailable', 'second one: unavailable');
    var c = live();
    c.gp.refreshIfOverdue((TS + 400) * 1000);
    c.sub().cfg.onError({ code: 'UNKNOWN', message: 'Rat Scout Glucose was updated or removed; subscribe again' });
    assert(c.subs.length === 3 && c.gp.mode() === 'pending', 'subscription closed on the new one: detects and subscribes again');

    var f = live();
    f.pebble.subscribeToSource = function() { throw new Error('gone'); };
    assert(!f.gp.refreshIfOverdue((TS + 400) * 1000) && f.gp.mode() === 'unavailable', 'resubscribe throws: unavailable, "---"');
})();

// 9. Recovery from unavailable with a kept subscription, synchronous first answer, pin reset
console.log('\nrecoverIfStuck, synchronous start, INVALID_REQUEST pin');
(function() {
    var R = GP.RECOVER_MIN_MS;
    var g = harness();
    g.gp.start();
    g.advance(GP.PLUGIN_GRACE_MS);
    assert(g.gp.mode() === 'unavailable' && !g.sub().unsubscribed, 'grace expired: unavailable, subscription kept');
    assert(!g.gp.recoverIfStuck(g.t + R - 1), 'not before ' + (R / 60000) + ' min');
    assert(g.gp.recoverIfStuck(g.t + R) && g.subs.length === 2 && g.subs[0].unsubscribed, 'then resubscribes');
    assert(g.gp.mode() === 'unavailable', 'stays unavailable until data');
    assert(!g.gp.recoverIfStuck(g.t + R + 1000), 'rate-limited after a resubscribe');
    assert(g.gp.recoverIfStuck(g.t + 2 * R), 'and again ' + (R / 60000) + ' min later');
    g.data(reading(120, 5));
    assert(g.gp.mode() === 'plugin', 'an envelope on the new subscription returns to plugin');

    var st = harness();
    st.gp.start();
    st.data(reading(120, 5));
    st.gp.checkStall(st.t + GP.STALL_MS + 1);
    assert(st.gp.recoverIfStuck(st.t + GP.STALL_MS + 1 + R), 'after the stall watchdog: resubscribes');

    var pu = harness();
    pu.gp.start();
    pu.error('PLUGIN_UNAVAILABLE');
    assert(pu.gp.recoverIfStuck(pu.t + R), 'PLUGIN_UNAVAILABLE: resubscribes');

    var pd = harness();
    pd.gp.start();
    pd.error('PERMISSION_DENIED');
    assert(!pd.gp.recoverIfStuck(pd.t + 10 * R) && pd.subs.length === 1, 'PERMISSION_DENIED: never (the host serves it once approved)');

    var none = harness({ plugins: [] });
    none.gp.start();
    assert(!none.gp.recoverIfStuck(none.t + 10 * R), 'no subscription: left to recheck()');
    var live = harness();
    live.gp.start();
    live.data(reading(120, 5));
    assert(!live.gp.recoverIfStuck(live.t + 10 * R), 'plugin mode: never');

    // A host that answers inside subscribeToSource on the first subscribe.
    var y = harness();
    y.pebble.subscribeToSource = function(cfg) {
        cfg.onData(reading(130, 5));
        return { unsubscribe: function() {} };
    };
    y.gp.start();
    assert(y.gp.mode() === 'plugin', 'synchronous first answer: plugin, not set back to pending');
    y.advance(GP.PLUGIN_GRACE_MS + 1);
    assert(y.gp.mode() === 'plugin' && y.sent.length === 1 && y.sent[0].BG !== '---', 'no grace timer: no "---" 30 s later');
    var ye = harness();
    ye.pebble.subscribeToSource = function(cfg) {
        cfg.onError({ code: 'PERMISSION_DENIED', message: 'waiting' });
        return { unsubscribe: function() {} };
    };
    ye.gp.start();
    assert(ye.gp.mode() === 'unavailable', 'synchronous first error: unavailable, not pending');

    // Saving settings lifts the INVALID_REQUEST pin.
    var p = harness();
    p.gp.start();
    p.error('INVALID_REQUEST');
    assert(!p.gp.recheck(), 'pinned: no re-check');
    p.gp.onSettingsChanged();
    assert(p.subs.length === 2 && p.gp.mode() === 'pending', 'settings saved: detects and subscribes again');
})();

// 10. A failed glucose send is retried
console.log('\nretryUnsent');
(function() {
    var h = harness();
    h.gp.start();
    h.data(reading(120, 5, 1700000000));
    assert(h.sent.length === 1 && typeof h.failNext === 'function', 'sent with a failure callback');
    h.failNext();
    h.data(reading(120, 5, 1700000000));
    assert(h.sent.length === 2, 'after a failure the same reading is not skipped as a duplicate');
    h.failNext();
    assert(h.gp.retryUnsent() && h.sent.length === 3 && h.sent[2].TIMESTAMP === 1700000000, 'the next watch ping resends it');
    assert(!h.gp.retryUnsent(), 'only once');
    h.data(reading(120, 5, 1700000000));
    assert(h.sent.length === 3, 'once delivered, a repeat is skipped again');

    var n = harness();
    n.gp.start();
    n.data(reading(120, 5, 1700000000));
    var failOld = n.failNext;
    n.data(reading(125, 5, 1700000300));
    failOld();
    assert(!n.gp.retryUnsent() && n.sent.length === 2, 'a failure of an older send is ignored once a newer one went out');
    n.failNext();
    n.data(reading(130, 5, 1700000600));
    assert(!n.gp.retryUnsent() && n.sent.length === 3, 'a newer reading replaces the pending retry');

    var d = harness({ plugins: [] });
    d.gp.start();
    d.failNext();
    assert(d.gp.retryUnsent() && d.sent.length === 2 && d.sent[1].BG === '---', '"---" is retried too');
})();

// 11. Hygiene
console.log('\nhygiene');
(function() {
    var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'pkjs', 'glucose_plugin.js'), 'utf8');
    assert(src.indexOf('sendAppMessage') === -1, 'no direct Pebble.sendAppMessage (uses the send queue)');
    assert(!/dexcom\.js|Dexcom\(/.test(src), 'no Dexcom access in the watchface');
})();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
