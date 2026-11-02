// Glucose source: the watchface reads BG only from the Rat Scout Glucose plugin (a separate,
// plugin-only pbw, plugin/), which owns the Dexcom account. ES5.
//
// Modes:
//   unavailable - no plugin API, the plugin isn't listed (not installed, or the phone app's
//                 plugin preview is off), or it is failing: the watch shows "---". Re-checked
//                 on every watch ping, so installing the plugin or turning the preview on
//                 takes effect without restarting the face.
//   pending     - subscribed, waiting for the first envelope (grace timer)
//   plugin      - BG comes from the plugin
//
// All watch messages still go through the caller's sendToPebble queue.

var PLUGIN_UUID = '01523c90-aa11-4a82-8e00-58cc3e98472c';
var CATEGORY = 'health';
var ITEM = 'glucose';

var PLUGIN_GRACE_MS = 30000;
// Host polls about every 60 s (suggestedRefreshIntervalSec); 11 min without any envelope
// means the host stopped serving us.
var STALL_MS = 11 * 60 * 1000;
var MAX_SOFT_ERRORS = 2;
var NO_DATA_TYPE = 'No glucose data';
// The phone closes every subscription to a plugin it retires (plugin updated or removed, or the
// plugin preview turned off) with this message and code UNKNOWN (mobileapp libpebble3
// plugin/JsPlugin.kt observe(): "$name was updated or removed; subscribe again").
var SUBSCRIPTION_CLOSED = /subscribe again/;
// A reading is due 300 s after the last one; the watch pings PKJS from +305 s (messaging.c).
var READING_DUE_SEC = 305;
// The plugin calls Dexcom at most once per 55 s (src/plugin-src/main.js ATTEMPT_THROTTLE_MS), so
// resubscribing sooner after an envelope or a resubscribe could only be answered from its cache.
var RESUBSCRIBE_MIN_MS = 55000;

/**
 * Whether the phone app lists the Rat Scout Glucose plugin serving health/glucose.
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
            if (!list[i] || String(list[i].uuid).toLowerCase() !== PLUGIN_UUID) continue;
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
 * Reading time of an envelope's reading.
 * @param {Object} envelope - {instances: [...]}
 * @returns {number} Epoch seconds, or 0 if it has no reading
 */
function readingTime(envelope) {
    var instances = (envelope && envelope.instances) || [];
    for (var i = 0; i < instances.length; i++) {
        var p = (instances[i] && instances[i].properties) || {};
        var ts = p.reading_time && p.reading_time.timestamp;
        if (ts && typeof ts.value === 'number' && p.glucose_mgdl) return ts.value;
    }
    return 0;
}

/**
 * Create the source.
 * @param {Object} deps - {Pebble, Glucose, settings(), msgType, send(dict, type), now(),
 *                        setTimeout, clearTimeout}
 * @returns {Object} Source API
 */
function create(deps) {
    var now = deps.now || function() { return Date.now(); };
    var setT = deps.setTimeout || setTimeout;
    var clearT = deps.clearTimeout || clearTimeout;
    var state = {
        mode: 'unavailable',
        subscription: null,
        graceTimer: null,
        lastPluginOkMs: 0,
        errorCount: 0,
        // Reading time (epoch s) of the last envelope with a reading; 0 = none yet.
        lastReadingTs: 0,
        lastResubscribeMs: 0,
        // Bumped by every subscribe and unsubscribe; callbacks of an older one are ignored.
        generation: 0,
        lastSent: null,
        // Set by INVALID_REQUEST: the host refused our request shape, so re-checking cannot help.
        pinned: false
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
     * Send through the gate: a dictionary equal to the last one sent is dropped.
     * ts lines let scripts/device-check.sh spot duplicate sends; no BG value is logged.
     * @param {Object} dict - Glucose dictionary
     */
    function send(dict) {
        if (state.lastSent && state.lastSent.BG === dict.BG && state.lastSent.TIMESTAMP === dict.TIMESTAMP) {
            console.log('Glucose gate: skipped duplicate ts=' + dict.TIMESTAMP);
            return;
        }
        console.log('Glucose gate: plugin send ts=' + dict.TIMESTAMP);
        state.lastSent = { BG: dict.BG, TIMESTAMP: dict.TIMESTAMP };
        deps.send(dict, dict.BG === '---' ? NO_DATA_TYPE : 'BG (plugin)');
    }

    /**
     * No plugin data: show "---". The subscription, if any, stays open, so a later envelope
     * returns to plugin mode.
     * @param {string} why - Reason for the log
     */
    function toUnavailable(why) {
        clearGrace();
        setMode('unavailable', why);
        send({ 'MSG_TYPE': deps.msgType, 'BG': '---', 'TIMESTAMP': 0 });
    }

    function onData(envelope) {
        var ts = readingTime(envelope);
        if (ts) state.lastReadingTs = ts;
        console.log('Glucose plugin data: ' + (((envelope && envelope.instances) || []).length) + ' instance(s)');
        state.lastPluginOkMs = now();
        state.errorCount = 0;
        clearGrace();
        setMode('plugin', 'data');
        var dict = envelopeToDictionary(envelope, deps.settings(), deps.Glucose, deps.msgType);
        if (dict) send(dict);
    }

    function onError(err) {
        var code = err && err.code ? err.code : 'UNKNOWN';
        // The host's message says why (e.g. no plugin for the item vs. no handler registered).
        console.log('Glucose plugin error: ' + code + (err && err.message ? ' (' + err.message + ')' : ''));
        if (code === 'INVALID_REQUEST') {
            unsubscribe();
            state.pinned = true;
            toUnavailable(code);
            return;
        }
        if (err && SUBSCRIPTION_CLOSED.test(String(err.message || ''))) {
            // The subscription is over: detect again. Still listed (updated or reinstalled) →
            // subscribe at once; not listed (removed, preview off) → "---" now, and the
            // re-check on each watch ping picks it up again later.
            unsubscribe();
            clearGrace();
            tryStart(false);
            return;
        }
        if (state.mode === 'unavailable') return;
        if (code === 'PERMISSION_DENIED' || code === 'PLUGIN_UNAVAILABLE' || state.mode === 'pending') {
            toUnavailable(code);
            return;
        }
        // In plugin mode a transient error keeps the last reading on screen.
        state.errorCount++;
        if (state.errorCount >= MAX_SOFT_ERRORS || now() - state.lastPluginOkMs > STALL_MS) {
            toUnavailable(code);
        }
    }

    function subscribe() {
        // Callbacks of a subscription that was replaced are ignored. Android's host drops them
        // already (mobileapp startup.js _signalSourceUpdate); other hosts weren't checked.
        // The generation is set before subscribing, so a host that answers synchronously
        // still reaches onData.
        var gen = ++state.generation;
        state.subscription = deps.Pebble.subscribeToSource({
            category: CATEGORY,
            item: ITEM,
            plugin: PLUGIN_UUID,
            onData: function(envelope) { if (gen === state.generation) onData(envelope); },
            onError: function(err) { if (gen === state.generation) onError(err); }
        });
    }

    /**
     * Replace the subscription: the phone host reads at once on a new one (mobileapp
     * plugin/JsPlugin.kt observe()). The mode, the gate and the watchdog are left as they are.
     * @returns {boolean} True if subscribed again
     */
    function resubscribe() {
        state.lastResubscribeMs = now();
        unsubscribe();
        try {
            subscribe();
            return true;
        } catch (e) {
            console.log('resubscribe failed: ' + e);
            toUnavailable('resubscribe failed');
            return false;
        }
    }

    function unsubscribe() {
        state.generation++;
        if (state.subscription && typeof state.subscription.unsubscribe === 'function') {
            try {
                state.subscription.unsubscribe();
            } catch (e) {
                console.log('unsubscribe failed: ' + e);
            }
        }
        state.subscription = null;
    }

    /**
     * Detect the plugin and subscribe.
     * @param {boolean} quiet - Periodic re-check: don't log or resend when still unavailable
     * @returns {boolean} True if subscribed
     */
    function tryStart(quiet) {
        if (state.subscription) return true;
        if (!pluginAvailable(deps.Pebble)) {
            if (!quiet) toUnavailable('plugin not available');
            return false;
        }
        try {
            subscribe();
        } catch (e) {
            console.log('subscribeToSource failed: ' + e);
            if (!quiet) toUnavailable('subscribe failed');
            return false;
        }
        setMode('pending', 'subscribed');
        state.graceTimer = setT(function() {
            state.graceTimer = null;
            if (state.mode === 'pending') toUnavailable('no data in ' + (PLUGIN_GRACE_MS / 1000) + ' s');
        }, PLUGIN_GRACE_MS);
        return true;
    }

    return {
        PLUGIN_UUID: PLUGIN_UUID,

        /** @returns {string} Current mode */
        mode: function() { return state.mode; },

        /** Detect the plugin and subscribe, or show "---". */
        start: function() {
            tryStart(false);
        },

        /**
         * Re-check for the plugin while unavailable without a subscription, run at the top of
         * fetchAllData() (every watch ping): the plugin can be installed, or the plugin preview
         * turned on, while the face runs. Not after INVALID_REQUEST.
         * @returns {boolean} True if it subscribed now
         */
        recheck: function() {
            if (state.mode !== 'unavailable' || state.pinned || state.subscription) return false;
            return tryStart(true);
        },

        /**
         * Stall watchdog, run at the top of fetchAllData().
         * @param {number} t - Now, epoch ms
         */
        checkStall: function(t) {
            if (state.mode === 'plugin' && t - state.lastPluginOkMs > STALL_MS) {
                toUnavailable('no plugin data for ' + Math.round((t - state.lastPluginOkMs) / 60000) + ' min');
            }
        },

        /**
         * Reading overdue: resubscribe so the plugin runs now instead of at the host's next
         * poll, which counts only time the phone is awake and was seen to take about 6 min.
         * Run in fetchAllData() on every watch ping (the watch pings each minute while a
         * reading is late, messaging.c / rat_scout.c). Only in plugin mode with a reading,
         * more than READING_DUE_SEC after it, and at most once per RESUBSCRIBE_MIN_MS after
         * an envelope or a resubscribe. The plugin's cache and throttle bound Dexcom calls.
         * @param {number} t - Now, epoch ms
         * @returns {boolean} True if it resubscribed
         */
        refreshIfOverdue: function(t) {
            if (state.mode !== 'plugin' || !state.subscription || !state.lastReadingTs) return false;
            var overdue = Math.floor(t / 1000) - state.lastReadingTs;
            if (overdue <= READING_DUE_SEC) return false;
            if (t - state.lastPluginOkMs < RESUBSCRIBE_MIN_MS || t - state.lastResubscribeMs < RESUBSCRIBE_MIN_MS) {
                return false;
            }
            console.log('Glucose plugin: resubscribe (reading overdue ' + overdue + ' s)');
            return resubscribe();
        },

        /**
         * Settings were saved: forget the last send and resubscribe so the plugin's next
         * answer is re-formatted and sent.
         */
        onSettingsChanged: function() {
            state.lastSent = null;
            if (!state.subscription) return;
            resubscribe();
        }
    };
}

module.exports = {
    PLUGIN_UUID: PLUGIN_UUID,
    PLUGIN_GRACE_MS: PLUGIN_GRACE_MS,
    STALL_MS: STALL_MS,
    READING_DUE_SEC: READING_DUE_SEC,
    RESUBSCRIBE_MIN_MS: RESUBSCRIBE_MIN_MS,
    pluginAvailable: pluginAvailable,
    envelopeToDictionary: envelopeToDictionary,
    create: create
};
