var Dexcom = require('./dexcom');
var Geolocation = require('./geolocation');
var Weather = require('./weather');
var Astronomy = require('./astronomy');
var Garbage = require('./garbage');
var Glucose = require('./glucose');
var Clay = require('pebble-clay');
var clayConfig = require('./config.json');
var customFn = require('./clay-config');
var clay = new Clay(clayConfig, customFn, { autoHandleEvents: false });
var appSettings = {};

// Message type discriminators (Fix 6)
var MSG_TYPE_SETTINGS  = 0;
var MSG_TYPE_GLUCOSE   = 1;
var MSG_TYPE_WEATHER   = 2;
var MSG_TYPE_ASTRONOMY = 3;
var MSG_TYPE_VIBE_TEST = 4;

// Retry cancellation guards (Fix 8)
var astronomyRetryPending = false;
var weatherRetryPending   = false;

// Last known GPS position (used to pass coordinates to astronomy API)
var lastKnownLat = undefined;
var lastKnownLon = undefined;

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
        console.error('Error parsing settings: ' + e.message);
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
        "GARBAGE_BAG": Garbage.computeGarbageBag(appSettings)
    };
    
    sendToPebble(dictionary, 'Settings');
}

/**
 * Fetch all watchface data (glucose reading, weather, and astronomy)
 * Astronomy is fetched independently based on its daily cache,
 * not on every glucose cycle, to reduce unnecessary API calls.
 */
function fetchAllData() {
    Glucose.fetchGlucoseReading(appSettings, CONFIG, sendToPebble, function() { /* no-op: astronomy decoupled */ }, Dexcom, MSG_TYPE_GLUCOSE);
    // Fetch weather independently (sent as separate message)
    fetchAndSendWeather();
    // Fetch astronomy independently — only hits the API when cache is stale (daily)
    fetchAndSendAstronomy();
}

// Listen for when the watchface is opened
Pebble.addEventListener('ready', function() {
    console.log('PebbleKit JS ready!');
    appSettings = getSettings();
    sendSettings();
    fetchAllData();
});

// Listen for AppMessage from watchface
Pebble.addEventListener('appmessage', function() {
    console.log('AppMessage received!');
    appSettings = getSettings();
    // Settings are only sent on startup and after config save.
    // Skipping sendSettings() here avoids an extra Bluetooth message every 5 minutes.
    fetchAllData();
});

// Open the Clay settings page (required when autoHandleEvents is false)
Pebble.addEventListener('showConfiguration', function() {
    Pebble.openURL(clay.generateUrl());
});

// Listen for when the settings form is closed (saved)
Pebble.addEventListener('webviewclosed', function(e) {
    console.log('Settings form closed');
    if (e && e.response) {
        // Check for vibe test request in raw response before Clay processes it
        var vibePattern = 0;
        try {
            var raw = JSON.parse(decodeURIComponent(e.response));
            if (raw && raw._vibeTest) {
                vibePattern = raw._vibeTest;
            }
        } catch (err) {
            // Not valid JSON or not our format — let Clay handle it
        }

        // Let Clay process settings normally
        clay.getSettings(e.response);

        // Send vibe test command if requested
        if (vibePattern > 0) {
            Pebble.sendAppMessage(
                { 'MSG_TYPE': MSG_TYPE_VIBE_TEST, 'VIBE_TEST': vibePattern },
                function() { console.log('Vibe test sent: pattern ' + vibePattern); },
                function() { console.error('Vibe test send failed'); }
            );
        }
    }
    appSettings = getSettings();
    sendSettings();
    fetchAllData();
});

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
        console.error('Error parsing cached data: ' + e.message);
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
        // Use last known coordinates so location overrides propagate to
        // tomorrow's fetch as well (instead of relying on IP auto-detection).
        var tomorrowLat = lastKnownLat;
        var tomorrowLon = lastKnownLon;
        Geolocation.fetchAstronomyData(apiKey, tomorrowLat, tomorrowLon, tomorrowDate,
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
                console.log('Error fetching tomorrow data (attempt ' + (attemptCount + 1) + '): ' + error);
                
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
    
    // Fetch fresh astronomy data with retry tracking.
    // Use navigator.geolocation to get coordinates so that any location
    // override (e.g. --loc flag in the emulator script) is propagated to
    // the ipgeolocation.io API instead of relying on IP auto-detection.
    console.log('Fetching fresh astronomy data from API');
    navigator.geolocation.getCurrentPosition(
        function(pos) {
            var lat = pos.coords.latitude;
            var lon = pos.coords.longitude;
            lastKnownLat = lat;
            lastKnownLon = lon;
            console.log('Astronomy using coordinates: ' + lat + ', ' + lon);
            Geolocation.fetchAstronomyData(apiKey, lat, lon,
                function(todayData) {
                    console.log('Today astronomy data received');
                    attemptCount = 0;
                    handleTodayAstronomyData(todayData, apiKey);
                },
                function(error) {
                    console.log('Error fetching astronomy (attempt ' + (attemptCount + 1) + '): ' + error);
                    if (attemptCount < CONFIG.MAX_FETCH_RETRIES) {
                        console.log('Will retry astronomy fetch (' + (CONFIG.MAX_FETCH_RETRIES - attemptCount - 1) + ' attempts remaining)');
                        astronomyRetryPending = true;
                        setTimeout(function() {
                            if (!astronomyRetryPending) return;
                            astronomyRetryPending = false;
                            fetchAndSendAstronomy(attemptCount + 1);
                        }, 2000);
                    } else {
                        console.log('Max retries reached (' + CONFIG.MAX_FETCH_RETRIES + '), falling back to cache');
                        useCachedAstronomyData();
                    }
                }
            );
        },
        function(geoErr) {
            // Geolocation unavailable — fall back to IP-based auto-detection
            console.log('Geolocation unavailable for astronomy, using IP-based detection');
            Geolocation.fetchAstronomyData(apiKey, undefined, undefined,
                function(todayData) {
                    console.log('Today astronomy data received (IP-based)');
                    attemptCount = 0;
                    handleTodayAstronomyData(todayData, apiKey);
                },
                function(error) {
                    console.log('Error fetching astronomy (attempt ' + (attemptCount + 1) + '): ' + error);
                    if (attemptCount < CONFIG.MAX_FETCH_RETRIES) {
                        console.log('Will retry astronomy fetch (' + (CONFIG.MAX_FETCH_RETRIES - attemptCount - 1) + ' attempts remaining)');
                        astronomyRetryPending = true;
                        setTimeout(function() {
                            if (!astronomyRetryPending) return;
                            astronomyRetryPending = false;
                            fetchAndSendAstronomy(attemptCount + 1);
                        }, 2000);
                    } else {
                        console.log('Max retries reached (' + CONFIG.MAX_FETCH_RETRIES + '), falling back to cache');
                        useCachedAstronomyData();
                    }
                }
            );
        },
        { timeout: CONFIG.REQUEST_TIMEOUT_MS, maximumAge: CONFIG.GEOLOCATION_MAX_AGE_MS }
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
 * Caches for configurable interval to avoid excessive API calls and GPS lookups.
 * Checks cache timestamp BEFORE requesting GPS to save phone battery.
 * Invalidates cache if location changes significantly (> 5km).
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
    
    // --- Check cache validity by timestamp FIRST, before any GPS call ---
    var cachedData = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.WEATHER_DATA);
    var lastFetchTime = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.WEATHER_FETCH_TIME);
    var weatherIntervalMs = (parseInt(appSettings.WEATHER_INTERVAL) || CONFIG.DEFAULT_WEATHER_INTERVAL_MIN) * 60 * 1000;
    
    if (cachedData && lastFetchTime) {
        var elapsed = Date.now() - parseInt(lastFetchTime);
        if (elapsed < weatherIntervalMs) {
            // Cache is fresh — send cached data without GPS lookup
            try {
                var cached = JSON.parse(cachedData);
                console.log('Using cached weather data (age: ' + Math.round(elapsed / 60000) + 'min)');
                sendWeatherToPebble(cached);
                return;
            } catch (e) {
                console.error('Error parsing cached weather: ' + e.message);
                // Fall through to fresh fetch
            }
        }
    }
    
    // --- Cache is stale or missing — now request GPS and fetch fresh data ---
    navigator.geolocation.getCurrentPosition(
        function(pos) {
            var currentLat = pos.coords.latitude;
            var currentLon = pos.coords.longitude;
            
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
        },
        function(err) {
            // Geolocation error - fall back to cache if available
            console.error('Geolocation error: ' + err.message);
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

