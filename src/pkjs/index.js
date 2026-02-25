var Dexcom = require('./dexcom');
var Geolocation = require('./geolocation');
var Weather = require('./weather');
var Astronomy = require('./astronomy');
var Clay = require('pebble-clay');
var clayConfig = require('./config.json');
var clay = new Clay(clayConfig);
var appSettings = {};

var designMode = false;

// Message type discriminators (Fix 6)
var MSG_TYPE_SETTINGS  = 0;
var MSG_TYPE_GLUCOSE   = 1;
var MSG_TYPE_WEATHER   = 2;
var MSG_TYPE_ASTRONOMY = 3;

// Retry cancellation guards (Fix 8)
var astronomyRetryPending = false;
var weatherRetryPending   = false;

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
        WEATHER_FETCH_TIME: 'lastWeatherFetchTime',
        WEATHER_LOCATION: 'lastWeatherLocation'
    },
    STORAGE_KEYS: {
        ACCOUNT_ID: 'accountId',
        SESSION_ID: 'sessionId'
    },
    DEFAULT_BG_UNITS: 'mg/dL',
    MMOL_CONVERSION_FACTOR: 18.0182,
    MAX_FETCH_RETRIES: 2,
    REQUEST_TIMEOUT_MS: 15000,
    DEFAULT_WEATHER_INTERVAL_MIN: 60,
    SIGNIFICANT_LOCATION_CHANGE_KM: 5,
    GEOLOCATION_MAX_AGE_MS: 300000
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

// Garbage bag type constants sent to C (matches status_bar_draw_proc expectations)
var GARBAGE_BAG_NONE = 0;
var GARBAGE_BAG_ORGANIC = 1;  // 'O'
var GARBAGE_BAG_GREY = 2;     // 'G'
var GARBAGE_BAG_BLACK = 3;    // 'B'

/**
 * Compute which garbage bag icon to underscore based on current time and settings.
 * After the configured pickup hour, shows the next day's collection type.
 * @returns {number} GARBAGE_BAG_NONE/ORGANIC/GREY/BLACK
 */
function computeGarbageBag() {
    var now = new Date();
    var wday = (now.getDay() + 6) % 7; // Convert 0=Sun..6=Sat to 0=Mon..6=Sun
    var pickupHour = parseInt(appSettings.GARBAGE_PICKUP_TIME, 10);
    if (isNaN(pickupHour)) pickupHour = 9;

    if (now.getHours() >= pickupHour) {
        wday = (wday + 1) % 7;
    }

    var organicMask = daysToBitmask(appSettings.GARBAGE_ORGANIC_DAYS);
    var greyMask    = daysToBitmask(appSettings.GARBAGE_GREY_DAYS);
    var blackMask   = daysToBitmask(appSettings.GARBAGE_BLACK_DAYS);

    if (organicMask & (1 << wday)) return GARBAGE_BAG_ORGANIC;
    if (greyMask    & (1 << wday)) return GARBAGE_BAG_GREY;
    if (blackMask   & (1 << wday)) return GARBAGE_BAG_BLACK;
    return GARBAGE_BAG_NONE;
}

/**
 * Check whether a settings value has been filled in (not empty/undefined).
 * @param {*} value - Settings value to check
 * @returns {boolean} True if value is present and non-empty
 */
function hasSettingValue(value) {
    return value !== undefined && value !== '';
}

/**
 * Check whether the current hour falls inside the configured night window.
 * Handles windows that cross midnight (e.g. start=22, end=7).
 * @returns {boolean} True if night thresholds are configured and currently active
 */
function isNightWindow() {
    var nightStart = parseInt(appSettings.BG_NIGHT_START, 10);
    var nightEnd = parseInt(appSettings.BG_NIGHT_END, 10);

    if (isNaN(nightStart) || isNaN(nightEnd)) return false;

    if (!hasSettingValue(appSettings.BG_NIGHT_LOW_THRESHOLD) &&
        !hasSettingValue(appSettings.BG_NIGHT_HIGH_THRESHOLD)) return false;

    var hour = new Date().getHours();

    if (nightStart <= nightEnd) {
        return hour >= nightStart && hour < nightEnd;
    }
    // Crosses midnight (e.g. 22 -> 7)
    return hour >= nightStart || hour < nightEnd;
}

/**
 * Build and send settings to the watchface
 */
function sendSettings() {
    var useNight = isNightWindow();

    var lowThreshold = useNight && hasSettingValue(appSettings.BG_NIGHT_LOW_THRESHOLD)
        ? appSettings.BG_NIGHT_LOW_THRESHOLD
        : appSettings.BG_LOW_THRESHOLD;

    var highThreshold = useNight && hasSettingValue(appSettings.BG_NIGHT_HIGH_THRESHOLD)
        ? appSettings.BG_NIGHT_HIGH_THRESHOLD
        : appSettings.BG_HIGH_THRESHOLD;

    var dictionary = {
        "MSG_TYPE": MSG_TYPE_SETTINGS,
        "BG_SHOW_DELTA": appSettings.BG_SHOW_DELTA ? 1 : 0,
        "BG_SHOW_TIMEDELTA": appSettings.BG_SHOW_TIMEDELTA ? 1 : 0,
        "BG_UNITS": appSettings.BG_UNITS || CONFIG.DEFAULT_BG_UNITS,
        "HOURLY_VIBRATION": appSettings.HOURLY_VIBRATION ? 1 : 0,
        "BG_VIBRATION": appSettings.BG_VIBRATION ? 1 : 0,
        "BG_LOW_THRESHOLD": Math.round((parseFloat(lowThreshold) || 0) * 10),
        "BG_HIGH_THRESHOLD": Math.round((parseFloat(highThreshold) || 0) * 10),
        "DATE_FORMAT": appSettings.DATE_FORMAT || "dd.mm",
        "GARBAGE_BAG": computeGarbageBag()
    };
    
    sendToPebble(dictionary, 'Settings');
}

/**
 * Send fixed data to the watchface for layout/design verification.
 * Populates every field with sensible placeholder values so all UI
 * elements are visible and can be inspected.
 */
function sendDesignModeData() {
    console.log('Design mode: sending fixed layout data');

    // Fixed settings
    var settingsDictionary = {
        "MSG_TYPE": MSG_TYPE_SETTINGS,
        "BG_SHOW_DELTA": 1,
        "BG_SHOW_TIMEDELTA": 1,
        "BG_UNITS": "mg/dL",
        "HOURLY_VIBRATION": 1,
        "BG_VIBRATION": 0,
        "BG_LOW_THRESHOLD": 700,
        "BG_HIGH_THRESHOLD": 1800,
        "DATE_FORMAT": "dd.mm",
        "GARBAGE_BAG": GARBAGE_BAG_ORGANIC
    };
    sendToPebble(settingsDictionary, 'Design settings');

    // Fixed BG
    var bgDictionary = {
        "MSG_TYPE": MSG_TYPE_GLUCOSE,
        "BG_UNITS": "mg/dL",
        "BG_SHOW_DELTA": 1,
        "BG_SHOW_TIMEDELTA": 1,
        "BG": "120",
        "BGDELTA": "+5",
        "TIMESTAMP": Math.floor((Date.now() - 4 * 60 * 1000) / 1000)
    };
    sendToPebble(bgDictionary, 'Design BG');

    // Fixed astronomy
    var astroDictionary = {
        "MSG_TYPE": MSG_TYPE_ASTRONOMY,
        "SUNTIME": "06:45",
        "MOONTIME": "21:30",
        "MOON_PHASE": 4,
        "SUN_IS_RISING": 1,
        "MOON_IS_RISING": 0
    };
    sendToPebble(astroDictionary, 'Design astronomy');

    // Fixed weather
    var weatherDictionary = {
        "MSG_TYPE": MSG_TYPE_WEATHER,
        "WEATHER_TEMP": "22",
        "WEATHER_WIND": "12",
        "WEATHER_UMBRELLA": 1
    };
    sendToPebble(weatherDictionary, 'Design weather');
}

/**
 * Fetch all watchface data (glucose reading and weather)
 */
function fetchAllData() {
    fetchGlucoseReading();
    // Fetch weather independently (sent as separate message)
    fetchAndSendWeather();
}

// Listen for when the watchface is opened
Pebble.addEventListener('ready', function() {
    console.log('PebbleKit JS ready!');
    if (designMode) {
        sendDesignModeData();
        return;
    }
    appSettings = getSettings();
    sendSettings();
    fetchAllData();
});

// Listen for AppMessage from watchface
Pebble.addEventListener('appmessage', function() {
    console.log('AppMessage received!');
    if (designMode) {
        sendDesignModeData();
        return;
    }
    appSettings = getSettings();
    sendSettings();
    fetchAllData();
});

// Listen for when the settings form is closed (saved)
Pebble.addEventListener('webviewclosed', function() {
    console.log('Settings form closed');
    if (designMode) {
        sendDesignModeData();
        return;
    }
    appSettings = getSettings();
    sendSettings();
    fetchAllData();
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
        ? (delta / CONFIG.MMOL_CONVERSION_FACTOR).toFixed(1) 
        : String(delta);
    return delta > 0 ? `+${formatted}` : formatted;
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
        "MSG_TYPE": MSG_TYPE_GLUCOSE,
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
 * Sets BG to "---" and timestamp to 0 so the C side shows stale state.
 */
function sendNoGlucoseData() {
    var dictionary = {
        "MSG_TYPE": MSG_TYPE_GLUCOSE,
        "BG": "---",
        "TIMESTAMP": 0
    };
    sendToPebble(dictionary, 'No glucose data');
}

/**
 * Fetch glucose reading from Dexcom Share API
 */
function fetchGlucoseReading() {
    console.log('Getting glucose reading');

    if (!appSettings || !appSettings.DEX_LOGIN || !appSettings.DEX_PASSWORD) {
        console.error('No Dexcom login credentials configured');
        sendNoGlucoseData();
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

            // Send BG data immediately without waiting for astronomy
            sendToPebble(dictionary, 'BG');

            // Fetch astronomy as a separate independent message
            fetchAndSendAstronomy();
        },
        appSettings.DEX_REGION,
        function(error) {
            console.error('Glucose fetch failed: ' + error);
            // Clear stale cached session to force full re-authentication on next attempt
            window.localStorage.removeItem(CONFIG.STORAGE_KEYS.ACCOUNT_ID);
            window.localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION_ID);
            sendNoGlucoseData();
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
        sendNoGlucoseData();
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
 * Cache astronomy data with timestamp
 * @param {Object} cacheData - Data to cache
 */
function cacheAstronomyData(cacheData) {
    window.localStorage.setItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_DATA, JSON.stringify(cacheData));
    window.localStorage.setItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_FETCH_TIME, String(Date.now()));
}

/**
 * Load and use cached astronomy data
 * @returns {boolean} True if cache was successfully used, false if fresh data is needed
 */
function useCachedAstronomyData() {
    var cachedData = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_DATA);
    
    if (!cachedData) {
        console.log('No cached astronomy data available');
        sendToPebble({
            "MSG_TYPE": MSG_TYPE_ASTRONOMY,
            "SUNTIME": "N/A",
            "MOONTIME": "N/A",
            "SUN_IS_RISING": 1,
            "MOON_IS_RISING": 1
        }, 'Astronomy (no cache)');
        return false;
    }
    
    try {
        var astroData = JSON.parse(cachedData);
        var times = Astronomy.formatAstronomyTimes(astroData);
        
        // Check if we need tomorrow's sun data
        if (times.needsTomorrowSunData && !astroData.tomorrowSunrise) {
            console.log('Cache missing tomorrow sunrise data, need fresh fetch');
            return false;
        }
        
        // Determine which tomorrow moon event is needed
        if (times.needsTomorrowMoonData) {
            var moonEvent = Astronomy.determineTomorrowMoonEvent(astroData.moonrise, astroData.moonset);
            
            if (moonEvent.needMoonrise && !astroData.tomorrowMoonrise) {
                console.log('Cache missing tomorrow moonrise data, need fresh fetch');
                return false;
            }
            if (moonEvent.needMoonset && !astroData.tomorrowMoonset) {
                console.log('Cache missing tomorrow moonset data, need fresh fetch');
                return false;
            }
            
            if (moonEvent.needMoonrise && astroData.tomorrowMoonrise) {
                times.moonTime = astroData.tomorrowMoonrise;
            } else if (moonEvent.needMoonset && astroData.tomorrowMoonset) {
                times.moonTime = astroData.tomorrowMoonset;
            }
        }
        
        // Update sunTime with tomorrow's data if needed
        if (times.needsTomorrowSunData && astroData.tomorrowSunrise) {
            times.sunTime = astroData.tomorrowSunrise;
        }
        
        console.log('Using cached astronomy data');
        sendToPebble({
            "MSG_TYPE": MSG_TYPE_ASTRONOMY,
            "SUNTIME": times.sunTime || "N/A",
            "MOONTIME": times.moonTime || "N/A",
            "MOON_PHASE": times.moonPhase !== undefined ? times.moonPhase : 0,
            "SUN_IS_RISING": times.sunIsRising ? 1 : 0,
            "MOON_IS_RISING": times.moonIsRising ? 1 : 0
        }, 'Astronomy (cached)');
        return true;
    } catch (e) {
        console.error(`Error parsing cached data: ${e.message}`);
        sendToPebble({
            "MSG_TYPE": MSG_TYPE_ASTRONOMY,
            "SUNTIME": "N/A",
            "MOONTIME": "N/A",
            "SUN_IS_RISING": 1,
            "MOON_IS_RISING": 1
        }, 'Astronomy (cache error)');
        return false;
    }
}

/**
 * Handle successful astronomy data fetch
 * @param {Object} todayData - Today's astronomy data
 * @param {string} apiKey - API key for subsequent requests
 * @param {number} attemptCount - Retry counter to prevent infinite loops
 */
function handleTodayAstronomyData(todayData, apiKey, attemptCount) {
    attemptCount = attemptCount || 0;
    
    var times = Astronomy.formatAstronomyTimes(todayData);
    var cacheData = Astronomy.buildAstronomyCache(todayData);
    
    // Check if we need tomorrow's data for either sun or moon times
    if (times.needsTomorrowSunData || times.needsTomorrowMoonData) {
        console.log('Fetching tomorrow astronomy data');
        
        var tomorrowDate = Astronomy.getTomorrowDateString();
        Geolocation.fetchAstronomyData(apiKey, undefined, undefined, tomorrowDate,
            function(tomorrowData) {
                // Cache tomorrow's sunrise if needed
                if (times.needsTomorrowSunData) {
                    cacheData.tomorrowSunrise = tomorrowData.sunrise;
                    if (tomorrowData.sunrise && !tomorrowData.sunrise.includes('N/A')) {
                        times.sunTime = tomorrowData.sunrise;
                        console.log('Using tomorrow sunrise: ' + times.sunTime);
                    }
                }
                
                // Cache tomorrow's moon data if needed
                if (times.needsTomorrowMoonData) {
                    cacheData.tomorrowMoonrise = tomorrowData.moonrise;
                    cacheData.tomorrowMoonset = tomorrowData.moonset;
                    
                    var moonEvent = Astronomy.determineTomorrowMoonEvent(todayData.moonrise, todayData.moonset);
                    
                    if (moonEvent.needMoonrise && tomorrowData.moonrise && !tomorrowData.moonrise.includes('N/A')) {
                        times.moonTime = tomorrowData.moonrise;
                        console.log('Using tomorrow moonrise: ' + times.moonTime);
                    } else if (moonEvent.needMoonset && tomorrowData.moonset && !tomorrowData.moonset.includes('N/A')) {
                        times.moonTime = tomorrowData.moonset;
                        console.log('Using tomorrow moonset: ' + times.moonTime);
                    }
                }
                
                cacheAstronomyData(cacheData);
                completeAstronomyUpdate(times);
            },
            function(error) {
                console.log(`Error fetching tomorrow data (attempt ${attemptCount + 1}): ${error}`);
                
                // Limit retries for tomorrow data to prevent infinite loops
                if (attemptCount < 1) {
                    console.log('Retrying tomorrow data fetch...');
                    handleTodayAstronomyData(todayData, apiKey, attemptCount + 1);
                } else {
                    console.log('Max retries for tomorrow data reached, using today data');
                    cacheAstronomyData(cacheData);
                    completeAstronomyUpdate(times);
                }
            }
        );
    } else {
        // No need for tomorrow's data
        cacheAstronomyData(cacheData);
        completeAstronomyUpdate(times);
    }
}

/**
 * Complete astronomy data update and send to Pebble
 * @param {Object} times - Formatted sun/moon times
 */
function completeAstronomyUpdate(times) {
    sendToPebble({
        "MSG_TYPE": MSG_TYPE_ASTRONOMY,
        "SUNTIME": times.sunTime || "N/A",
        "MOONTIME": times.moonTime || "N/A",
        "MOON_PHASE": times.moonPhase !== undefined ? times.moonPhase : 0,
        "SUN_IS_RISING": times.sunIsRising ? 1 : 0,
        "MOON_IS_RISING": times.moonIsRising ? 1 : 0
    }, 'Astronomy');
}

/**
 * Fetch astronomy data and send to watchface as a separate message
 * @param {number} attemptCount - Internal retry counter (starts at 0)
 */
function fetchAndSendAstronomy(attemptCount) {
    astronomyRetryPending = false;
    attemptCount = attemptCount || 0;
    
    console.log('Processing astronomy data (attempt ' + (attemptCount + 1) + ')');
    
    var apiKey = appSettings.ASTRO_API_KEY;
    
    // If no API key, send N/A astronomy data
    if (!apiKey) {
        console.log('No astronomy API key configured, sending N/A astronomy');
        sendToPebble({
            "MSG_TYPE": MSG_TYPE_ASTRONOMY,
            "SUNTIME": "N/A",
            "MOONTIME": "N/A",
            "SUN_IS_RISING": 1,
            "MOON_IS_RISING": 1
        }, 'Astronomy (no API key)');
        return;
    }
    
    // Check if we need fresh data
    if (!shouldRefreshAstronomyData()) {
        console.log('Checking cached astronomy data');
        var cacheUsed = useCachedAstronomyData();
        
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
            handleTodayAstronomyData(todayData, apiKey);
        },
        function(error) {
            console.log(`Error fetching astronomy (attempt ${attemptCount + 1}): ${error}`);
            
            // Limit retries to prevent infinite loops
            if (attemptCount < CONFIG.MAX_FETCH_RETRIES) {
                console.log(`Will retry astronomy fetch (${CONFIG.MAX_FETCH_RETRIES - attemptCount - 1} attempts remaining)`);
                // Retry after 2 second delay to allow network recovery
                astronomyRetryPending = true;
                setTimeout(function() {
                    if (!astronomyRetryPending) return;
                    astronomyRetryPending = false;
                    fetchAndSendAstronomy(attemptCount + 1);
                }, 2000);
            } else {
                console.log(`Max retries reached (${CONFIG.MAX_FETCH_RETRIES}), falling back to cache`);
                useCachedAstronomyData();
            }
        }
    );
}

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    var R = 6371; // Earth's radius in kilometers
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Fetch weather data from OpenWeatherMap and send to Pebble
 * Caches for 30 minutes to avoid excessive API calls and GPS lookups
 * Invalidates cache if location changes significantly (> 5km)
 * @param {number} attemptCount - Internal retry counter
 */
function fetchAndSendWeather(attemptCount) {
    weatherRetryPending = false;
    attemptCount = attemptCount || 0;
    
    var apiKey = appSettings.OWM_API_KEY;
    if (!apiKey) {
        console.log('No OpenWeatherMap API key configured, skipping weather');
        return;
    }
    
    // Helper to fetch current location and check against cache
    var checkLocationAndCache = function() {
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                var currentLat = pos.coords.latitude;
                var currentLon = pos.coords.longitude;
                
                // Check cache
                var cachedData = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.WEATHER_DATA);
                var lastFetchTime = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.WEATHER_FETCH_TIME);
                var lastLocation = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.WEATHER_LOCATION);
                
                var shouldFetchFresh = true;
                
                if (cachedData && lastFetchTime) {
                    var elapsed = Date.now() - parseInt(lastFetchTime);
                    var weatherIntervalMs = (parseInt(appSettings.WEATHER_INTERVAL) || CONFIG.DEFAULT_WEATHER_INTERVAL_MIN) * 60 * 1000;
                    
                    if (elapsed < weatherIntervalMs) {
                        try {
                            var cached = JSON.parse(cachedData);
                            
                            // Check if location has changed significantly
                            if (lastLocation) {
                                var lastLoc = JSON.parse(lastLocation);
                                var distance = calculateDistance(
                                    lastLoc.latitude, lastLoc.longitude,
                                    currentLat, currentLon
                                );
                                
                                if (distance > CONFIG.SIGNIFICANT_LOCATION_CHANGE_KM) {
                                    console.log('Location changed by ' + distance.toFixed(2) + ' km, refreshing weather');
                                    shouldFetchFresh = true;
                                } else {
                                    console.log('Using cached weather data (location change: ' + distance.toFixed(2) + ' km)');
                                    sendWeatherToPebble(cached);
                                    shouldFetchFresh = false;
                                }
                            } else {
                                console.log('Using cached weather data');
                                sendWeatherToPebble(cached);
                                shouldFetchFresh = false;
                            }
                        } catch (e) {
                            console.error('Error parsing cached weather: ' + e.message);
                            shouldFetchFresh = true;
                        }
                    }
                }
                
                if (shouldFetchFresh) {
                    var units = appSettings.WEATHER_UNITS || 'metric';
                    
                    console.log('Fetching fresh weather data (attempt ' + (attemptCount + 1) + ')');
                    Weather.fetchWeatherData(apiKey, units,
                        function(data) {
                            // Cache weather data with location
                            window.localStorage.setItem(CONFIG.TIME_CACHE_KEYS.WEATHER_DATA, JSON.stringify(data));
                            window.localStorage.setItem(CONFIG.TIME_CACHE_KEYS.WEATHER_FETCH_TIME, String(Date.now()));
                            window.localStorage.setItem(CONFIG.TIME_CACHE_KEYS.WEATHER_LOCATION, JSON.stringify({
                                latitude: data.latitude,
                                longitude: data.longitude
                            }));
                            sendWeatherToPebble(data);
                        },
                        function(error) {
                            console.error('Weather fetch error (attempt ' + (attemptCount + 1) + '): ' + error);
                            
                            if (attemptCount < CONFIG.MAX_FETCH_RETRIES) {
                                weatherRetryPending = true;
                                setTimeout(function() {
                                    if (!weatherRetryPending) return;
                                    weatherRetryPending = false;
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
            },
            function(err) {
                // Geolocation error - fall back to cache if available
                console.error('Geolocation error: ' + err.message);
                var cachedData = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.WEATHER_DATA);
                if (cachedData) {
                    try {
                        var cached = JSON.parse(cachedData);
                        console.log('Using cached weather data (geolocation unavailable)');
                        sendWeatherToPebble(cached);
                    } catch (e) {
                        console.error('Error using cached weather: ' + e.message);
                    }
                }
            },
            { timeout: CONFIG.REQUEST_TIMEOUT_MS, maximumAge: CONFIG.GEOLOCATION_MAX_AGE_MS }
        );
    };
    
    checkLocationAndCache();
}

/**
 * Send weather data to Pebble watchface
 * @param {Object} data - Weather data { temp, windSpeed, needsUmbrella }
 */
function sendWeatherToPebble(data) {
    var dictionary = {
        "MSG_TYPE": MSG_TYPE_WEATHER,
        "WEATHER_TEMP": String(data.temp),
        "WEATHER_WIND": String(data.windSpeed),
        "WEATHER_UMBRELLA": data.needsUmbrella ? 1 : 0
    };
    
    sendToPebble(dictionary, 'Weather');
}

