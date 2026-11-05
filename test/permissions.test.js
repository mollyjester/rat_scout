/**
 * Tests for src/pkjs/permissions.js and its use by the glucose and weather sources.
 *
 * Run: node test/permissions.test.js
 */

var Permissions = require('../src/pkjs/permissions');
var GP = require('../src/pkjs/glucose_plugin');
var WP = require('../src/pkjs/weather_plugin');
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

// Capture console.log while fn runs (synchronously) and until the returned promise settles.
var captured = null;
var realLog = console.log;
console.log = function(line) {
    if (captured) captured.push(String(line));
    realLog.apply(console, arguments);
};

function pebbleWith(states, opts) {
    opts = opts || {};
    var queries = [];
    var pebble = {
        permissions: {
            query: function(key) {
                queries.push(key);
                if (opts.throws) throw new Error('nope');
                if (opts.rejects) return Promise.reject(new Error('host said no'));
                return Promise.resolve(states[key] || 'granted');
            }
        },
        enumeratePlugins: function() {
            return [
                { uuid: GP.PLUGIN_UUID, name: 'Rat Scout Glucose', sources: [{ category: 'health', items: ['glucose'] }] },
                { uuid: 'w', name: 'Weather', sources: [{ category: 'weather', items: ['location'] }] },
                { uuid: 'p', name: 'Preferences', sources: [{ category: 'preferences', items: ['units'] }] }
            ];
        },
        subscribeToSource: function(cfg) {
            var sub = { cfg: cfg, unsubscribe: function() {} };
            pebble.subs.push(sub);
            return sub;
        },
        subs: []
    };
    pebble.queries = queries;
    return pebble;
}

function flush() {
    return new Promise(function(resolve) { setImmediate(resolve); });
}

var chain = Promise.resolve();
function test(name, fn) {
    chain = chain.then(function() {
        console.log('\n' + name);
        captured = [];
        return Promise.resolve(fn()).then(flush).then(function() { return flush(); });
    }).catch(function(e) {
        assert(false, name + ' threw: ' + e);
    });
}
function logged(re) {
    return captured.some(function(l) { return re.test(l); });
}

test('logPermission: states and hints', function() {
    var p = pebbleWith({ Location: 'prompt', 'x:Glucose': 'denied' });
    assert(Permissions.logPermission(p, 'Location', 'Location', 'Weather') === true, 'query made');
    Permissions.logPermission(p, 'x:Glucose', 'Glucose', 'Glucose plugin');
    Permissions.logPermission(p, 'Other', 'Other', 'X');
    return flush().then(function() {
        assert(logged(/^Weather: permission Location waiting for approval/), 'prompt: approval hint');
        assert(logged(/^Glucose plugin: permission Glucose turned off for Rat Scout/), 'denied: turned-off hint');
        assert(logged(/^X: permission Other granted$/), 'granted');
        assert(!captured.some(function(l) { return l.indexOf('x:Glucose') !== -1; }), 'the key (a uuid on the phone) is never logged');
    });
});

test('logPermission: missing API, throwing and rejecting hosts', function() {
    assert(Permissions.logPermission({}, 'Location', 'Location', 'W') === false, 'no permissions API: nothing');
    assert(Permissions.logPermission(null, 'Location', 'Location', 'W') === false, 'no Pebble: nothing');
    assert(Permissions.logPermission({ permissions: { query: function() { return 'granted'; } } }, 'Location', 'Location', 'W') === false, 'not a promise: nothing');
    assert(Permissions.logPermission(pebbleWith({}, { throws: true }), 'Location', 'Location', 'W') === false, 'query throws: no exception');
    assert(logged(/W: permission Location query failed: nope/), 'throw logged');
    Permissions.logPermission(pebbleWith({}, { rejects: true }), 'Location', 'Location', 'R');
    return flush().then(function() {
        assert(logged(/R: permission Location query failed: host said no/), 'rejection logged');
    });
});

test('glucose source: queried once at the first subscription and on PERMISSION_DENIED', function() {
    var p = pebbleWith({});
    var gp = GP.create({
        Pebble: p, Glucose: Glucose, settings: function() { return { BG_UNITS: 'mg/dL' }; }, msgType: 1,
        send: function() {}, now: function() { return 1700000000000; },
        setTimeout: function() { return 0; }, clearTimeout: function() {}
    });
    gp.start();
    assert(p.queries.length === 1 && p.queries[0] === GP.PLUGIN_UUID + ':Glucose', 'start: queries <plugin uuid>:Glucose');
    p.subs[0].cfg.onError({ code: 'PERMISSION_DENIED', message: 'waiting for approval' });
    assert(p.queries.length === 2, 'PERMISSION_DENIED: queried again');
    p.subs[0].cfg.onError({ code: 'PERMISSION_DENIED', message: 'waiting for approval' });
    assert(p.queries.length === 2, 'a repeat while unavailable: not again');
    gp.onSettingsChanged();
    assert(p.queries.length === 2, 'a resubscribe does not query again');
});

test('weather source: Location queried once at subscribe and on PERMISSION_DENIED of weather only', function() {
    var p = pebbleWith({});
    var ws = WP.create({ Pebble: p, msgType: 2, send: function() {}, now: function() { return 1700000000000; } });
    ws.start();
    assert(p.queries.length === 1 && p.queries[0] === 'Location', 'start: queries Location');
    ws.recheck();
    assert(p.queries.length === 1, 'recheck: not again');
    var weather = p.subs.filter(function(s) { return s.cfg.category === 'weather'; })[0];
    var units = p.subs.filter(function(s) { return s.cfg.category === 'preferences'; })[0];
    units.cfg.onError({ code: 'PERMISSION_DENIED', message: 'x' });
    assert(p.queries.length === 1, 'units denied: no Location query');
    weather.cfg.onError({ code: 'PERMISSION_DENIED', message: 'x' });
    assert(p.queries.length === 2 && p.queries[1] === 'Location', 'weather denied: Location queried');
});

chain.then(function() {
    console.log = realLog;
    console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed > 0 ? 1 : 0);
});
