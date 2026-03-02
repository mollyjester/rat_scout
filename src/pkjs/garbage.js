// Garbage collection schedule logic

var GARBAGE_BAG_NONE = 0;
var GARBAGE_BAG_ORGANIC = 1;
var GARBAGE_BAG_GREY = 2;
var GARBAGE_BAG_BLACK = 3;

/**
 * Convert an array of boolean checked-states to a bitmask.
 * Index 0 = Monday, Index 1 = Tuesday, ..., Index 6 = Sunday.
 * Each element is true/false indicating whether that day is selected.
 * @param {Array} days - Array of booleans from checkboxgroup
 * @returns {number} Bitmask
 */
function daysToBitmask(days) {
    if (!Array.isArray(days)) return 0;
    var mask = 0;
    for (var i = 0; i < days.length; i++) {
        if (days[i]) {
            mask |= (1 << i);
        }
    }
    return mask;
}

/**
 * Compute which garbage bag icon to show based on current time and settings.
 * After the configured pickup hour, shows the next day's collection type.
 * @param {Object} settings - App settings with GARBAGE_PICKUP_TIME, GARBAGE_ORGANIC_DAYS, etc.
 * @returns {number} GARBAGE_BAG_NONE/ORGANIC/GREY/BLACK
 */
function computeGarbageBag(settings) {
    var now = new Date();
    var wday = (now.getDay() + 6) % 7;
    var pickupHour = parseInt(settings.GARBAGE_PICKUP_TIME, 10);
    if (isNaN(pickupHour)) pickupHour = 9;

    if (now.getHours() >= pickupHour) {
        wday = (wday + 1) % 7;
    }

    var organicMask = daysToBitmask(settings.GARBAGE_ORGANIC_DAYS);
    var greyMask    = daysToBitmask(settings.GARBAGE_GREY_DAYS);
    var blackMask   = daysToBitmask(settings.GARBAGE_BLACK_DAYS);

    if (organicMask & (1 << wday)) return GARBAGE_BAG_ORGANIC;
    if (greyMask    & (1 << wday)) return GARBAGE_BAG_GREY;
    if (blackMask   & (1 << wday)) return GARBAGE_BAG_BLACK;
    return GARBAGE_BAG_NONE;
}

module.exports = {
    GARBAGE_BAG_NONE: GARBAGE_BAG_NONE,
    GARBAGE_BAG_ORGANIC: GARBAGE_BAG_ORGANIC,
    GARBAGE_BAG_GREY: GARBAGE_BAG_GREY,
    GARBAGE_BAG_BLACK: GARBAGE_BAG_BLACK,
    daysToBitmask: daysToBitmask,
    computeGarbageBag: computeGarbageBag
};
