// Astronomy time calculation utilities
// Handles sunrise/sunset and moonrise/moonset time selection logic,
// determining which event to show next based on current time of day.

/**
 * Parse time string in HH:MM format to minutes since midnight
 * @param {string} timeStr - Time in HH:MM format or 'N/A'
 * @returns {number|null} Minutes since midnight or null if invalid
 */
function timeToMinutes(timeStr) {
    if (!timeStr || timeStr.includes('N/A')) {
        return null;
    }
    
    var parts = timeStr.split(':');
    if (parts.length !== 2) return null;
    
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    
    return (isNaN(hours) || isNaN(minutes)) ? null : (hours * 60 + minutes);
}

/**
 * Get current time in minutes since midnight
 * @returns {number} Current minutes since midnight
 */
function getCurrentTimeInMinutes() {
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}

/**
 * Determine which sun time to display (sunrise or sunset).
 * Shows the next upcoming event; if all events have passed today,
 * signals that tomorrow's sunrise is needed.
 * @param {string} sunrise - Sunrise time (HH:MM or N/A)
 * @param {string} sunset - Sunset time (HH:MM or N/A)
 * @returns {Object} { time: string, needsTomorrowData: boolean }
 */
function getNextSunEvent(sunrise, sunset) {
    var sunriseMinutes = timeToMinutes(sunrise);
    var sunsetMinutes = timeToMinutes(sunset);
    var currentMinutes = getCurrentTimeInMinutes();
    
    if (sunriseMinutes === null && sunsetMinutes === null) {
        return { time: sunrise, needsTomorrowData: false, isRising: true };
    }
    
    if (sunriseMinutes !== null && sunsetMinutes === null) {
        if (currentMinutes < sunriseMinutes) {
            return { time: sunrise, needsTomorrowData: false, isRising: true };
        }
        return { time: sunrise, needsTomorrowData: true, isRising: true };
    }
    
    if (sunriseMinutes === null && sunsetMinutes !== null) {
        if (currentMinutes < sunsetMinutes) {
            return { time: sunset, needsTomorrowData: false, isRising: false };
        }
        return { time: sunset, needsTomorrowData: false, isRising: false };
    }
    
    // Both times available
    if (currentMinutes < sunriseMinutes) {
        return { time: sunrise, needsTomorrowData: false, isRising: true };
    } else if (currentMinutes < sunsetMinutes) {
        return { time: sunset, needsTomorrowData: false, isRising: false };
    } else {
        return { time: sunrise, needsTomorrowData: true, isRising: true };
    }
}

/**
 * Determine which moon time to display (moonrise or moonset).
 * Handles both normal order (rise before set) and inverted order (set before rise).
 * @param {string} moonrise - Moonrise time (HH:MM or N/A)
 * @param {string} moonset - Moonset time (HH:MM or N/A)
 * @returns {Object} { time: string, needsTomorrowData: boolean }
 */
function getNextMoonEvent(moonrise, moonset) {
    var moonriseMinutes = timeToMinutes(moonrise);
    var moonsetMinutes = timeToMinutes(moonset);
    var currentMinutes = getCurrentTimeInMinutes();
    
    if (moonriseMinutes === null && moonsetMinutes === null) {
        return { time: moonset, needsTomorrowData: true, isRising: false };
    }
    
    if (moonriseMinutes !== null && moonsetMinutes === null) {
        if (currentMinutes < moonriseMinutes) {
            return { time: moonrise, needsTomorrowData: false, isRising: true };
        }
        return { time: moonrise, needsTomorrowData: true, isRising: true };
    }
    
    if (moonriseMinutes === null && moonsetMinutes !== null) {
        if (currentMinutes < moonsetMinutes) {
            return { time: moonset, needsTomorrowData: false, isRising: false };
        }
        return { time: moonset, needsTomorrowData: true, isRising: false };
    }
    
    // Both times available
    if (moonriseMinutes < moonsetMinutes) {
        // Normal: moonrise before moonset
        if (currentMinutes < moonriseMinutes) {
            return { time: moonrise, needsTomorrowData: false, isRising: true };
        } else if (currentMinutes < moonsetMinutes) {
            return { time: moonset, needsTomorrowData: false, isRising: false };
        } else {
            return { time: moonset, needsTomorrowData: true, isRising: true };
        }
    } else {
        // Inverted: moonset before moonrise (e.g. moonset just after midnight)
        if (currentMinutes < moonsetMinutes) {
            return { time: moonset, needsTomorrowData: false, isRising: false };
        } else if (currentMinutes < moonriseMinutes) {
            return { time: moonrise, needsTomorrowData: false, isRising: true };
        } else {
            return { time: moonrise, needsTomorrowData: true, isRising: false };
        }
    }
}

/**
 * Convert moon phase string from ipgeolocation.io API to numeric index
 * @param {string} moonPhase - Moon phase name (e.g. "Full Moon", "Waxing Crescent")
 * @returns {number} Moon phase index (0-7): 0=New, 1=WaxCres, 2=FirstQ,
 *                   3=WaxGib, 4=Full, 5=WanGib, 6=ThirdQ, 7=WanCres
 */
function moonPhaseToIndex(moonPhase) {
    if (!moonPhase) return 0;
    var phase = moonPhase.toUpperCase().replace(/ /g, '_');
    var phases = {
        'NEW_MOON': 0,
        'WAXING_CRESCENT': 1,
        'FIRST_QUARTER': 2,
        'WAXING_GIBBOUS': 3,
        'FULL_MOON': 4,
        'WANING_GIBBOUS': 5,
        'THIRD_QUARTER': 6,
        'LAST_QUARTER': 6,
        'WANING_CRESCENT': 7
    };
    return phases.hasOwnProperty(phase) ? phases[phase] : 0;
}

/**
 * Extract and format the next sun/moon events from astronomy API data
 * @param {Object} astroData - Astronomy data with sunrise, sunset, moonrise, moonset, moonPhase
 * @returns {Object} { sunTime, moonTime, moonPhase, needsTomorrowSunData, needsTomorrowMoonData, sunIsRising, moonIsRising }
 */
function formatAstronomyTimes(astroData) {
    var sunResult = getNextSunEvent(astroData.sunrise, astroData.sunset);
    var moonResult = getNextMoonEvent(astroData.moonrise, astroData.moonset);
    
    return {
        sunTime: sunResult.time,
        moonTime: moonResult.time,
        moonPhase: moonPhaseToIndex(astroData.moonPhase),
        needsTomorrowSunData: sunResult.needsTomorrowData,
        needsTomorrowMoonData: moonResult.needsTomorrowData,
        sunIsRising: sunResult.isRising,
        moonIsRising: moonResult.isRising
    };
}

/**
 * Build a cache-friendly object from today's astronomy data
 * @param {Object} astroData - Today's astronomy API response
 * @returns {Object} Cache object with tomorrow fields initialized to null
 */
function buildAstronomyCache(astroData) {
    return {
        sunrise: astroData.sunrise,
        sunset: astroData.sunset,
        moonrise: astroData.moonrise,
        moonset: astroData.moonset,
        moonPhase: astroData.moonPhase,
        tomorrowSunrise: null,
        tomorrowMoonrise: null,
        tomorrowMoonset: null
    };
}

/**
 * Get tomorrow's date string in YYYY-MM-DD format (for API requests)
 * @returns {string} Tomorrow's date
 */
function getTomorrowDateString() {
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    var year = tomorrow.getFullYear();
    var month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    var day = String(tomorrow.getDate()).padStart(2, '0');
    
    return year + '-' + month + '-' + day;
}

/**
 * Determine which tomorrow moon event is needed based on today's event order.
 * This eliminates the duplicated logic that was in both cached and fresh data paths.
 * @param {string} moonrise - Today's moonrise time
 * @param {string} moonset - Today's moonset time
 * @returns {Object} { needMoonrise: boolean, needMoonset: boolean }
 */
function determineTomorrowMoonEvent(moonrise, moonset) {
    var moonriseMinutes = timeToMinutes(moonrise);
    var moonsetMinutes = timeToMinutes(moonset);
    
    if (moonriseMinutes !== null && moonsetMinutes === null) {
        return { needMoonrise: true, needMoonset: false };
    }
    if (moonriseMinutes === null && moonsetMinutes !== null) {
        return { needMoonrise: false, needMoonset: true };
    }
    if (moonriseMinutes !== null && moonsetMinutes !== null) {
        if (moonriseMinutes < moonsetMinutes) {
            // Normal order: after moonset, need tomorrow's moonrise
            return { needMoonrise: true, needMoonset: false };
        } else {
            // Inverted order: after moonrise, need tomorrow's moonset
            return { needMoonrise: false, needMoonset: true };
        }
    }
    return { needMoonrise: false, needMoonset: false };
}

// Export all public functions
module.exports = {
    timeToMinutes: timeToMinutes,
    getCurrentTimeInMinutes: getCurrentTimeInMinutes,
    getNextSunEvent: getNextSunEvent,
    getNextMoonEvent: getNextMoonEvent,
    moonPhaseToIndex: moonPhaseToIndex,
    formatAstronomyTimes: formatAstronomyTimes,
    buildAstronomyCache: buildAstronomyCache,
    getTomorrowDateString: getTomorrowDateString,
    determineTomorrowMoonEvent: determineTomorrowMoonEvent
};
