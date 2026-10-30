// Glucose source selection: read BG from Rat Scout's own plugin when the
// phone app offers plugins, else (or when the plugin fails) fetch Dexcom
// directly as before. ES5.
//
// Modes:
//   direct   - no plugin API, our plugin isn't listed, subscribing failed or
//              the plugin answered INVALID_REQUEST: today's behaviour
//   pending  - subscribed, waiting for the first envelope (grace timer)
//   plugin   - BG comes from the plugin; no direct Dexcom fetch
//   fallback - plugin failing; direct fetch with the login guard, while the
//              subscription stays open so a later envelope returns to plugin
//
// All watch messages still go through the caller's sendToPebble queue.

var OWN_UUID = 'f41022a2-b149-42ac-a98d-2afbf84ca841';
var CATEGORY = 'health';
var ITEM = 'glucose';

var PLUGIN_GRACE_MS = 30000;
// Host polls every 60 s (suggestedRefreshIntervalSec); 11 min without any
// envelope means the host stopped serving us.
var STALL_MS = 11 * 60 * 1000;
var MAX_SOFT_ERRORS = 2;

/**
 * Whether the phone app lists our plugin serving health/glucose.
 * @param {Object} pebble - Pebble global
 * @returns {boolean} True if the plugin can be subscribed to
 */
function pluginAvailable(pebble) {
    if (!pebble || typeof pebble.subscribeToSource !== 'function' ||
        typeof pebble.enumeratePlugins !== 'function') {
        return false;
    }
    try {
        var list = pebble.enumeratePlugins() || [];
        for (var i = 0; i < list.length; i++) {
            if (!list[i] || String(list[i].uuid).toLowerCase() !== OWN_UUID) continue;
            var sources = list[i].sources || [];
            for (var j = 0; j < sources.length; j++) {
                if (sources[j].category === CATEGORY && (sources[j].items || []).indexOf(ITEM) !== -1) {
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
 * Turn a plugin envelope into a watch dictionary.
 * @param {Object} envelope - {instances: [...]}
 * @param {Object} settings - App settings
 * @param {Object} Glucose - glucose.js module
 * @param {number} msgType - MSG_TYPE_GLUCOSE
 * @returns {?Object} Dictionary, or null to send nothing (status busy)
 */
function envelopeToDictionary(envelope, settings, Glucose, msgType) {
    var instances = (envelope && envelope.instances) || [];
    var inst = null;
    for (var i = 0; i < instances.length; i++) {
        if (instances[i] && instances[i].instanceId === 'dexcom') { inst = instances[i]; break; }
    }
    inst = inst || instances[0] || null;
    var p = (inst && inst.properties) || {};
    var mgdl = p.glucose_mgdl && p.glucose_mgdl.numericValue;
    var ts = p.reading_time && p.reading_time.timestamp;
    if (mgdl && typeof mgdl.value === 'number' && ts && typeof ts.value === 'number') {
        var d = p.delta_mgdl && p.delta_mgdl.numericValue;
        return Glucose.buildGlucoseDictionary({
            current: {
                _value: mgdl.value,
                _delta: d && typeof d.value === 'number' ? d.value : null,
                _datetime: new Date(ts.value * 1000)
            }
        }, settings, msgType);
    }
    var status = p.status && p.status.shortText && p.status.shortText.text;
    if (inst && status === 'busy') return null;
    return { 'MSG_TYPE': msgType, 'BG': '---', 'TIMESTAMP': 0 };
}

/**
 * Create the selector.
 * @param {Object} deps - {Pebble, Glucose, DexcomGuard, storage, settings(), msgType,
 *                        send(dict, type), fetchDirect(), now(), setTimeout, clearTimeout}
 * @returns {Object} Selector API
 */
function create(deps) {
    var now = deps.now || function() { return Date.now(); };
    var setT = deps.setTimeout || setTimeout;
    var clearT = deps.clearTimeout || clearTimeout;
    var state = {
        mode: 'direct',
        subscription: null,
        graceTimer: null,
        lastPluginOkMs: 0,
        errorCount: 0,
        lastSent: null
    };

    function setMode(mode, why) {
        if (state.mode !== mode) console.log('Glucose source: mode=' + mode + (why ? ' (' + why + ')' : ''));
        state.mode = mode;
    }

    function clearGrace() {
        if (state.graceTimer !== null) {
            clearT(state.graceTimer);
            state.graceTimer = null;
        }
    }

    /**
     * Switch to fallback; fetch directly at once unless the caller will.
     * @param {string} why - Reason for the log
     * @param {boolean} fetchNow - Run a direct fetch now
     */
    function toFallback(why, fetchNow) {
        var was = state.mode;
        clearGrace();
        setMode('fallback', why);
        if (fetchNow && was !== 'fallback') deps.fetchDirect();
    }

    function record(dict) {
        state.lastSent = { BG: dict.BG, TIMESTAMP: dict.TIMESTAMP };
    }

    function sendFromPlugin(dict) {
        if (state.lastSent && state.lastSent.BG === dict.BG && state.lastSent.TIMESTAMP === dict.TIMESTAMP) {
            return;
        }
        record(dict);
        deps.send(dict, dict.BG === '---' ? 'No glucose data (plugin)' : 'BG (plugin)');
    }

    function onData(envelope) {
        console.log('Glucose plugin data: ' + (((envelope && envelope.instances) || []).length) + ' instance(s)');
        state.lastPluginOkMs = now();
        state.errorCount = 0;
        clearGrace();
        setMode('plugin', 'data');
        var dict = envelopeToDictionary(envelope, deps.settings(), deps.Glucose, deps.msgType);
        if (dict) sendFromPlugin(dict);
    }

    function onError(err) {
        var code = err && err.code ? err.code : 'UNKNOWN';
        console.log('Glucose plugin error: ' + code);
        if (state.mode === 'direct') return;
        if (code === 'INVALID_REQUEST') {
            unsubscribe();
            clearGrace();
            var was = state.mode;
            setMode('direct', code);
            if (was !== 'fallback') deps.fetchDirect();
            return;
        }
        if (code === 'PERMISSION_DENIED' || code === 'PLUGIN_UNAVAILABLE') {
            toFallback(code, true);
            return;
        }
        state.errorCount++;
        if (state.errorCount >= MAX_SOFT_ERRORS || state.mode === 'pending' ||
            now() - state.lastPluginOkMs > STALL_MS) {
            toFallback(code, true);
        }
    }

    function subscribe() {
        state.subscription = deps.Pebble.subscribeToSource({
            category: CATEGORY,
            item: ITEM,
            plugin: OWN_UUID,
            onData: onData,
            onError: onError
        });
    }

    function unsubscribe() {
        if (state.subscription && typeof state.subscription.unsubscribe === 'function') {
            try {
                state.subscription.unsubscribe();
            } catch (e) {
                console.log('unsubscribe failed: ' + e);
            }
        }
        state.subscription = null;
    }

    return {
        OWN_UUID: OWN_UUID,

        /** @returns {string} Current mode */
        mode: function() { return state.mode; },

        /**
         * Detect the plugin and subscribe, or stay direct.
         */
        start: function() {
            if (state.subscription) return;
            if (!pluginAvailable(deps.Pebble)) {
                setMode('direct', 'plugin not available');
                console.log('Glucose source: mode=direct');
                return;
            }
            try {
                subscribe();
            } catch (e) {
                console.log('subscribeToSource failed: ' + e);
                setMode('direct', 'subscribe failed');
                return;
            }
            setMode('pending', 'subscribed');
            state.graceTimer = setT(function() {
                state.graceTimer = null;
                if (state.mode === 'pending') toFallback('no data in ' + (PLUGIN_GRACE_MS / 1000) + ' s', true);
            }, PLUGIN_GRACE_MS);
        },

        /**
         * Stall watchdog, run at the top of fetchAllData().
         * @param {number} t - Now, epoch ms
         */
        checkStall: function(t) {
            if (state.mode === 'plugin' && t - state.lastPluginOkMs > STALL_MS) {
                toFallback('no plugin data for ' + Math.round((t - state.lastPluginOkMs) / 60000) + ' min', false);
            }
        },

        /** @returns {boolean} True if fetchAllData should fetch Dexcom itself */
        shouldFetchDirect: function() {
            return state.mode === 'direct' || state.mode === 'fallback';
        },

        /**
         * Wrap sendToPebble for the direct path: records the last BG sent,
         * never blocks.
         * @param {Function} send - sendToPebble
         * @returns {Function} Wrapped send
         */
        recordingSend: function(send) {
            return function(dict, type) {
                if (dict && dict.MSG_TYPE === deps.msgType) record(dict);
                send(dict, type);
            };
        },

        /** @returns {?Object} Login guard in fallback mode, else undefined */
        guardFor: function() {
            return state.mode === 'fallback' ? deps.DexcomGuard.create(deps.storage, 'pkjs') : undefined;
        },

        /**
         * Settings were saved: forget the last send and resubscribe so the
         * plugin's next answer is re-formatted and sent.
         */
        onSettingsChanged: function() {
            state.lastSent = null;
            if (!state.subscription) return;
            unsubscribe();
            try {
                subscribe();
            } catch (e) {
                console.log('resubscribe failed: ' + e);
                clearGrace();
                setMode('direct', 'resubscribe failed');
            }
        }
    };
}

module.exports = {
    OWN_UUID: OWN_UUID,
    PLUGIN_GRACE_MS: PLUGIN_GRACE_MS,
    STALL_MS: STALL_MS,
    pluginAvailable: pluginAvailable,
    envelopeToDictionary: envelopeToDictionary,
    create: create
};
