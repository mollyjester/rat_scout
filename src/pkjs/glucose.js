// Glucose fetching and formatting logic

var MMOL_CONVERSION_FACTOR = 18.0182;
var DEFAULT_BG_UNITS = 'mg/dL';

/**
 * Format blood glucose value based on units
 * @param {number} value - Raw value
 * @param {string} units - 'mg/dL' or 'mmol/L'
 * @returns {string} Formatted value
 */
function formatBGValue(value, units) {
    if (units === 'mmol/L') {
        return (value / MMOL_CONVERSION_FACTOR).toFixed(1);
    }
    return String(value);
}

/**
 * Format BG delta with sign
 * @param {number} delta - Delta value
 * @param {string} units - Blood glucose units
 * @returns {string} Formatted delta
 */
function formatBGDelta(delta, units) {
    var formatted = units === 'mmol/L'
        ? (delta / MMOL_CONVERSION_FACTOR).toFixed(1)
        : String(delta);
    return delta > 0 ? '+' + formatted : formatted;
}

/**
 * Build glucose data dictionary from reading
 * @param {Object} result - Dexcom result object
 * @param {Object} settings - App settings
 * @param {number} msgTypeGlucose - MSG_TYPE_GLUCOSE constant
 * @returns {Object} Dictionary to send to Pebble
 */
function buildGlucoseDictionary(result, settings, msgTypeGlucose) {
    var bgUnits = settings.BG_UNITS || DEFAULT_BG_UNITS;
    var readingTimestamp = Math.floor(result.current._datetime.getTime() / 1000);

    return {
        "MSG_TYPE": msgTypeGlucose,
        "BG_UNITS": bgUnits,
        "BG_SHOW_DELTA": settings.BG_SHOW_DELTA ? 1 : 0,
        "BG_SHOW_TIMEDELTA": settings.BG_SHOW_TIMEDELTA ? 1 : 0,
        "BG": formatBGValue(result.current._value, bgUnits),
        "BGDELTA": formatBGDelta(result.current._delta, bgUnits),
        "TIMESTAMP": readingTimestamp
    };
}

/**
 * Send "no data" indication to the watchface.
 * @param {number} msgTypeGlucose - MSG_TYPE_GLUCOSE constant
 * @param {Function} sendToPebble - Function to send data to Pebble
 */
function sendNoGlucoseData(msgTypeGlucose, sendToPebble) {
    var dictionary = {
        "MSG_TYPE": msgTypeGlucose,
        "BG": "---",
        "TIMESTAMP": 0
    };
    sendToPebble(dictionary, 'No glucose data');
}

/**
 * Fetch glucose reading from Dexcom Share API
 * @param {Object} appSettings - App settings
 * @param {Object} config - CONFIG object with STORAGE_KEYS, DEFAULT_BG_UNITS
 * @param {Function} sendToPebble - Function to send data to Pebble
 * @param {Function} fetchAndSendAstronomy - Function to fetch astronomy data
 * @param {Function} DexcomConstructor - Dexcom constructor
 * @param {number} msgTypeGlucose - MSG_TYPE_GLUCOSE constant
 * @param {Object} guard - Optional login guard (src/common/dexcom_guard.js create()),
 *   passed only in plugin fallback mode. When undefined behaviour is exactly as before.
 */
function fetchGlucoseReading(appSettings, config, sendToPebble, fetchAndSendAstronomy, DexcomConstructor, msgTypeGlucose, guard) {
    console.log('Getting glucose reading');

    if (!appSettings || !appSettings.DEX_LOGIN || !appSettings.DEX_PASSWORD) {
        console.error('No Dexcom login credentials configured');
        sendNoGlucoseData(msgTypeGlucose, sendToPebble);
        return;
    }

    var accountId = window.localStorage.getItem(config.STORAGE_KEYS.ACCOUNT_ID);
    var sessionId = window.localStorage.getItem(config.STORAGE_KEYS.SESSION_ID);

    var guardKey = guard ? guard.credKey(appSettings) : null;
    if (guard && !guard.sessionUsable(guardKey)) {
        accountId = null;
        sessionId = null;
    }
    if (guard && !(accountId && sessionId)) {
        var blocked = guard.begin(guardKey);
        if (blocked) {
            // Keep whatever the watch shows; the plugin or a later ping will retry.
            console.log('Skipping Dexcom login (' + blocked + ')');
            return;
        }
    }

    var dex = new DexcomConstructor(
        appSettings.DEX_LOGIN,
        appSettings.DEX_PASSWORD,
        function(result) {
            console.log('Current WT: ' + result.current._json.WT);

            var dictionary = buildGlucoseDictionary(result, appSettings, msgTypeGlucose);

            // Cache session IDs for faster subsequent requests
            window.localStorage.setItem(config.STORAGE_KEYS.ACCOUNT_ID, dex.accountId);
            window.localStorage.setItem(config.STORAGE_KEYS.SESSION_ID, dex.sessionId);
            if (guard) guard.end(guardKey, null);

            // Send BG data immediately without waiting for astronomy
            sendToPebble(dictionary, 'BG');

            // Fetch astronomy as a separate independent message
            fetchAndSendAstronomy();
        },
        appSettings.DEX_REGION,
        function(error) {
            console.error('Glucose fetch failed: ' + error);
            // Clear stale cached session to force full re-authentication on next attempt
            window.localStorage.removeItem(config.STORAGE_KEYS.ACCOUNT_ID);
            window.localStorage.removeItem(config.STORAGE_KEYS.SESSION_ID);
            if (guard) guard.end(guardKey, String(error));
            sendNoGlucoseData(msgTypeGlucose, sendToPebble);
        }
    );

    if (accountId && sessionId) {
        dex.accountId = accountId;
        dex.sessionId = sessionId;
    }

    try {
        dex.getLatestGlucoseWithDelta();
    } catch (error) {
        console.error('Error fetching glucose: ' + (error.message || error));
        if (guard) guard.end(guardKey, String(error.message || error));
        sendNoGlucoseData(msgTypeGlucose, sendToPebble);
    }
}

module.exports = {
    MMOL_CONVERSION_FACTOR: MMOL_CONVERSION_FACTOR,
    DEFAULT_BG_UNITS: DEFAULT_BG_UNITS,
    formatBGValue: formatBGValue,
    formatBGDelta: formatBGDelta,
    buildGlucoseDictionary: buildGlucoseDictionary,
    sendNoGlucoseData: sendNoGlucoseData,
    fetchGlucoseReading: fetchGlucoseReading
};
