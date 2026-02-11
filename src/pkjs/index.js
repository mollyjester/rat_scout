var Dexcom = require('./dexcom');
var Geolocation = require('./geolocation');
var Weather = require('./weather');
var Clay = require('pebble-clay');
var clayConfig = require('./config.json');
var clay = new Clay(clayConfig);
var appSettings = {};

var debug = false;

// Configuration constants
var CONFIG = {
    GLUCOSE_THRESHOLDS: {
        LOW: 70,
        HIGH: 180
    },
    TIME_CACHE_KEYS: {
        ASTRONOMY_DATA: 'cachedAstronomyData',
        ASTRONOMY_FETCH_TIME: 'lastAstronomyFetchTime',
        WEATHER_DATA: 'cachedWeatherData',
        WEATHER_FETCH_TIME: 'lastWeatherFetchTime'
    },
    STORAGE_KEYS: {
        ACCOUNT_ID: 'accountId',
        SESSION_ID: 'sessionId'
    },
    DEFAULT_BG_UNITS: 'mg/dL',
    MMOL_CONVERSION_FACTOR: 18.0182,
    MAX_FETCH_RETRIES: 2,
    REQUEST_TIMEOUT_MS: 15000,
    DEFAULT_WEATHER_INTERVAL_MIN: 60
};

/**
 * Load settings from local storage with error handling
 * @returns {Object} Settings object
 */
function getSettings() {
    try {
        return JSON.parse(window.localStorage.getItem('clay-settings')) || {};
    } catch (e) {
        console.error(`Error parsing settings: ${e.message}`);
        return {};
    }
}

/**
 * Message queue to prevent concurrent sendAppMessage calls.
 * Pebble can only handle one in-flight message at a time.
 */
var messageQueue = [];
var isSending = false;

/**
 * Process the next message in the queue
 */
function processMessageQueue() {
    if (isSending || messageQueue.length === 0) return;
    
    isSending = true;
    var msg = messageQueue.shift();
    
    Pebble.sendAppMessage(msg.dictionary,
        function() {
            console.log(msg.messageType + ' sent to Pebble successfully');
            isSending = false;
            processMessageQueue();
        },
        function() {
            console.error('Error sending ' + msg.messageType + ' to Pebble');
            isSending = false;
            processMessageQueue();
        }
    );
}

/**
 * Helper to send message to Pebble with consistent error handling.
 * Messages are queued to avoid concurrent sendAppMessage calls.
 * @param {Object} dictionary - Data to send
 * @param {string} messageType - Type of message for logging
 */
function sendToPebble(dictionary, messageType) {
    messageType = messageType || 'data';
    
    messageQueue.push({ dictionary: dictionary, messageType: messageType });
    processMessageQueue();
}

/**
 * Build and send settings to the watchface
 */
function sendSettings() {
    var dictionary = {
        "BG_SHOW_DELTA": appSettings.BG_SHOW_DELTA ? 1 : 0,
        "BG_SHOW_TIMEDELTA": appSettings.BG_SHOW_TIMEDELTA ? 1 : 0,
        "BG_UNITS": appSettings.BG_UNITS || CONFIG.DEFAULT_BG_UNITS,
        "HOURLY_VIBRATION": appSettings.HOURLY_VIBRATION ? 1 : 0,
        "BG_VIBRATION": appSettings.BG_VIBRATION ? 1 : 0,
        "BG_LOW_THRESHOLD": Math.round((parseFloat(appSettings.BG_LOW_THRESHOLD) || 0) * 10),
        "BG_HIGH_THRESHOLD": Math.round((parseFloat(appSettings.BG_HIGH_THRESHOLD) || 0) * 10),
        "ASTRO_API_KEY": appSettings.ASTRO_API_KEY || ""
    };
    
    sendToPebble(dictionary, 'Settings');
}

/**
 * Fetch web data (glucose reading and astronomy data)
 * @param {boolean} isTestMode - Whether to use test data
 */
function fetchWebData(isTestMode) {
    if (isTestMode) {
        console.log('Debug mode enabled, using test data');
        getScoutReadingTest();
    } else {
        getScoutReading();
    }
    // Fetch weather independently (sent as separate message)
    fetchAndSendWeather();
}

// Listen for when the watchface is opened
Pebble.addEventListener('ready', function() {
    console.log('PebbleKit JS ready!');
    appSettings = getSettings();
    sendSettings();
    fetchWebData(debug);
});

// Listen for AppMessage from watchface
Pebble.addEventListener('appmessage', function() {
    console.log('AppMessage received!');
    appSettings = getSettings();
    fetchWebData(debug);
});

// Listen for when the settings form is closed (saved)
Pebble.addEventListener('webviewclosed', function() {
    console.log('Settings form closed');
    appSettings = getSettings();
    sendSettings();
    fetchWebData(debug);
});

/**
 * Format blood glucose value based on units
 * @param {number} value - Raw value
 * @param {string} units - 'mg/dL' or 'mmol/L'
 * @returns {string} Formatted value
 */
function formatBGValue(value, units) {
    if (units === 'mmol/L') {
        return (value / CONFIG.MMOL_CONVERSION_FACTOR).toFixed(1);
    }
    return value;
}

/**
 * Format BG delta with sign
 * @param {number} delta - Delta value
 * @param {string} units - Blood glucose units
 * @returns {string} Formatted delta
 */
function formatBGDelta(delta, units) {
    var formatted = units === 'mmol/L' 
        ? (delta / CONFIG.MMOL_CONVERSION_FACTOR).toFixed(1) 
        : delta;
    return formatted > 0 ? `+${formatted}` : formatted;
}

/**
 * Build glucose data dictionary from reading
 * @param {Object} result - Dexcom result object
 * @param {Object} settings - App settings
 * @returns {Object} Dictionary to send to Pebble
 */
function buildGlucoseDictionary(result, settings) {
    var bgUnits = settings.BG_UNITS || CONFIG.DEFAULT_BG_UNITS;
    var readingTimestamp = Math.floor(result.current._datetime.getTime() / 1000);
    
    return {
        "BG_UNITS": bgUnits,
        "BG_SHOW_DELTA": settings.BG_SHOW_DELTA ? 1 : 0,
        "BG_SHOW_TIMEDELTA": settings.BG_SHOW_TIMEDELTA ? 1 : 0,
        "BG": formatBGValue(result.current._value, bgUnits),
        "BGDELTA": formatBGDelta(result.current._delta, bgUnits),
        "TIMEDELTA": result.current._delta_time,
        "TIMESTAMP": readingTimestamp
    };
}

/**
 * Fetch glucose reading from Dexcom
 */
function getScoutReading() {
    console.log('Getting glucose reading');

    if (!appSettings || !appSettings.DEX_LOGIN || !appSettings.DEX_PASSWORD) {
        console.error('No Dexcom login credentials configured');
        return;
    }

    var accountId = window.localStorage.getItem(CONFIG.STORAGE_KEYS.ACCOUNT_ID);
    var sessionId = window.localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_ID);
    
    var dex = new Dexcom(
        appSettings.DEX_LOGIN,
        appSettings.DEX_PASSWORD,
        function(result) {
            console.log(`Current WT: ${result.current._json.WT}`);
            
            var dictionary = buildGlucoseDictionary(result, appSettings);
            
            // Cache session IDs for faster subsequent requests
            window.localStorage.setItem(CONFIG.STORAGE_KEYS.ACCOUNT_ID, dex.accountId);
            window.localStorage.setItem(CONFIG.STORAGE_KEYS.SESSION_ID, dex.sessionId);

            // Fetch and combine astronomy data
            fetchAndSendAstronomy(dictionary);
        }
    );

    if (accountId && sessionId) {
        dex.accountId = accountId;
        dex.sessionId = sessionId;
    }

    try {
        dex.getLatestGlucoseWithDelta();
    } catch (error) {
        console.error(`Error fetching glucose: ${error.message || error}`);
    }
}

/**
 * Check if astronomy data needs refresh (once per day at midnight)
 * @returns {boolean} True if data should be refreshed
 */
function shouldRefreshAstronomyData() {
    var lastFetchTime = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_FETCH_TIME);
    
    if (!lastFetchTime) {
        console.log('No cached astronomy data found');
        return true;
    }
    
    var lastFetchDate = new Date(parseInt(lastFetchTime));
    var nowDate = new Date();
    
    // Check if date has changed (we've passed midnight)
    var hasDayChanged = lastFetchDate.toDateString() !== nowDate.toDateString();
    if (hasDayChanged) {
        console.log('Day has changed, refreshing astronomy data');
    }
    return hasDayChanged;
}

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
 * Determine which sun time to display (sunrise or sunset)
 * @param {string} sunrise - Sunrise time (HH:MM or N/A)
 * @param {string} sunset - Sunset time (HH:MM or N/A)
 * @returns {Object} { time: string, needsTomorrowData: boolean }
 */
function getSunTime(sunrise, sunset) {
    var sunriseMinutes = timeToMinutes(sunrise);
    var sunsetMinutes = timeToMinutes(sunset);
    var currentMinutes = getCurrentTimeInMinutes();
    
    // If we don't have valid times, don't fetch tomorrow (likely N/A there too)
    if (sunriseMinutes === null && sunsetMinutes === null) {
        return { time: sunrise, needsTomorrowData: false };
    }
    
    // If we only have sunrise, check if it's passed
    if (sunriseMinutes !== null && sunsetMinutes === null) {
        if (currentMinutes < sunriseMinutes) {
            return { time: sunrise, needsTomorrowData: false };
        }
        // After sunrise but no sunset data - need tomorrow's sunrise
        return { time: sunrise, needsTomorrowData: true };
    }
    
    // If we only have sunset, check if it's passed
    if (sunriseMinutes === null && sunsetMinutes !== null) {
        if (currentMinutes < sunsetMinutes) {
            return { time: sunset, needsTomorrowData: false };
        }
        // After sunset but no sunrise data - can't get tomorrow's sunrise
        return { time: sunset, needsTomorrowData: false };
    }
    
    // Both times are available (normal case)
    // Sunrise is always before sunset in a day
    if (currentMinutes < sunriseMinutes) {
        // Before sunrise - show sunrise
        return { time: sunrise, needsTomorrowData: false };
    } else if (currentMinutes < sunsetMinutes) {
        // Between sunrise and sunset - show sunset
        return { time: sunset, needsTomorrowData: false };
    } else {
        // After sunset - need tomorrow's sunrise
        return { time: sunrise, needsTomorrowData: true };
    }
}

/**
 * Determine which moon time to display (moonrise or moonset)
 * @param {string} moonrise - Moonrise time
 * @param {string} moonset - Moonset time
 * @returns {Object} { time: string, needsTomorrowData: boolean }
 */
function getMoonTime(moonrise, moonset) {
    var moonriseMinutes = timeToMinutes(moonrise);
    var moonsetMinutes = timeToMinutes(moonset);
    var currentMinutes = getCurrentTimeInMinutes();
    
    // If we don't have valid times, default to showing moonset with tomorrow flag
    // Note: The caller will handle displaying "N/A" if moonset is also invalid
    if (moonriseMinutes === null && moonsetMinutes === null) {
        return { time: moonset, needsTomorrowData: true };
    }
    
    // If we only have moonrise, check if it's passed
    if (moonriseMinutes !== null && moonsetMinutes === null) {
        if (currentMinutes < moonriseMinutes) {
            return { time: moonrise, needsTomorrowData: false };
        }
        return { time: moonrise, needsTomorrowData: true };
    }
    
    // If we only have moonset, check if it's passed
    if (moonriseMinutes === null && moonsetMinutes !== null) {
        if (currentMinutes < moonsetMinutes) {
            return { time: moonset, needsTomorrowData: false };
        }
        return { time: moonset, needsTomorrowData: true };
    }
    
    // Both times are available
    // Case 1: Moonrise comes before moonset (normal case)
    if (moonriseMinutes < moonsetMinutes) {
        if (currentMinutes < moonriseMinutes) {
            // Before moonrise - show moonrise
            return { time: moonrise, needsTomorrowData: false };
        } else if (currentMinutes < moonsetMinutes) {
            // Between moonrise and moonset - show moonset
            return { time: moonset, needsTomorrowData: false };
        } else {
            // After moonset - need tomorrow's moonrise
            return { time: moonset, needsTomorrowData: true };
        }
    }
    
    // Case 2: Moonset comes before moonrise (less common)
    // This happens when moonset is just after midnight and moonrise is later
    else {
        if (currentMinutes < moonsetMinutes) {
            // Before moonset (early morning) - show moonset
            return { time: moonset, needsTomorrowData: false };
        } else if (currentMinutes < moonriseMinutes) {
            // Between moonset and moonrise - show moonrise
            return { time: moonrise, needsTomorrowData: false };
        } else {
            // After moonrise - need tomorrow's moonset
            return { time: moonrise, needsTomorrowData: true };
        }
    }
}

/**
 * Get tomorrow's date string (YYYY-MM-DD format)
 * @returns {string} Tomorrow's date
 */
function getTomorrowDateString() {
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    var year = tomorrow.getFullYear();
    var month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    var day = String(tomorrow.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

/**
 * Extract and format sun/moon times from astronomy data
 * @param {Object} astroData - Astronomy data object
 * @returns {Object} { sunTime: string, moonTime: string, needsTomorrowSunData: boolean, needsTomorrowMoonData: boolean }
 */
function formatAstronomyTimes(astroData) {
    var sunTimeResult = getSunTime(astroData.sunrise, astroData.sunset);
    var moonTimeResult = getMoonTime(astroData.moonrise, astroData.moonset);
    
    return {
        sunTime: sunTimeResult.time,
        moonTime: moonTimeResult.time,
        needsTomorrowSunData: sunTimeResult.needsTomorrowData,
        needsTomorrowMoonData: moonTimeResult.needsTomorrowData
    };
}

/**
 * Build cache object from astronomy data
 * @param {Object} astroData - Today's astronomy data
 * @returns {Object} Cache data
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
 * Cache astronomy data with timestamp
 * @param {Object} cacheData - Data to cache
 */
function cacheAstronomyData(cacheData) {
    window.localStorage.setItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_DATA, JSON.stringify(cacheData));
    window.localStorage.setItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_FETCH_TIME, String(Date.now()));
}

/**
 * Load and use cached astronomy data
 * @param {Object} bgDictionary - BG data to supplement
 * @returns {boolean} True if cache was successfully used, false if fresh data is needed
 */
function useCachedAstronomyData(bgDictionary) {
    var cachedData = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_DATA);
    
    if (!cachedData) {
        console.log('No cached astronomy data available');
        bgDictionary.SUNTIME = "N/A";
        bgDictionary.MOONTIME = "N/A";
        sendToPebble(bgDictionary, 'BG (no cache)');
        return false;
    }
    
    try {
        var astroData = JSON.parse(cachedData);
        // Extract sun and moon times from cached TODAY's data
        var times = formatAstronomyTimes(astroData);
        
        // Check if we need tomorrow's sun data
        if (times.needsTomorrowSunData && !astroData.tomorrowSunrise) {
            console.log('Cache missing tomorrow sunrise data, need fresh fetch');
            return false;
        }
        
        // Initialize variables for determining which tomorrow moon event we need
        var moonriseMinutes = null;
        var moonsetMinutes = null;
        var needTomorrowMoonrise = false;
        var needTomorrowMoonset = false;
        
        if (times.needsTomorrowMoonData) {
            // Calculate moon time minutes for comparison
            moonriseMinutes = timeToMinutes(astroData.moonrise);
            moonsetMinutes = timeToMinutes(astroData.moonset);
            
            // Determine which tomorrow event we need based on today's event order
            // This logic mirrors getMoonTime() to ensure consistency
            
            if (moonriseMinutes !== null && moonsetMinutes === null) {
                // Only have moonrise, if it passed we need tomorrow's moonrise
                needTomorrowMoonrise = true;
            } else if (moonriseMinutes === null && moonsetMinutes !== null) {
                // Only have moonset, if it passed we need tomorrow's moonset
                needTomorrowMoonset = true;
            } else if (moonriseMinutes !== null && moonsetMinutes !== null) {
                // Have both - check the order
                if (moonriseMinutes < moonsetMinutes) {
                    // Normal case: moonrise before moonset, need tomorrow's moonrise
                    needTomorrowMoonrise = true;
                } else {
                    // Edge case: moonset before moonrise, need tomorrow's moonset
                    needTomorrowMoonset = true;
                }
            }
            
            // If we need tomorrow's data but don't have it cached, return false to trigger fresh fetch
            if (needTomorrowMoonrise && !astroData.tomorrowMoonrise) {
                console.log('Cache missing tomorrow moonrise data, need fresh fetch');
                return false;
            }
            if (needTomorrowMoonset && !astroData.tomorrowMoonset) {
                console.log('Cache missing tomorrow moonset data, need fresh fetch');
                return false;
            }
            
            // Update ONLY moonTime with tomorrow's data
            if (needTomorrowMoonrise && astroData.tomorrowMoonrise) {
                times.moonTime = astroData.tomorrowMoonrise;
            } else if (needTomorrowMoonset && astroData.tomorrowMoonset) {
                times.moonTime = astroData.tomorrowMoonset;
            }
        }
        
        // Update sunTime with tomorrow's data if needed
        if (times.needsTomorrowSunData && astroData.tomorrowSunrise) {
            times.sunTime = astroData.tomorrowSunrise;
        }
        
        bgDictionary.SUNTIME = times.sunTime || "N/A";
        bgDictionary.MOONTIME = times.moonTime || "N/A";
        
        console.log('Using cached astronomy data');
        sendToPebble(bgDictionary, 'BG with cached astronomy');
        return true;
    } catch (e) {
        console.error(`Error parsing cached data: ${e.message}`);
        bgDictionary.SUNTIME = "N/A";
        bgDictionary.MOONTIME = "N/A";
        sendToPebble(bgDictionary, 'BG (cache error)');
        return false;
    }
}

/**
 * Handle successful astronomy data fetch
 * @param {Object} todayData - Today's astronomy data
 * @param {Object} bgDictionary - BG data to supplement
 * @param {string} apiKey - API key for subsequent requests
 * @param {number} attemptCount - Retry counter to prevent infinite loops
 */
function handleTodayAstronomyData(todayData, bgDictionary, apiKey, attemptCount) {
    attemptCount = attemptCount || 0;
    
    // Extract sun and moon times from TODAY's data
    var times = formatAstronomyTimes(todayData);
    var cacheData = buildAstronomyCache(todayData);
    
    // Check if we need tomorrow's data for either sun or moon times
    if (times.needsTomorrowSunData || times.needsTomorrowMoonData) {
        console.log('Fetching tomorrow astronomy data');
        
        var tomorrowDate = getTomorrowDateString();
        Geolocation.fetchAstronomyData(apiKey, undefined, undefined, tomorrowDate,
            function(tomorrowData) {
                // Cache tomorrow's sunrise if needed
                if (times.needsTomorrowSunData) {
                    cacheData.tomorrowSunrise = tomorrowData.sunrise;
                    if (tomorrowData.sunrise && !tomorrowData.sunrise.includes('N/A')) {
                        times.sunTime = tomorrowData.sunrise;
                        console.log(`Using tomorrow sunrise: ${times.sunTime}`);
                    }
                }
                
                // Cache tomorrow's moon data if needed
                if (times.needsTomorrowMoonData) {
                    cacheData.tomorrowMoonrise = tomorrowData.moonrise;
                    cacheData.tomorrowMoonset = tomorrowData.moonset;
                    
                    // Determine which tomorrow event to show based on today's event order
                    // This logic mirrors getMoonTime() to ensure consistency
                    var moonriseMinutes = timeToMinutes(todayData.moonrise);
                    var moonsetMinutes = timeToMinutes(todayData.moonset);
                    
                    var needTomorrowMoonrise = false;
                    var needTomorrowMoonset = false;
                    
                    if (moonriseMinutes !== null && moonsetMinutes === null) {
                        // Only have moonrise, if it passed we need tomorrow's moonrise
                        needTomorrowMoonrise = true;
                    } else if (moonriseMinutes === null && moonsetMinutes !== null) {
                        // Only have moonset, if it passed we need tomorrow's moonset
                        needTomorrowMoonset = true;
                    } else if (moonriseMinutes !== null && moonsetMinutes !== null) {
                        // Have both - check the order
                        if (moonriseMinutes < moonsetMinutes) {
                            // Normal case: moonrise before moonset, need tomorrow's moonrise
                            needTomorrowMoonrise = true;
                        } else {
                            // Edge case: moonset before moonrise, need tomorrow's moonset
                            needTomorrowMoonset = true;
                        }
                    }
                    
                    // Update moonTime with tomorrow's data
                    if (needTomorrowMoonrise && tomorrowData.moonrise && !tomorrowData.moonrise.includes('N/A')) {
                        times.moonTime = tomorrowData.moonrise;
                        console.log(`Using tomorrow moonrise: ${times.moonTime}`);
                    } else if (needTomorrowMoonset && tomorrowData.moonset && !tomorrowData.moonset.includes('N/A')) {
                        times.moonTime = tomorrowData.moonset;
                        console.log(`Using tomorrow moonset: ${times.moonTime}`);
                    }
                }
                
                cacheAstronomyData(cacheData);
                completeAstronomyUpdate(bgDictionary, times);
            },
            function(error) {
                console.log(`Error fetching tomorrow data (attempt ${attemptCount + 1}): ${error}`);
                
                // Limit retries for tomorrow data to prevent infinite loops
                if (attemptCount < 1) {
                    console.log('Retrying tomorrow data fetch...');
                    handleTodayAstronomyData(todayData, bgDictionary, apiKey, attemptCount + 1);
                } else {
                    console.log('Max retries for tomorrow data reached, using today data');
                    cacheAstronomyData(cacheData);
                    completeAstronomyUpdate(bgDictionary, times);
                }
            }
        );
    } else {
        // No need for tomorrow's data
        cacheAstronomyData(cacheData);
        completeAstronomyUpdate(bgDictionary, times);
    }
}

/**
 * Complete astronomy data update and send to Pebble
 * @param {Object} bgDictionary - BG data
 * @param {Object} times - Formatted sun/moon times
 */
function completeAstronomyUpdate(bgDictionary, times) {
    bgDictionary.SUNTIME = times.sunTime || "N/A";
    bgDictionary.MOONTIME = times.moonTime || "N/A";
    sendToPebble(bgDictionary, 'BG with astronomy');
}

/**
 * Fetch astronomy data and combine with glucose data before sending to watchface
 * @param {Object} bgDictionary - Blood glucose data to supplement
 * @param {number} attemptCount - Internal retry counter (starts at 0)
 */
function fetchAndSendAstronomy(bgDictionary, attemptCount) {
    attemptCount = attemptCount || 0;
    
    console.log('Processing astronomy data (attempt ' + (attemptCount + 1) + ')');
    
    var apiKey = appSettings.ASTRO_API_KEY;
    
    // If no API key, send BG data only
    if (!apiKey) {
        console.log('No astronomy API key configured, sending BG only');
        bgDictionary.SUNTIME = "N/A";
        bgDictionary.MOONTIME = "N/A";
        sendToPebble(bgDictionary, 'BG (no API key)');
        return;
    }
    
    // Check if we need fresh data
    if (!shouldRefreshAstronomyData()) {
        console.log('Checking cached astronomy data');
        var cacheUsed = useCachedAstronomyData(bgDictionary);
        
        // If cache didn't have tomorrow's data when needed, fetch fresh data
        if (!cacheUsed) {
            console.log('Cache incomplete, fetching fresh astronomy data');
        } else {
            return;
        }
    }
    
    // Fetch fresh astronomy data with retry tracking
    console.log('Fetching fresh astronomy data from API');
    Geolocation.fetchAstronomyData(apiKey, undefined, undefined,
        function(todayData) {
            console.log('Today astronomy data received');
            // Reset retry counter on success
            attemptCount = 0;
            handleTodayAstronomyData(todayData, bgDictionary, apiKey);
        },
        function(error) {
            console.log(`Error fetching astronomy (attempt ${attemptCount + 1}): ${error}`);
            
            // Limit retries to prevent infinite loops
            if (attemptCount < CONFIG.MAX_FETCH_RETRIES) {
                console.log(`Will retry astronomy fetch (${CONFIG.MAX_FETCH_RETRIES - attemptCount - 1} attempts remaining)`);
                // Retry after 2 second delay to allow network recovery
                setTimeout(function() {
                    fetchAndSendAstronomy(bgDictionary, attemptCount + 1);
                }, 2000);
            } else {
                console.log(`Max retries reached (${CONFIG.MAX_FETCH_RETRIES}), falling back to cache`);
                useCachedAstronomyData(bgDictionary);
            }
        }
    );
}

/**
 * Fetch weather data from OpenWeatherMap and send to Pebble
 * Caches for 30 minutes to avoid excessive API calls and GPS lookups
 * @param {number} attemptCount - Internal retry counter
 */
function fetchAndSendWeather(attemptCount) {
    attemptCount = attemptCount || 0;
    
    var apiKey = appSettings.OWM_API_KEY;
    if (!apiKey) {
        console.log('No OpenWeatherMap API key configured, skipping weather');
        return;
    }
    
    // Check cache
    var cachedData = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.WEATHER_DATA);
    var lastFetchTime = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.WEATHER_FETCH_TIME);
    
    if (cachedData && lastFetchTime) {
        var elapsed = Date.now() - parseInt(lastFetchTime);
        var weatherIntervalMs = (parseInt(appSettings.WEATHER_INTERVAL) || CONFIG.DEFAULT_WEATHER_INTERVAL_MIN) * 60 * 1000;
        if (elapsed < weatherIntervalMs) {
            try {
                var cached = JSON.parse(cachedData);
                console.log('Using cached weather data');
                sendWeatherToPebble(cached);
                return;
            } catch (e) {
                console.error('Error parsing cached weather: ' + e.message);
            }
        }
    }
    
    var units = appSettings.WEATHER_UNITS || 'metric';
    
    console.log('Fetching fresh weather data (attempt ' + (attemptCount + 1) + ')');
    Weather.fetchWeatherData(apiKey, units,
        function(data) {
            // Cache weather data
            window.localStorage.setItem(CONFIG.TIME_CACHE_KEYS.WEATHER_DATA, JSON.stringify(data));
            window.localStorage.setItem(CONFIG.TIME_CACHE_KEYS.WEATHER_FETCH_TIME, String(Date.now()));
            sendWeatherToPebble(data);
        },
        function(error) {
            console.error('Weather fetch error (attempt ' + (attemptCount + 1) + '): ' + error);
            
            if (attemptCount < CONFIG.MAX_FETCH_RETRIES) {
                setTimeout(function() {
                    fetchAndSendWeather(attemptCount + 1);
                }, 2000);
            } else {
                console.log('Max weather retries reached, trying cached data');
                if (cachedData) {
                    try {
                        sendWeatherToPebble(JSON.parse(cachedData));
                    } catch (e) {
                        console.error('Error using expired weather cache: ' + e.message);
                    }
                }
            }
        }
    );
}

/**
 * Send weather data to Pebble watchface
 * @param {Object} data - Weather data { temp, windSpeed, needsUmbrella }
 */
function sendWeatherToPebble(data) {
    var dictionary = {
        "WEATHER_TEMP": String(data.temp),
        "WEATHER_WIND": String(data.windSpeed),
        "WEATHER_UMBRELLA": data.needsUmbrella ? 1 : 0
    };
    
    sendToPebble(dictionary, 'Weather');
}

/**
 * Get a test reading (for debugging)
 */
function getScoutReadingTest() {
    var readingTimestamp = (Date.now() - (4.3 * 60 * 1000)) / 1000;
    
    var dictionary = {
        "BG_UNITS": "mmol/L",
        "BG_SHOW_DELTA": 1,
        "BG_SHOW_TIMEDELTA": 0,
        "BG": (259.2 / CONFIG.MMOL_CONVERSION_FACTOR).toFixed(1),
        "BGDELTA": formatBGDelta(16.2, "mmol/L"),
        "TIMEDELTA": 1000,
        "TIMESTAMP": readingTimestamp
    };

    fetchAndSendAstronomy(dictionary);
}