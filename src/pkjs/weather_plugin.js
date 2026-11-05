// Weather source: the watchface reads weather from whichever plugin the phone serves for
// weather/location (the user's choice in the app, else the built-in Weather), and the user's
// units from preferences/units (built-in Preferences). Neither subscription names a plugin:
// plugins serving the same source replace each other. ES5.
//
// The watch gets temperature and wind as rounded numbers in the user's units, and an umbrella
// flag. "--" when either source is unavailable, denied, or hasn't answered yet.
//
// All watch messages go through the caller's send function (sendIfChanged → sendToPebble).

var Permissions = require('./permissions');

var WEATHER = { category: 'weather', item: 'location' };
var UNITS = { category: 'preferences', item: 'units' };
// Only what the face shows; no iconPixelSize, so the plugin draws no glyphs.
var WEATHER_PROPERTIES = ['temperature', 'wind_speed', 'condition_code', 'daily_precipitation',
    'hourly_condition_code'];
var UNIT_PROPERTIES = ['temperature', 'wind_speed'];
// condition_code vocabulary shared by the built-in Weather (mobileapp WeatherPlugin.kt
// conditionCodeOf) and MET Norway (met-weather conditionCode).
var PRECIP_CODES = ['light_rain', 'heavy_rain', 'light_snow', 'heavy_snow', 'rain_and_snow'];
// Umbrella when today's chance of precipitation is above this (percent).
var PRECIP_CHANCE_PCT = 30;
var DAY_SEC = 86400;
var NO_VALUE = '--';
// The phone closes every subscription to a plugin it retires (plugin updated or removed, the
// user's choice changed, or the plugin preview turned off) with this message, code UNKNOWN
// (mobileapp libpebble3 plugin/JsPlugin.kt observe()).
var SUBSCRIPTION_CLOSED = /subscribe again/;

// Metres per second in one of each wind unit (preferences/units: km/h, mph, m/s, knots).
var WIND_MS = { 'm/s': 1, 'km/h': 1 / 3.6, 'mph': 0.44704, 'knots': 1852 / 3600 };

/**
 * Convert a temperature between °C and °F.
 * @param {number} value - Temperature
 * @param {string} from - Unit of value ('°C' or '°F')
 * @param {string} to - Wanted unit ('°C' or '°F')
 * @returns {?number} Converted value, or null for a unit it doesn't know
 */
function convertTemperature(value, from, to) {
    var known = { '°C': true, '°F': true };
    if (!known[from] || !known[to]) return null;
    if (from === to) return value;
    return from === '°C' ? value * 9 / 5 + 32 : (value - 32) * 5 / 9;
}

/**
 * Convert a wind speed between m/s, km/h, mph and knots.
 * @param {number} value - Speed
 * @param {string} from - Unit of value
 * @param {string} to - Wanted unit
 * @returns {?number} Converted value, or null for a unit it doesn't know
 */
function convertWind(value, from, to) {
    if (!WIND_MS[from] || !WIND_MS[to]) return null;
    return value * WIND_MS[from] / WIND_MS[to];
}

/**
 * Whether a plugin serving category/item is listed.
 * @param {Object} pebble - Pebble global
 * @param {Object} source - {category, item}
 * @returns {boolean} True if some plugin serves it
 */
function sourceAvailable(pebble, source) {
    if (!pebble || typeof pebble.subscribeToSource !== 'function' ||
        typeof pebble.enumeratePlugins !== 'function') {
        return false;
    }
    try {
        var list = pebble.enumeratePlugins() || [];
        for (var i = 0; i < list.length; i++) {
            var sources = (list[i] && list[i].sources) || [];
            for (var j = 0; j < sources.length; j++) {
                if (sources[j].category === source.category && (sources[j].items || []).indexOf(source.item) !== -1) {
                    return true;
                }
            }
        }
    } catch (e) {
        console.log('enumeratePlugins failed: ' + (e && e.message ? e.message : e));
    }
    return false;
}

/**
 * Name of a listed plugin, for the log. scripts/device-check.sh masks UUIDs other than the
 * face's, so the log says which plugin answered by name.
 * @param {Object} pebble - Pebble global
 * @param {string} uuid - envelope.pluginUuid
 * @returns {string} The plugin's name, or "unlisted plugin"
 */
function pluginName(pebble, uuid) {
    try {
        var list = pebble.enumeratePlugins() || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].uuid).toLowerCase() === String(uuid).toLowerCase()) return list[i].name;
        }
    } catch (e) {
        console.log('enumeratePlugins failed: ' + (e && e.message ? e.message : e));
    }
    return 'unlisted plugin';
}

/**
 * Value of a series at a time.
 * @param {Object} series - {start, stepSec, <shape>: {values}}
 * @param {string} shape - 'numericValue' or 'longText'
 * @param {number} index - Index into values
 * @returns {*} The value, or null
 */
function seriesValue(series, shape, index) {
    var values = series && series[shape] && series[shape].values;
    if (!values || index < 0 || index >= values.length) return null;
    return values[index];
}

/**
 * Whether today needs an umbrella: precipitation now, in an hour left today, or a chance of it
 * above PRECIP_CHANCE_PCT today. Properties the plugin left out count as no.
 * @param {Object} p - Instance properties
 * @param {number} nowSec - Now, epoch seconds
 * @returns {boolean} True if an umbrella is needed
 */
function needsUmbrella(p, nowSec) {
    var code = p.condition_code && p.condition_code.longText && p.condition_code.longText.text;
    if (PRECIP_CODES.indexOf(code) !== -1) return true;

    var daily = p.daily_precipitation && p.daily_precipitation.series;
    if (daily && typeof daily.start === 'number' && daily.stepSec > 0) {
        var chance = seriesValue(daily, 'numericValue', Math.floor((nowSec - daily.start) / daily.stepSec));
        if (typeof chance === 'number' && chance > PRECIP_CHANCE_PCT) return true;
    }

    var hourly = p.hourly_condition_code && p.hourly_condition_code.series;
    if (hourly && typeof hourly.start === 'number' && hourly.stepSec > 0) {
        // The series starts at a local midnight; today ends a whole number of days after it.
        var dayEnd = hourly.start + (Math.floor((nowSec - hourly.start) / DAY_SEC) + 1) * DAY_SEC;
        var first = Math.floor((nowSec - hourly.start) / hourly.stepSec);
        var last = Math.floor((dayEnd - hourly.start) / hourly.stepSec) - 1;
        for (var i = Math.max(first, 0); i <= last; i++) {
            if (PRECIP_CODES.indexOf(seriesValue(hourly, 'longText', i)) !== -1) return true;
        }
    }
    return false;
}

/**
 * A numericValue converted and rounded for the watch.
 * @param {Object} property - Instance property
 * @param {string} unit - Wanted unit
 * @param {Function} convert - convertTemperature or convertWind
 * @returns {string} Rounded number, or "--"
 */
function shown(property, unit, convert) {
    var n = property && property.numericValue;
    if (!n || typeof n.value !== 'number' || !unit) return NO_VALUE;
    var v = convert(n.value, n.unit, unit);
    return v === null ? NO_VALUE : String(Math.round(v));
}

/**
 * The watch dictionary for "no weather".
 * @param {number} msgType - MSG_TYPE_WEATHER
 * @returns {Object} Dictionary
 */
function noWeather(msgType) {
    return { 'MSG_TYPE': msgType, 'WEATHER_TEMP': NO_VALUE, 'WEATHER_WIND': NO_VALUE, 'WEATHER_UMBRELLA': 0 };
}

/**
 * Turn the latest weather and units envelopes into a watch dictionary.
 * @param {?Object} weather - weather/location envelope
 * @param {?Object} units - preferences/units envelope
 * @param {number} nowSec - Now, epoch seconds
 * @param {number} msgType - MSG_TYPE_WEATHER
 * @returns {Object} Dictionary ("--" without both)
 */
function toDictionary(weather, units, nowSec, msgType) {
    var inst = weather && weather.instances && weather.instances[0];
    var u = units && units.instances && units.instances[0] && units.instances[0].properties;
    if (!inst || !inst.properties || !u) return noWeather(msgType);
    var p = inst.properties;
    var tempUnit = u.temperature && u.temperature.shortText && u.temperature.shortText.text;
    var windUnit = u.wind_speed && u.wind_speed.shortText && u.wind_speed.shortText.text;
    return {
        'MSG_TYPE': msgType,
        'WEATHER_TEMP': shown(p.temperature, tempUnit, convertTemperature),
        'WEATHER_WIND': shown(p.wind_speed, windUnit, convertWind),
        'WEATHER_UMBRELLA': needsUmbrella(p, nowSec) ? 1 : 0
    };
}

/**
 * "value unit" of a numericValue, for the log.
 * @param {Object} property - Instance property
 * @returns {string} Description
 */
function describe(property) {
    var n = property && property.numericValue;
    return n ? n.value + ' ' + (n.unit || '(no unit)') : '(none)';
}

/**
 * Create the source.
 * @param {Object} deps - {Pebble, msgType, send(dict), now()}
 * @returns {Object} Source API
 */
function create(deps) {
    var now = deps.now || function() { return Date.now(); };

    /**
     * One subscription's state.
     * @param {Object} source - {category, item}
     * @param {Array} properties - Properties to ask for
     * @param {string} label - Name for the log
     */
    function Feed(source, properties, label) {
        this.source = source;
        this.properties = properties;
        this.label = label;
        this.subscription = null;
        this.envelope = null;
        // Bumped by every subscribe and unsubscribe; callbacks of an older one are ignored.
        this.generation = 0;
        // Set by INVALID_REQUEST: re-checking can't help until settings are saved.
        this.pinned = false;
        // No plugin serves the source; logged and shown once, until one does.
        this.missing = false;
    }

    var weather = new Feed(WEATHER, WEATHER_PROPERTIES, 'Weather');
    var units = new Feed(UNITS, UNIT_PROPERTIES, 'Weather units');

    function render() {
        deps.send(toDictionary(weather.envelope, units.envelope, Math.floor(now() / 1000), deps.msgType));
    }

    function unsubscribe(feed) {
        feed.generation++;
        if (feed.subscription && typeof feed.subscription.unsubscribe === 'function') {
            try {
                feed.subscription.unsubscribe();
            } catch (e) {
                console.log(feed.label + ': unsubscribe failed: ' + e);
            }
        }
        feed.subscription = null;
    }

    /**
     * Forget a feed's data and show "--".
     * @param {Object} feed - Feed
     */
    function lose(feed) {
        feed.envelope = null;
        render();
    }

    function onData(feed, envelope) {
        feed.envelope = envelope;
        var inst = envelope && envelope.instances && envelope.instances[0];
        var p = (inst && inst.properties) || {};
        if (feed === weather) {
            // Units as each plugin sends them; no place names or coordinates in logs.
            console.log('Weather data: plugin=' + pluginName(deps.Pebble, envelope && envelope.pluginUuid) +
                ' temperature=' + describe(p.temperature) + ' wind=' + describe(p.wind_speed));
        } else {
            console.log('Weather units: plugin=' + pluginName(deps.Pebble, envelope && envelope.pluginUuid) +
                ' temperature=' + (p.temperature && p.temperature.shortText && p.temperature.shortText.text) +
                ' wind=' + (p.wind_speed && p.wind_speed.shortText && p.wind_speed.shortText.text));
        }
        render();
    }

    function onError(feed, err) {
        var code = err && err.code ? err.code : 'UNKNOWN';
        console.log(feed.label + ' error: ' + code + (err && err.message ? ' (' + err.message + ')' : ''));
        if (code === 'INVALID_REQUEST') {
            unsubscribe(feed);
            feed.pinned = true;
            lose(feed);
            return;
        }
        if (err && SUBSCRIPTION_CLOSED.test(String(err.message || ''))) {
            // The serving plugin was retired: detect again and subscribe to whatever serves now.
            unsubscribe(feed);
            start(feed);
            return;
        }
        // The host serves an open subscription once the user approves (mobileapp
        // plugin/PluginClient.kt observe()), so it is kept.
        if (code === 'PERMISSION_DENIED') {
            // weather/* needs Location of its callers (preview guide, "Permissions").
            if (feed === weather) Permissions.logPermission(deps.Pebble, 'Location', 'Location', feed.label);
            lose(feed);
        }
        // Anything else: keep the last weather on the watch.
    }

    /**
     * Detect a plugin serving the feed's source and subscribe.
     * @param {Object} feed - Feed
     * @returns {boolean} True if subscribed
     */
    function start(feed) {
        if (feed.subscription || feed.pinned) return !!feed.subscription;
        if (!sourceAvailable(deps.Pebble, feed.source)) {
            if (!feed.missing) {
                feed.missing = true;
                console.log(feed.label + ': no plugin serves ' + feed.source.category + '/' + feed.source.item);
                lose(feed);
            }
            return false;
        }
        feed.missing = false;
        var gen = ++feed.generation;
        try {
            feed.subscription = deps.Pebble.subscribeToSource({
                category: feed.source.category,
                item: feed.source.item,
                properties: feed.properties,
                onData: function(envelope) { if (gen === feed.generation) onData(feed, envelope); },
                onError: function(err) { if (gen === feed.generation) onError(feed, err); }
            });
        } catch (e) {
            console.log(feed.label + ': subscribeToSource failed: ' + e);
            feed.subscription = null;
            lose(feed);
            return false;
        }
        console.log(feed.label + ': subscribed to ' + feed.source.category + '/' + feed.source.item);
        return true;
    }

    var locationLogged = false;

    function startBoth() {
        if (start(weather) && !locationLogged) {
            locationLogged = true;
            Permissions.logPermission(deps.Pebble, 'Location', 'Location', weather.label);
        }
        start(units);
    }

    return {
        /** Subscribe to both sources, or show "--". */
        start: startBoth,

        /**
         * Run in fetchAllData() (every watch ping). Subscribe to a source that had no plugin (a
         * plugin can be installed or enabled while the face runs; not after INVALID_REQUEST),
         * and send the weather again: a send that failed is retried (the change filter forgot
         * it), and the umbrella follows the hours left today.
         */
        recheck: function() {
            startBoth();
            if (weather.envelope && units.envelope) render();
        },

        /**
         * Settings were saved: lift an INVALID_REQUEST pin and subscribe again where needed.
         */
        onSettingsChanged: function() {
            weather.pinned = false;
            units.pinned = false;
            startBoth();
        }
    };
}

module.exports = {
    WEATHER_PROPERTIES: WEATHER_PROPERTIES,
    PRECIP_CHANCE_PCT: PRECIP_CHANCE_PCT,
    convertTemperature: convertTemperature,
    convertWind: convertWind,
    sourceAvailable: sourceAvailable,
    needsUmbrella: needsUmbrella,
    toDictionary: toDictionary,
    create: create
};
