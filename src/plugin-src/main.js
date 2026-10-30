// Rat Scout plugin: serves health/glucose from Dexcom Share. ES5 + Promise.
//
// Source of truth for the code shipped as src/plugin/index.js, which
// scripts/build-plugin.js generates from this file and its requires. Never
// edit src/plugin/index.js by hand.
//
// A plugin is started fresh for each request (Pebble plugins preview guide,
// "localStorage ... A plugin is started fresh for each request, so don't keep
// state in variables"), so every piece of state lives in localStorage.

var Dexcom = require('../pkjs/dexcom');
var Glucose = require('../pkjs/glucose');
var DexcomGuard = require('../common/dexcom_guard');

var CATEGORY = 'health';
var ITEM = 'glucose';
var INSTANCE_ID = 'dexcom';

var CACHE_KEY = 'ratscout.plugin.lastReading';
var LAST_ATTEMPT_KEY = 'ratscout.plugin.lastAttempt';
// Same session keys as PKJS (index.js CONFIG.STORAGE_KEYS), so the two share one login.
var ACCOUNT_ID_KEY = 'accountId';
var SESSION_ID_KEY = 'sessionId';

// A new Dexcom reading is expected 300 s after the last; +10 s slack.
var READING_FRESH_SEC = 310;
// At most one Dexcom call per this interval. 55 s rather than 60 s so jitter
// in a 60 s host poll never skips a poll.
var ATTEMPT_THROTTLE_MS = 55000;
var EMPTY_VALID_MS = 60000;
var BUSY_VALID_MS = 30000;

var MGDL_RANGE = { min: 40, max: 400 };
var MMOL_RANGE = { min: 2.2, max: 22.2 };

var TREND_TEXT = {
    None: 'No trend',
    DoubleUp: 'Rising quickly',
    SingleUp: 'Rising',
    FortyFiveUp: 'Rising slowly',
    Flat: 'Steady',
    FortyFiveDown: 'Falling slowly',
    SingleDown: 'Falling',
    DoubleDown: 'Falling quickly',
    NotComputable: 'Not computable',
    RateOutOfRange: 'Rate out of range'
};

/**
 * Parse Clay settings shared with PKJS.
 * @param {Object} storage - localStorage
 * @returns {Object} Settings, {} if missing or corrupt
 */
function readSettings(storage) {
    try {
        return JSON.parse(storage.getItem('clay-settings')) || {};
    } catch (e) {
        return {};
    }
}

/**
 * Read the cached reading.
 * @param {Object} storage - localStorage
 * @returns {?Object} {credKey, value, delta, trend, arrow, ts} or null
 */
function readCache(storage) {
    try {
        var c = JSON.parse(storage.getItem(CACHE_KEY));
        return c && typeof c.value === 'number' && typeof c.ts === 'number' ? c : null;
    } catch (e) {
        return null;
    }
}

/**
 * Store the latest reading (raw mg/dL values).
 * @param {Object} storage - localStorage
 * @param {Object} reading - {credKey, value, delta, trend, arrow, ts}
 */
function writeCache(storage, reading) {
    storage.setItem(CACHE_KEY, JSON.stringify(reading));
}

/**
 * Build the glucose instance for a cached reading, in the user's units.
 * @param {Object} reading - Cached reading (mg/dL)
 * @param {string} units - 'mg/dL' or 'mmol/L'
 * @returns {Object} Instance
 */
function buildInstance(reading, units) {
    var mmol = units === 'mmol/L';
    var range = mmol ? MMOL_RANGE : MGDL_RANGE;
    var text = Glucose.formatBGValue(reading.value, units);
    var arrow = reading.arrow || '?';
    var props = {
        name: { shortText: { text: 'Dexcom' } },
        status: { shortText: { text: 'ok' }, longText: { text: 'Latest reading' } },
        glucose: {
            numericValue: { value: parseFloat(text), unit: units, min: range.min, max: range.max },
            shortText: { text: text },
            longText: { text: text + ' ' + units + ' ' + arrow }
        },
        glucose_mgdl: { numericValue: { value: reading.value, unit: 'mg/dL' } },
        trend: {
            shortText: { text: arrow },
            longText: { text: TREND_TEXT[reading.trend] || 'Unknown' }
        },
        trend_code: { longText: { text: String(reading.trend) } },
        reading_time: { timestamp: { value: reading.ts } }
    };
    if (typeof reading.delta === 'number') {
        var deltaText = Glucose.formatBGDelta(reading.delta, units);
        props.delta = {
            numericValue: { value: parseFloat(deltaText), unit: units },
            shortText: { text: deltaText }
        };
        props.delta_mgdl = { numericValue: { value: reading.delta, unit: 'mg/dL' } };
    }
    return { instanceId: INSTANCE_ID, properties: props };
}

/**
 * Envelope for a reading.
 * @param {Object} reading - Cached reading
 * @param {string} units - Units
 * @param {number} t - Now, epoch ms
 * @returns {Object} Envelope
 */
function readingEnvelope(reading, units, t) {
    return {
        validUntilMs: Math.max(t + EMPTY_VALID_MS, (reading.ts + READING_FRESH_SEC) * 1000),
        instances: [buildInstance(reading, units)]
    };
}

/**
 * Envelope with no reading (no credentials, no data, Dexcom failure).
 * @param {number} t - Now, epoch ms
 * @returns {Object} Envelope
 */
function emptyEnvelope(t) {
    return { validUntilMs: t + EMPTY_VALID_MS, instances: [] };
}

/**
 * Envelope for "another context is logging in; no reading cached yet".
 * PKJS keeps whatever it shows rather than drawing "---".
 * @param {number} t - Now, epoch ms
 * @returns {Object} Envelope
 */
function busyEnvelope(t) {
    return {
        validUntilMs: t + BUSY_VALID_MS,
        instances: [{
            instanceId: INSTANCE_ID,
            properties: {
                name: { shortText: { text: 'Dexcom' } },
                status: { shortText: { text: 'busy' }, longText: { text: 'Signing in to Dexcom' } }
            }
        }]
    };
}

/**
 * Run one Dexcom fetch, resolving with {result} or {error}.
 * @param {Object} env - {storage, Dexcom}
 * @param {Object} settings - Clay settings
 * @param {boolean} useSession - Start from the cached accountId/sessionId
 * @returns {Promise} Resolves {result, dex} or {error}
 */
function fetchFromDexcom(env, settings, useSession) {
    return new Promise(function(resolve) {
        var settled = false;
        function finish(v) {
            if (settled) return;
            settled = true;
            resolve(v);
        }
        var dex = new env.Dexcom(
            settings.DEX_LOGIN,
            settings.DEX_PASSWORD,
            function(result) { finish({ result: result, dex: dex }); },
            settings.DEX_REGION,
            function(error) { finish({ error: String(error) }); }
        );
        if (useSession) {
            dex.accountId = env.storage.getItem(ACCOUNT_ID_KEY);
            dex.sessionId = env.storage.getItem(SESSION_ID_KEY);
        }
        try {
            dex.getLatestGlucoseWithDelta();
        } catch (e) {
            finish({ error: String(e && e.message ? e.message : e) });
        }
    });
}

/**
 * Answer one source request.
 * @param {Object} request - {category, item, ...}
 * @param {Object} respond - Host respond object (data, error)
 * @param {Object} env - {storage, now, Dexcom}
 * @returns {Promise} Settles after respond is called
 */
function handleSourceRequest(request, respond, env) {
    var storage = env.storage;
    var t = env.now();

    if (!request || request.category !== CATEGORY || request.item !== ITEM) {
        respond.error('INVALID_REQUEST', 'Rat Scout serves health/glucose only');
        return Promise.resolve();
    }

    var settings = readSettings(storage);
    var units = settings.BG_UNITS || Glucose.DEFAULT_BG_UNITS;

    if (!settings.DEX_LOGIN || !settings.DEX_PASSWORD) {
        console.log('No Dexcom credentials in Rat Scout settings');
        respond.data(emptyEnvelope(t));
        return Promise.resolve();
    }

    var key = DexcomGuard.credKey(settings);
    var cache = readCache(storage);
    var cacheOk = !!cache && cache.credKey === key;

    if (cacheOk && t < (cache.ts + READING_FRESH_SEC) * 1000) {
        respond.data(readingEnvelope(cache, units, t));
        return Promise.resolve();
    }

    /**
     * Answer without calling Dexcom: cached reading if any, else "busy".
     */
    function answerSkipped() {
        respond.data(cacheOk ? readingEnvelope(cache, units, t) : busyEnvelope(t));
    }

    var lastAttempt = parseInt(storage.getItem(LAST_ATTEMPT_KEY), 10) || 0;
    if (t - lastAttempt < ATTEMPT_THROTTLE_MS && t >= lastAttempt) {
        console.log('Dexcom call throttled');
        answerSkipped();
        return Promise.resolve();
    }

    var guard = DexcomGuard.create(storage, 'plugin', env.now);
    var haveSession = !!storage.getItem(ACCOUNT_ID_KEY) && !!storage.getItem(SESSION_ID_KEY) &&
        guard.sessionUsable(key);
    var locked = false;

    if (!haveSession) {
        var reason = guard.begin(key);
        if (reason === 'badcreds') {
            console.log('Dexcom login paused: credentials were rejected');
            respond.data(emptyEnvelope(t));
            return Promise.resolve();
        }
        if (reason === 'inflight') {
            console.log('Dexcom login in progress elsewhere; skipping');
            answerSkipped();
            return Promise.resolve();
        }
        locked = true;
    }

    storage.setItem(LAST_ATTEMPT_KEY, String(t));

    return fetchFromDexcom(env, settings, haveSession).then(function(outcome) {
        if (outcome.error) {
            console.log('Dexcom fetch failed: ' + outcome.error);
            storage.removeItem(ACCOUNT_ID_KEY);
            storage.removeItem(SESSION_ID_KEY);
            guard.end(key, outcome.error);
            respond.data(emptyEnvelope(env.now()));
            return;
        }
        var cur = outcome.result.current;
        storage.setItem(ACCOUNT_ID_KEY, outcome.dex.accountId);
        storage.setItem(SESSION_ID_KEY, outcome.dex.sessionId);
        // A run that re-authenticated after a session error took no lock; end() still records success.
        guard.end(key, null);
        var reading = {
            credKey: key,
            value: cur._value,
            delta: typeof cur._delta === 'number' ? cur._delta : null,
            trend: cur._trend_direction,
            arrow: cur._trend_arrow,
            ts: Math.floor(cur._datetime.getTime() / 1000)
        };
        writeCache(storage, reading);
        respond.data(readingEnvelope(reading, units, env.now()));
    }).then(null, function(e) {
        if (locked) guard.end(key, 'internal');
        respond.error('UNKNOWN', String(e && e.message ? e.message : e));
    });
}

if (typeof Pebble !== 'undefined' && Pebble && typeof Pebble.registerSourceHandler === 'function') {
    Pebble.registerSourceHandler(function(request, respond) {
        return handleSourceRequest(request, respond, {
            storage: localStorage,
            now: function() { return Date.now(); },
            Dexcom: Dexcom
        });
    });
}

module.exports = {
    CACHE_KEY: CACHE_KEY,
    LAST_ATTEMPT_KEY: LAST_ATTEMPT_KEY,
    READING_FRESH_SEC: READING_FRESH_SEC,
    ATTEMPT_THROTTLE_MS: ATTEMPT_THROTTLE_MS,
    buildInstance: buildInstance,
    handleSourceRequest: handleSourceRequest
};
