/**
 * Tests for src/pkjs/weather_plugin.js (the watchface's weather: whichever plugin serves
 * weather/location, in the units of preferences/units).
 *
 * Run: node test/weather_plugin.test.js
 */

var WP = require('../src/pkjs/weather_plugin');

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

function near(a, b) {
    return typeof a === 'number' && Math.abs(a - b) < 1e-9;
}

var MSG = 2;
var BUILT_IN_WEATHER = '00000000-0000-0000-0001-000000000002';
var MET = '323dc117-55bd-455f-9ee4-4d0faba56ea1';
var PREFERENCES = '00000000-0000-0000-0001-000000000009';
var LISTED = [
    { uuid: BUILT_IN_WEATHER, name: 'Weather', sources: [{ category: 'weather', items: ['location'] }] },
    { uuid: MET, name: 'MET Norway Weather', sources: [{ category: 'weather', items: ['location'] }] },
    { uuid: PREFERENCES, name: 'Preferences', sources: [{ category: 'preferences', items: ['units', 'complications', 'weather_location'] }] }
];
// 2026-11-02 12:00 UTC; the series below start at that day's midnight UTC.
var NOW_MS = Date.UTC(2026, 10, 2, 12, 0, 0);
var MIDNIGHT = Date.UTC(2026, 10, 2) / 1000;

function units(temp, wind) {
    return {
        pluginUuid: PREFERENCES,
        instances: [{ instanceId: 'units', properties: {
            temperature: { shortText: { text: temp } },
            wind_speed: { shortText: { text: wind } }
        } }]
    };
}

/** As MET Norway sends it: °C and m/s. */
function metWeather(celsius, ms, extra) {
    var p = {
        temperature: { shortText: { text: Math.round(celsius) + '°C' }, numericValue: { value: celsius, unit: '°C' } },
        wind_speed: { numericValue: { value: ms, unit: 'm/s' }, shortText: { text: '0 km/h' } },
        condition_code: { longText: { text: 'sun' } }
    };
    Object.keys(extra || {}).forEach(function(k) { p[k] = extra[k]; });
    return { pluginUuid: MET, instances: [{ instanceId: 'current', properties: p }] };
}

function hourlyCodes(codes) {
    return { series: { start: MIDNIGHT, stepSec: 3600, longText: { values: codes } } };
}

function dailyChance(values) {
    return { series: { start: MIDNIGHT, stepSec: 86400, numericValue: { values: values, unit: '%' } } };
}

/**
 * Build a source with mocks.
 * @param {Object} opts - {plugins, noApi, subscribeThrows}
 * @returns {Object} Harness
 */
function harness(opts) {
    opts = opts || {};
    var h = { t: NOW_MS, sent: [], subs: [], plugins: opts.plugins === undefined ? LISTED : opts.plugins };
    var pebble = {};
    if (!opts.noApi) {
        pebble.enumeratePlugins = function() { return h.plugins; };
        pebble.subscribeToSource = function(cfg) {
            if (opts.subscribeThrows) throw new Error('boom');
            var sub = { cfg: cfg, unsubscribed: false };
            sub.unsubscribe = function() { sub.unsubscribed = true; };
            h.subs.push(sub);
            return sub;
        };
    }
    h.ws = WP.create({
        Pebble: pebble,
        msgType: MSG,
        send: function(d) { h.sent.push(d); },
        now: function() { return h.t; }
    });
    h.sub = function(category) {
        for (var i = h.subs.length - 1; i >= 0; i--) if (h.subs[i].cfg.category === category) return h.subs[i];
        return null;
    };
    h.last = function() { return h.sent[h.sent.length - 1]; };
    return h;
}

var origLog = console.log;
console.log = function() {};
var logs = [];
function quiet(fn) {
    logs = [];
    console.log = function(m) { logs.push(String(m)); };
    try { fn(); } finally { console.log = function() {}; }
}
function say(m) { origLog(m); }

say('weather_plugin.js tests\n');

say('conversions');
(function() {
    assert(near(WP.convertTemperature(20, '°C', '°C'), 20), '°C → °C unchanged');
    assert(near(WP.convertTemperature(20, '°C', '°F'), 68), '20 °C → 68 °F');
    assert(near(WP.convertTemperature(68, '°F', '°C'), 20), '68 °F → 20 °C');
    assert(near(WP.convertTemperature(-40, '°F', '°C'), -40), '-40 °F → -40 °C');
    assert(WP.convertTemperature(20, 'K', '°C') === null, 'unknown source unit → null');
    assert(WP.convertTemperature(20, undefined, '°C') === null, 'missing unit → null');
    assert(near(WP.convertWind(10, 'm/s', 'km/h'), 36), '10 m/s → 36 km/h');
    assert(near(WP.convertWind(10, 'm/s', 'mph'), 10 / 0.44704), 'm/s → mph');
    assert(near(WP.convertWind(10, 'mph', 'km/h'), 16.09344), '10 mph → 16.09344 km/h');
    assert(near(WP.convertWind(10, 'mph', 'mph'), 10), 'mph → mph unchanged');
    assert(near(WP.convertWind(10, 'knots', 'km/h'), 18.52), '10 knots → 18.52 km/h');
    assert(near(WP.convertWind(36, 'km/h', 'm/s'), 10), '36 km/h → 10 m/s');
    assert(WP.convertWind(10, 'beaufort', 'km/h') === null, 'unknown wind unit → null');
})();

say('\ntoDictionary');
(function() {
    var d = WP.toDictionary(metWeather(21.6, 5), units('°C', 'km/h'), NOW_MS / 1000, MSG);
    assert(d.MSG_TYPE === MSG, 'MSG_TYPE');
    assert(d.WEATHER_TEMP === '22' && d.WEATHER_WIND === '18', 'MET °C/m/s in °C/km/h: 22, 18');
    assert(d.WEATHER_UMBRELLA === 0, 'sun: no umbrella');

    d = WP.toDictionary(metWeather(20, 5), units('°F', 'mph'), NOW_MS / 1000, MSG);
    assert(d.WEATHER_TEMP === '68' && d.WEATHER_WIND === '11', 'MET in °F/mph: 68, 11');

    // As the built-in Weather sends it: the user's temperature unit, wind always in mph.
    var builtIn = { pluginUuid: BUILT_IN_WEATHER, instances: [{ instanceId: '1', properties: {
        temperature: { numericValue: { value: 12, unit: '°C' } },
        wind_speed: { numericValue: { value: 10, unit: 'mph' } }
    } }] };
    d = WP.toDictionary(builtIn, units('°C', 'km/h'), NOW_MS / 1000, MSG);
    assert(d.WEATHER_TEMP === '12' && d.WEATHER_WIND === '16', 'built-in °C/mph in °C/km/h: 12, 16');
    d = WP.toDictionary(builtIn, units('°C', 'm/s'), NOW_MS / 1000, MSG);
    assert(d.WEATHER_WIND === '4', 'built-in mph in m/s: 4');

    var noUnit = { instances: [{ properties: { temperature: { numericValue: { value: 12 } }, wind_speed: { numericValue: { value: 3, unit: 'm/s' } } } }] };
    d = WP.toDictionary(noUnit, units('°C', 'km/h'), NOW_MS / 1000, MSG);
    assert(d.WEATHER_TEMP === '--' && d.WEATHER_WIND === '11', 'temperature without a unit: "--", wind still shown');

    var noWind = { instances: [{ properties: { temperature: { numericValue: { value: 12, unit: '°C' } } } }] };
    d = WP.toDictionary(noWind, units('°C', 'km/h'), NOW_MS / 1000, MSG);
    assert(d.WEATHER_TEMP === '12' && d.WEATHER_WIND === '--', 'no wind_speed: wind "--"');

    var none = { 'MSG_TYPE': MSG, 'WEATHER_TEMP': '--', 'WEATHER_WIND': '--', 'WEATHER_UMBRELLA': 0 };
    assert(JSON.stringify(WP.toDictionary(null, units('°C', 'km/h'), 0, MSG)) === JSON.stringify(none), 'no weather: "--"');
    assert(JSON.stringify(WP.toDictionary(metWeather(1, 1), null, 0, MSG)) === JSON.stringify(none), 'no units: "--"');
    assert(JSON.stringify(WP.toDictionary({ instances: [] }, units('°C', 'km/h'), 0, MSG)) === JSON.stringify(none), 'no instance: "--"');
    d = WP.toDictionary(metWeather(1, 1), { instances: [{ properties: {} }] }, 0, MSG);
    assert(d.WEATHER_TEMP === '--' && d.WEATHER_WIND === '--', 'units without values: "--"');
})();

say('\numbrella');
(function() {
    var nowSec = NOW_MS / 1000;
    function p(extra) { return metWeather(10, 1, extra).instances[0].properties; }
    ['light_rain', 'heavy_rain', 'light_snow', 'heavy_snow', 'rain_and_snow'].forEach(function(code) {
        assert(WP.needsUmbrella(p({ condition_code: { longText: { text: code } } }), nowSec), code + ' now → umbrella');
    });
    ['sun', 'partly_cloudy', 'cloudy', 'unknown'].forEach(function(code) {
        assert(!WP.needsUmbrella(p({ condition_code: { longText: { text: code } } }), nowSec), code + ' now → none');
    });
    assert(!WP.needsUmbrella({}, nowSec), 'no properties → none');

    var codes = [];
    for (var i = 0; i < 48; i++) codes.push('cloudy');
    var later = codes.slice(); later[18] = 'light_rain';
    assert(WP.needsUmbrella(p({ hourly_condition_code: hourlyCodes(later) }), nowSec), 'rain at 18:00 today → umbrella');
    var thisHour = codes.slice(); thisHour[12] = 'heavy_rain';
    assert(WP.needsUmbrella(p({ hourly_condition_code: hourlyCodes(thisHour) }), nowSec), 'rain this hour → umbrella');
    var past = codes.slice(); past[11] = 'heavy_rain';
    assert(!WP.needsUmbrella(p({ hourly_condition_code: hourlyCodes(past) }), nowSec), 'rain an hour ago → none');
    var tomorrow = codes.slice(); tomorrow[24] = 'heavy_snow';
    assert(!WP.needsUmbrella(p({ hourly_condition_code: hourlyCodes(tomorrow) }), nowSec), 'snow tomorrow → none');
    var lastHour = codes.slice(); lastHour[23] = 'light_snow';
    assert(WP.needsUmbrella(p({ hourly_condition_code: hourlyCodes(lastHour) }), nowSec), 'snow at 23:00 today → umbrella');
    var withNulls = codes.slice(); withNulls[15] = null;
    assert(!WP.needsUmbrella(p({ hourly_condition_code: hourlyCodes(withNulls) }), nowSec), 'null hours ignored');

    // A series fetched yesterday: today's hours are 24..47.
    var old = { series: { start: MIDNIGHT - 86400, stepSec: 3600, longText: { values: codes.slice() } } };
    old.series.longText.values[24 + 20] = 'light_rain';
    assert(WP.needsUmbrella(p({ hourly_condition_code: old }), nowSec), 'series from yesterday: 20:00 today found');

    assert(WP.needsUmbrella(p({ daily_precipitation: dailyChance([31, 0]) }), nowSec), 'chance 31% today → umbrella');
    assert(!WP.needsUmbrella(p({ daily_precipitation: dailyChance([30, 90]) }), nowSec), 'chance 30% today, 90% tomorrow → none');
    assert(!WP.needsUmbrella(p({ daily_precipitation: dailyChance([null]) }), nowSec), 'unknown chance → none');
    var oldDaily = { series: { start: MIDNIGHT - 86400, stepSec: 86400, numericValue: { values: [0, 80] } } };
    assert(WP.needsUmbrella(p({ daily_precipitation: oldDaily }), nowSec), 'daily from yesterday: today is index 1');

    var h = harness();
    quiet(function() { h.ws.start(); });
    var rain = codes.slice(); rain[13] = 'light_rain';
    quiet(function() {
        h.sub('preferences').cfg.onData(units('°C', 'km/h'));
        h.sub('weather').cfg.onData(metWeather(10, 1, { hourly_condition_code: hourlyCodes(rain) }));
    });
    assert(h.last().WEATHER_UMBRELLA === 1, '12:00, rain at 13:00: umbrella');
    h.t += 2 * 3600 * 1000;
    quiet(function() { h.ws.recheck(); });
    assert(h.last().WEATHER_UMBRELLA === 0, 'a watch ping at 14:00: rain is past, no umbrella');

    var d = WP.toDictionary(metWeather(10, 1, { daily_precipitation: dailyChance([50]) }), units('°C', 'km/h'), nowSec, MSG);
    assert(d.WEATHER_UMBRELLA === 1, 'dictionary carries the umbrella');
})();

say('\nsubscriptions');
(function() {
    var h = harness();
    quiet(function() { h.ws.start(); });
    var w = h.sub('weather');
    var u = h.sub('preferences');
    assert(w && w.cfg.item === 'location' && u && u.cfg.item === 'units', 'subscribes to weather/location and preferences/units');
    assert(!('plugin' in w.cfg) && !('plugin' in u.cfg), 'neither request names a plugin');
    assert(!('iconPixelSize' in w.cfg), 'no iconPixelSize');
    assert(JSON.stringify(w.cfg.properties) === JSON.stringify(WP.WEATHER_PROPERTIES), 'asks only for the weather properties used');
    assert(JSON.stringify(u.cfg.properties) === JSON.stringify(['temperature', 'wind_speed']), 'asks only for temperature and wind units');
    assert(h.sent.length === 0, 'nothing sent before data');

    quiet(function() { w.cfg.onData(metWeather(20, 10)); });
    assert(h.last().WEATHER_TEMP === '--', 'weather without units yet: "--"');
    quiet(function() { u.cfg.onData(units('°C', 'km/h')); });
    assert(h.last().WEATHER_TEMP === '20' && h.last().WEATHER_WIND === '36', 'both: 20, 36');
    quiet(function() { u.cfg.onData(units('°F', 'mph')); });
    assert(h.last().WEATHER_TEMP === '68' && h.last().WEATHER_WIND === '22', 'units change re-sends: 68, 22');

    quiet(function() { w.cfg.onData(metWeather(20, 10)); });
    assert(logs.some(function(l) { return l === 'Weather data: plugin=MET Norway Weather temperature=20 °C wind=10 m/s'; }),
        'logs the plugin by name and the units it sent');
    quiet(function() { w.cfg.onData({ pluginUuid: 'ffffffff-0000-0000-0000-000000000000', instances: [] }); });
    assert(logs.some(function(l) { return l.indexOf('Weather data: plugin=unlisted plugin ') === 0; }), 'a uuid not listed: "unlisted plugin"');
    quiet(function() { w.cfg.onData(metWeather(20, 10)); });
    quiet(function() { u.cfg.onData(units('°C', 'km/h')); });
    assert(logs.some(function(l) { return l === 'Weather units: plugin=Preferences temperature=°C wind=km/h'; }),
        'logs the preferred units');

    var before = h.subs.length;
    var sentBefore = h.sent.length;
    quiet(function() { h.ws.recheck(); });
    assert(h.subs.length === before, 'recheck with both subscribed: no new subscription');
    assert(h.sent.length === sentBefore + 1 && h.last().WEATHER_TEMP === '20', 'recheck sends the weather again (the change filter drops repeats)');
})();

(function() {
    var h = harness();
    quiet(function() { h.ws.start(); });
    quiet(function() { h.sub('preferences').cfg.onData(units('°C', 'km/h')); h.sub('weather').cfg.onData(metWeather(5, 1)); });
    var n = h.sent.length;
    quiet(function() { h.sub('weather').cfg.onError({ code: 'PLUGIN_UNAVAILABLE', message: 'Could not reach MET Norway.' }); });
    assert(h.sent.length === n, 'PLUGIN_UNAVAILABLE: nothing sent, the watch keeps the last weather');
    assert(logs.some(function(l) { return l.indexOf('Weather error: PLUGIN_UNAVAILABLE (Could not reach MET Norway.)') === 0; }), 'error code and message logged');
    quiet(function() { h.sub('weather').cfg.onError({ code: 'TIMEOUT' }); });
    assert(h.sent.length === n, 'other errors: nothing sent');

    var w = h.sub('weather');
    quiet(function() { w.cfg.onError({ code: 'PERMISSION_DENIED', message: 'waiting for approval' }); });
    assert(h.last().WEATHER_TEMP === '--', 'PERMISSION_DENIED: "--"');
    assert(!w.unsubscribed, 'PERMISSION_DENIED keeps the subscription');
    quiet(function() { w.cfg.onData(metWeather(7, 1)); });
    assert(h.last().WEATHER_TEMP === '7', 'data after approval shows again');
})();

(function() {
    var h = harness();
    quiet(function() { h.ws.start(); });
    quiet(function() { h.sub('preferences').cfg.onData(units('°C', 'km/h')); h.sub('weather').cfg.onData(metWeather(5, 1)); });
    var old = h.sub('weather');
    quiet(function() { old.cfg.onError({ code: 'UNKNOWN', message: 'MET Norway Weather was updated or removed; subscribe again' }); });
    var fresh = h.sub('weather');
    assert(old.unsubscribed && fresh !== old, '"subscribe again": resubscribes at once');
    assert(!('plugin' in fresh.cfg), 'still without a plugin');
    quiet(function() { old.cfg.onData(metWeather(99, 1)); });
    assert(h.last().WEATHER_TEMP === '5', 'callbacks of the old subscription are ignored');
    quiet(function() { fresh.cfg.onData({ pluginUuid: BUILT_IN_WEATHER, instances: [{ properties: { temperature: { numericValue: { value: 41, unit: '°F' } }, wind_speed: { numericValue: { value: 10, unit: 'mph' } } } }] }); });
    assert(h.last().WEATHER_TEMP === '5' && h.last().WEATHER_WIND === '16', 'another plugin answers: converted to the same units');

    // The last weather plugin is gone.
    h.plugins = [LISTED[2]];
    quiet(function() { fresh.cfg.onError({ code: 'UNKNOWN', message: 'Weather was updated or removed; subscribe again' }); });
    assert(h.last().WEATHER_TEMP === '--', 'no plugin left: "--"');
    assert(h.sub('weather') === fresh, 'not subscribed');
    var n = h.sent.length;
    quiet(function() { h.ws.recheck(); });
    assert(h.sent.length === n && logs.length === 0, 'recheck while still missing: silent, nothing sent');
    h.plugins = LISTED;
    quiet(function() { h.ws.recheck(); });
    assert(h.sub('weather') !== fresh, 'recheck subscribes once a plugin serves it');
})();

(function() {
    var h = harness({ plugins: [LISTED[2]] });
    quiet(function() { h.ws.start(); });
    assert(!h.sub('weather') && h.sub('preferences'), 'no weather plugin: only units subscribed');
    assert(h.sent.length === 1 && h.last().WEATHER_TEMP === '--', 'no weather plugin: "--" once');

    h = harness({ plugins: [LISTED[0]] });
    quiet(function() { h.ws.start(); });
    assert(h.sub('weather') && !h.sub('preferences'), 'no preferences plugin: only weather subscribed');
    quiet(function() { h.sub('weather').cfg.onData(metWeather(5, 1)); });
    assert(h.last().WEATHER_TEMP === '--', 'no units source: "--"');

    h = harness({ noApi: true });
    quiet(function() { h.ws.start(); });
    assert(h.subs.length === 0 && h.last().WEATHER_TEMP === '--', 'no plugin API: "--"');

    h = harness({ subscribeThrows: true });
    quiet(function() { h.ws.start(); });
    assert(h.last().WEATHER_TEMP === '--', 'subscribeToSource throws: "--"');
})();

(function() {
    var h = harness();
    quiet(function() { h.ws.start(); });
    var w = h.sub('weather');
    quiet(function() { w.cfg.onError({ code: 'INVALID_REQUEST', message: 'bad' }); });
    assert(w.unsubscribed && h.last().WEATHER_TEMP === '--', 'INVALID_REQUEST: unsubscribed, "--"');
    quiet(function() { h.ws.recheck(); });
    assert(h.sub('weather') === w, 'pinned: recheck does not resubscribe');
    quiet(function() { h.ws.onSettingsChanged(); });
    assert(h.sub('weather') !== w, 'settings saved: subscribes again');
})();

console.log = origLog;
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
