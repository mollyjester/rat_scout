// Glucose formatting, shared by the watchface PKJS (index.js, glucose_plugin.js) and the
// Rat Scout Glucose plugin bundle. Fetching from Dexcom lives in the plugin only.

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
 * @param {?number} delta - Delta value; null/undefined when the reading has none
 * @returns {string} Formatted delta, '' without one
 * @param {string} units - Blood glucose units
 */
function formatBGDelta(delta, units) {
    if (typeof delta !== 'number' || isNaN(delta)) return '';
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

module.exports = {
    MMOL_CONVERSION_FACTOR: MMOL_CONVERSION_FACTOR,
    DEFAULT_BG_UNITS: DEFAULT_BG_UNITS,
    formatBGValue: formatBGValue,
    formatBGDelta: formatBGDelta,
    buildGlucoseDictionary: buildGlucoseDictionary,
    sendNoGlucoseData: sendNoGlucoseData
};
