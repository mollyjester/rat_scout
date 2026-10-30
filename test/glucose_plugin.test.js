/**
 * Tests for src/pkjs/glucose_plugin.js (glucose source selection).
 *
 * Run: node test/glucose_plugin.test.js
 */

var fs = require('fs');
var path = require('path');
var GP = require('../src/pkjs/glucose_plugin');
var Glucose = require('../src/pkjs/glucose');
var DexcomGuard = require('../src/common/dexcom_guard');
var pkg = require('../package.json');

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
var UUID = 'f41022a2-b149-42ac-a98d-2afbf84ca841';
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
        direct: 0,
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
    h.storage = { m: {}, getItem: function(k) { return this.m[k] === undefined ? null : this.m[k]; },
        setItem: function(k, v) { this.m[k] = String(v); }, removeItem: function(k) { delete this.m[k]; } };
    h.gp = GP.create({
        Pebble: pebble,
        Glucose: Glucose,
        DexcomGuard: DexcomGuard,
        storage: h.storage,
        settings: function() { return h.settings; },
        msgType: MSG,
        send: function(d) { h.sent.push(d); },
        fetchDirect: function() { h.direct++; },
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
        ['empty plugin list', { plugins: [] }],
        ['enumeratePlugins throws', { enumerateThrows: true }],
        ['our uuid without the source', { plugins: [{ uuid: UUID, sources: [{ category: 'health', items: ['steps'] }] }] }],
        ['another plugin serving health/glucose', { plugins: [{ uuid: 'other', sources: [{ category: 'health', items: ['glucose'] }] }] }]
    ];
    cases.forEach(function(c) {
        var h = harness(c[1]);
        h.gp.start();
        assert(h.gp.mode() === 'direct' && h.gp.shouldFetchDirect() && h.subs.length === 0, c[0] + ' → direct, no subscription');
    });
    var h = harness();
    h.gp.start();
    assert(h.gp.mode() === 'pending', 'available → pending');
    assert(h.sub().cfg.plugin === UUID, 'subscribes with plugin: OWN_UUID');
    assert(h.sub().cfg.category === 'health' && h.sub().cfg.item === 'glucose', 'subscribes to health/glucose');
    assert(!h.gp.shouldFetchDirect(), 'no direct fetch while pending');
    assert(h.gp.guardFor() === undefined, 'no guard while pending');
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

// 3. Plugin gate
console.log('\nplugin gate');
(function() {
    var h = harness();
    h.gp.start();
    h.data(reading(120, 5));
    h.data(reading(120, 5));
    assert(h.sent.length === 1, 'same envelope twice sends once');
    assert(h.gp.mode() === 'plugin', 'mode plugin');
    h.data(reading(125, 5, 1700000300));
    assert(h.sent.length === 2, 'new reading is sent');
    h.data({ instances: [] });
    h.data({ instances: [] });
    assert(h.sent.length === 3 && h.sent[2].BG === '---', 'empty instances send "---" once');

    var f = harness();
    f.gp.start();
    f.error('PERMISSION_DENIED');
    f.gp.recordingSend(function(d) { f.sent.push(d); })(directDict(130, 2, 1700000600, f.settings), 'BG');
    f.data(reading(130, 2, 1700000600));
    assert(f.sent.length === 1, 'after fallback, a plugin envelope equal to the last direct send is skipped');
    assert(f.gp.mode() === 'plugin', 'and the mode returns to plugin');
    f.data({ instances: [{ instanceId: 'dexcom', properties: { status: { shortText: { text: 'busy' } } } }] });
    assert(f.sent.length === 1, 'busy envelope sends nothing (display keeps its value)');
})();

// 4. The direct path is never suppressed
console.log('\ndirect path');
(function() {
    var h = harness({ plugins: [] });
    h.gp.start();
    var out = [];
    var send = h.gp.recordingSend(function(d) { out.push(d); });
    var d = directDict(120, 5, 1700000000, h.settings);
    send(d, 'BG');
    send(d, 'BG');
    assert(out.length === 2, 'same reading twice through recordingSend sends twice (catch-up flow)');
    h.gp.onSettingsChanged();
    send(d, 'BG');
    assert(out.length === 3, 'after settings change in direct mode the re-send goes out');
    send({ MSG_TYPE: 0, BG_UNITS: 'mg/dL' }, 'Settings');
    assert(out.length === 4, 'non-glucose messages pass through');
})();

// 5. Errors
console.log('\nerrors');
(function() {
    var h = harness();
    h.gp.start();
    h.error('PERMISSION_DENIED');
    assert(h.gp.mode() === 'fallback' && h.direct === 1, 'PERMISSION_DENIED → fallback + one direct fetch');
    assert(!h.sub().unsubscribed, 'subscription kept');
    h.error('PERMISSION_DENIED');
    assert(h.direct === 1, 'repeated error in fallback does not fetch again');
    h.data(reading(120, 5));
    assert(h.gp.mode() === 'plugin', 'good data → plugin');

    var u = harness();
    u.gp.start();
    u.data(reading(120, 5));
    u.error('PLUGIN_UNAVAILABLE');
    assert(u.gp.mode() === 'fallback', 'PLUGIN_UNAVAILABLE → fallback');

    var t = harness();
    t.gp.start();
    t.data(reading(120, 5));
    t.error('TIMEOUT');
    assert(t.gp.mode() === 'plugin', 'one TIMEOUT stays plugin');
    t.error('TIMEOUT');
    assert(t.gp.mode() === 'fallback' && t.direct === 1, 'second TIMEOUT → fallback');

    var p = harness();
    p.gp.start();
    p.error('TIMEOUT');
    assert(p.gp.mode() === 'fallback', 'TIMEOUT while pending → fallback');

    var i = harness();
    i.gp.start();
    i.data(reading(120, 5));
    i.error('INVALID_REQUEST');
    assert(i.sub().unsubscribed && i.gp.mode() === 'direct', 'INVALID_REQUEST → unsubscribed, direct');
    assert(i.direct === 1, 'and fetches directly');

    var g = harness();
    g.gp.start();
    g.advance(GP.PLUGIN_GRACE_MS - 1);
    assert(g.gp.mode() === 'pending', 'still pending just before grace expiry');
    g.advance(1);
    assert(g.gp.mode() === 'fallback' && g.direct === 1, 'grace expiry → fallback + a direct fetch');

    var q = harness();
    q.gp.start();
    q.data(reading(120, 5));
    q.advance(GP.PLUGIN_GRACE_MS * 2);
    assert(q.gp.mode() === 'plugin' && q.direct === 0, 'grace timer cancelled by data');
})();

// 6. Watchdog
console.log('\nwatchdog');
(function() {
    var h = harness();
    h.gp.start();
    h.data(reading(120, 5));
    var t0 = h.t;
    h.gp.checkStall(t0 + 10 * 60000);
    assert(h.gp.mode() === 'plugin', 'at 10 min nothing changes');
    h.gp.checkStall(t0 + GP.STALL_MS + 1);
    assert(h.gp.mode() === 'fallback', 'at 11 min + 1 ms → fallback');
    assert(h.gp.shouldFetchDirect(), 'shouldFetchDirect is true');
    assert(h.direct === 0, 'the watchdog leaves the fetch to fetchAllData');
    assert(!h.sub().unsubscribed, 'unsubscribe not called');
    h.data(reading(125, 5, 1700000300));
    assert(h.gp.mode() === 'plugin', 'a later onData returns to plugin');

    var d = harness({ plugins: [] });
    d.gp.start();
    d.gp.checkStall(d.t + GP.STALL_MS * 3);
    assert(d.gp.mode() === 'direct', 'never fires in direct mode');
    var p = harness();
    p.gp.start();
    p.gp.checkStall(p.t + GP.STALL_MS * 3);
    assert(p.gp.mode() === 'pending', 'never fires in pending mode');
})();

// 7. onSettingsChanged
console.log('\nonSettingsChanged');
(function() {
    var h = harness();
    h.gp.start();
    h.data(reading(120, 5));
    var first = h.sub();
    h.gp.onSettingsChanged();
    assert(first.unsubscribed && h.subs.length === 2, 'resubscribes');
    h.settings = { BG_UNITS: 'mmol/L' };
    h.data(reading(120, 5));
    assert(h.sent.length === 2 && h.sent[1].BG === '6.7', 'next envelope is sent even though the reading is unchanged');
    h.gp.onSettingsChanged();
    h.data(reading(120, 5));
    assert(h.sent.length === 3, 'gate cleared even with identical output');
})();

// 8. Guard only in fallback
console.log('\nguard');
(function() {
    var h = harness();
    h.gp.start();
    assert(h.gp.guardFor() === undefined, 'pending: no guard');
    h.data(reading(120, 5));
    assert(h.gp.guardFor() === undefined, 'plugin: no guard');
    h.error('PERMISSION_DENIED');
    var g = h.gp.guardFor();
    assert(g && g.owner === 'pkjs' && typeof g.begin === 'function', 'fallback: pkjs guard');
    var d = harness({ noApi: true });
    d.gp.start();
    assert(d.gp.guardFor() === undefined, 'direct: no guard');
})();

// 9. Constants and module hygiene
console.log('\nhygiene');
(function() {
    assert(GP.OWN_UUID === pkg.pebble.uuid, 'OWN_UUID matches package.json');
    var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'pkjs', 'glucose_plugin.js'), 'utf8');
    assert(src.indexOf('sendAppMessage') === -1, 'no Pebble.sendAppMessage in the module');
})();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
