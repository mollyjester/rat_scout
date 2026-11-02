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
        send: function(d) { h.sent.push(d); },
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

// 8. Hygiene
console.log('\nhygiene');
(function() {
    var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'pkjs', 'glucose_plugin.js'), 'utf8');
    assert(src.indexOf('sendAppMessage') === -1, 'no direct Pebble.sendAppMessage (uses the send queue)');
    assert(!/dexcom\.js|Dexcom\(/.test(src), 'no Dexcom access in the watchface');
})();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
