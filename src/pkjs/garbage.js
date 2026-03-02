// Garbage collection schedule logic

var GARBAGE_BAG_NONE = 0;
var GARBAGE_BAG_ORGANIC = 1;
var GARBAGE_BAG_GREY = 2;
var GARBAGE_BAG_BLACK = 3;

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
