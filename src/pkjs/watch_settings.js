// The settings dictionary sent to the watch (index.js sendSettings). ES5.
//
// Two of its values depend on the time of day: the BG thresholds (night window) and the
// garbage bag (pickup hour). The watch only learns them from this message, so index.js
// rebuilds it on every watch ping and sends it again when one of them changed.

var Garbage = require('./garbage');

var DEFAULT_BG_UNITS = 'mg/dL';

/**
 * Check whether a settings value has been filled in (not empty/undefined).
 * @param {*} value - Settings value to check
 * @returns {boolean} True if value is present and non-empty
 */
function hasSettingValue(value) {
    return value !== undefined && value !== '';
}

/**
 * Check whether an hour falls inside the configured night window.
 * Handles windows that cross midnight (e.g. start=22, end=7).
 * @param {Object} settings - App settings
 * @param {Date} now - Current time
 * @returns {boolean} True if night thresholds are configured and active at that hour
 */
function isNightWindow(settings, now) {
    var nightStart = parseInt(settings.BG_NIGHT_START, 10);
    var nightEnd = parseInt(settings.BG_NIGHT_END, 10);

    if (isNaN(nightStart) || isNaN(nightEnd)) return false;

    if (!hasSettingValue(settings.BG_NIGHT_LOW_THRESHOLD) &&
        !hasSettingValue(settings.BG_NIGHT_HIGH_THRESHOLD)) return false;

    var hour = now.getHours();

    if (nightStart <= nightEnd) {
        return hour >= nightStart && hour < nightEnd;
    }
    // Crosses midnight (e.g. 22 -> 7)
    return hour >= nightStart || hour < nightEnd;
}

/**
 * Build the settings dictionary.
 * @param {Object} settings - App settings (Clay)
 * @param {Date} now - Current time
 * @param {number} msgType - MSG_TYPE_SETTINGS
 * @returns {Object} Dictionary
 */
function build(settings, now, msgType) {
    var useNight = isNightWindow(settings, now);

    var lowThreshold = useNight && hasSettingValue(settings.BG_NIGHT_LOW_THRESHOLD)
        ? settings.BG_NIGHT_LOW_THRESHOLD
        : settings.BG_LOW_THRESHOLD;

    var highThreshold = useNight && hasSettingValue(settings.BG_NIGHT_HIGH_THRESHOLD)
        ? settings.BG_NIGHT_HIGH_THRESHOLD
        : settings.BG_HIGH_THRESHOLD;

    return {
        "MSG_TYPE": msgType,
        "BG_SHOW_DELTA": settings.BG_SHOW_DELTA ? 1 : 0,
        "BG_SHOW_TIMEDELTA": settings.BG_SHOW_TIMEDELTA ? 1 : 0,
        "HOURLY_VIBRATION": settings.HOURLY_VIBRATION ? 1 : 0,
        "BG_VIBRATION": settings.BG_VIBRATION ? 1 : 0,
        "BG_LOW_THRESHOLD": Math.round((parseFloat(lowThreshold) || 0) * 10),
        "BG_HIGH_THRESHOLD": Math.round((parseFloat(highThreshold) || 0) * 10),
        "DATE_FORMAT": settings.DATE_FORMAT || "dd.mm",
        "GARBAGE_BAG": Garbage.computeGarbageBag(settings, now),
        "ALERT_OVERLAY_ENABLE": settings.ALERT_OVERLAY_ENABLE ? 1 : 0,
        "ALERT_OVERLAY_DURATION": parseInt(settings.ALERT_OVERLAY_DURATION, 10) || 10,
        "BG_LOW_SOUND": settings.BG_LOW_SOUND ? 1 : 0,
        "BG_HIGH_SOUND": settings.BG_HIGH_SOUND ? 1 : 0,
        "HOURLY_SOUND": settings.HOURLY_SOUND ? 1 : 0
    };
}

/**
 * The part of the dictionary that changes with the time of day.
 * @param {Object} dict - build() result
 * @returns {string} Comparable key
 */
function timedPart(dict) {
    return [dict.BG_LOW_THRESHOLD, dict.BG_HIGH_THRESHOLD, dict.GARBAGE_BAG].join('|');
}

module.exports = {
    DEFAULT_BG_UNITS: DEFAULT_BG_UNITS,
    hasSettingValue: hasSettingValue,
    isNightWindow: isNightWindow,
    build: build,
    timedPart: timedPart
};
