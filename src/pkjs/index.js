var Geolocation = require('./geolocation');
var Astronomy = require('./astronomy');
var Garbage = require('./garbage');
var Glucose = require('./glucose');
var GlucosePlugin = require('./glucose_plugin');
var WeatherPlugin = require('./weather_plugin');
var LegacyCleanup = require('./legacy_cleanup');
var MessageQueue = require('./message_queue');
var WatchSettings = require('./watch_settings');
var Clay = require('@rebble/clay');
var clayConfig = require('./config.json');
var customFn = require('./clay-config');
var clay = new Clay(clayConfig, customFn, { autoHandleEvents: false });
var appSettings = {};

// Message type discriminators (Fix 6)
var MSG_TYPE_SETTINGS     = 0;
var MSG_TYPE_GLUCOSE      = 1;
var MSG_TYPE_WEATHER      = 2;
var MSG_TYPE_ASTRONOMY    = 3;
var MSG_TYPE_VIBE_TEST    = 4;
var MSG_TYPE_OVERLAY_TEST = 5;
var MSG_TYPE_SOUND_TEST   = 6;

// Retry cancellation guards (Fix 8)
var astronomyRetryPending = false;

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
        ASTRONOMY_LOCATION: 'lastAstronomyLocation',
        ASTRONOMY_FAIL_TIME: 'lastAstronomyFailTime'
    },
    DEFAULT_BG_UNITS: 'mg/dL',
    MMOL_CONVERSION_FACTOR: 18.0182,
    MAX_FETCH_RETRIES: 2,
    REQUEST_TIMEOUT_MS: 15000,
    SIGNIFICANT_LOCATION_CHANGE_KM: 5,
    GEOLOCATION_MAX_AGE_MS: 300000,
    // How old a last known position may be for the "did we move?" check on a fresh cache. The
    // phone app answers from its last known location when it is younger than maximumAge, without
    // a new fix (mobileapp libpebble3 AndroidSystemGeolocation.kt getCurrentPosition).
    LOCATION_CHECK_MAX_AGE_MS: 60 * 60 * 1000,
    LOCATION_CHECK_TIMEOUT_MS: 5000,
    // After all astronomy retries failed, wait this long before trying the API again (watch
    // pings come every minute while a reading is late).
    ASTRONOMY_FAIL_BACKOFF_MS: 15 * 60 * 1000
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

// Watch messages: one in flight at a time, with a timeout (message_queue.js).
var messageQueue = MessageQueue.create({
    sendAppMessage: function(dict, onOk, onFail) { Pebble.sendAppMessage(dict, onOk, onFail); }
});

// Astronomy is re-sent from cache on every watch ping, weather on every plugin answer; only send
// what changed.
var changeFilter = MessageQueue.createChangeFilter();

/**
 * Send a message to the watch through the queue.
 * @param {Object} dictionary - Data to send
 * @param {string} messageType - Type of message for logging
 * @param {Function} onFailure - Optional: called if the send fails or times out
 */
function sendToPebble(dictionary, messageType, onFailure) {
    messageQueue.push(dictionary, messageType || 'data', onFailure);
}

/**
 * Send a weather or astronomy dictionary unless it equals the last one of its kind.
 * A failed send is forgotten, so the next ping sends it again.
 * @param {string} kind - 'weather' or 'astronomy'
 * @param {Object} dictionary - Data to send
 * @param {string} messageType - Type of message for logging
 */
function sendIfChanged(kind, dictionary, messageType) {
    if (!changeFilter.changed(kind, dictionary)) {
        console.log(messageType + ' unchanged, not sent');
        return;
    }
    sendToPebble(dictionary, messageType, function() { changeFilter.forget(kind); });
}

/**
 * Distance between two coordinates (haversine), km.
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
 * Whether the phone moved more than SIGNIFICANT_LOCATION_CHANGE_KM from a stored location.
 * Uses the last known position (no new fix while it is younger than LOCATION_CHECK_MAX_AGE_MS).
 * @param {string} storageKey - localStorage key of {latitude, longitude}
 * @param {Function} callback - callback(moved): false when unknown (no stored location, no fix)
 */
function checkMoved(storageKey, callback) {
    var stored = null;
    try {
        stored = JSON.parse(window.localStorage.getItem(storageKey));
    } catch (e) {
        stored = null;
    }
    if (!stored || typeof stored.latitude !== 'number' || typeof stored.longitude !== 'number') {
        callback(false);
        return;
    }
    navigator.geolocation.getCurrentPosition(
        function(pos) {
            var km = calculateDistance(stored.latitude, stored.longitude, pos.coords.latitude, pos.coords.longitude);
            if (km > CONFIG.SIGNIFICANT_LOCATION_CHANGE_KM) console.log('Moved ' + Math.round(km) + ' km since the cached data');
            callback(km > CONFIG.SIGNIFICANT_LOCATION_CHANGE_KM);
        },
        function() { callback(false); },
        { timeout: CONFIG.LOCATION_CHECK_TIMEOUT_MS, maximumAge: CONFIG.LOCATION_CHECK_MAX_AGE_MS }
    );
}

// Time-of-day part (thresholds, garbage bag) of the last settings sent; see refreshTimedSettings.
var lastTimedSettings = null;

/**
 * Build and send settings to the watchface (watch_settings.js).
 */
function sendSettings() {
    var dictionary = WatchSettings.build(appSettings, new Date(), MSG_TYPE_SETTINGS);
    lastTimedSettings = WatchSettings.timedPart(dictionary);
    sendToPebble(dictionary, 'Settings', function() { lastTimedSettings = null; });
}

/**
 * The night thresholds and the garbage bag depend on the time of day, and the watch only gets
 * them in a settings message. Run on every watch ping: send settings again when they changed.
 */
function refreshTimedSettings() {
    var dictionary = WatchSettings.build(appSettings, new Date(), MSG_TYPE_SETTINGS);
    if (WatchSettings.timedPart(dictionary) === lastTimedSettings) return;
    console.log('Thresholds or garbage bag changed with the time of day: sending settings');
    sendSettings();
}

// Glucose comes only from the Rat Scout Glucose plugin ("---" while it is unavailable).
var glucoseSource = GlucosePlugin.create({
    Pebble: Pebble,
    Glucose: Glucose,
    settings: function() { return appSettings; },
    msgType: MSG_TYPE_GLUCOSE,
    send: sendToPebble
});

// Weather comes from whichever plugin serves weather/location, in the units of preferences/units
// ("--" while either is unavailable).
var weatherSource = WeatherPlugin.create({
    Pebble: Pebble,
    msgType: MSG_TYPE_WEATHER,
    send: function(dict) { sendIfChanged('weather', dict, 'Weather'); }
});

/**
 * Fetch astronomy and look after the glucose and weather subscriptions. Astronomy is
 * fetched independently based on its daily cache, not on every cycle, to reduce
 * unnecessary API calls. Glucose and weather arrive through plugin subscriptions; an
 * overdue reading resubscribes so the glucose plugin runs now.
 */
function fetchAllData() {
    var now = Date.now();
    glucoseSource.checkStall(now);
    glucoseSource.retryUnsent();
    glucoseSource.recheck();
    glucoseSource.recoverIfStuck(now);
    glucoseSource.refreshIfOverdue(now);
    refreshTimedSettings();
    weatherSource.recheck();
    // Fetch astronomy independently — only hits the API when cache is stale (daily)
    fetchAndSendAstronomy();
}

// Listen for when the watchface is opened
Pebble.addEventListener('ready', function() {
    console.log('PebbleKit JS ready!');
    LegacyCleanup.purgeLegacyDexcomData(window.localStorage);
    appSettings = getSettings();
    sendSettings();
    glucoseSource.start();
    weatherSource.start();
    fetchAllData();
});

// Listen for AppMessage from watchface
Pebble.addEventListener('appmessage', function() {
    console.log('AppMessage received!');
    appSettings = getSettings();
    // Settings are sent on startup, after config save, and from fetchAllData() when the
    // time-of-day part (night thresholds, garbage bag) changed; not on every ping.
    fetchAllData();
});

// Open the Clay settings page (required when autoHandleEvents is false)
Pebble.addEventListener('showConfiguration', function() {
    lastWebviewResponse = null;
    Pebble.openURL(clay.generateUrl());
});

// Guard against webviewclosed firing twice (Pebble/Rebble firmware quirk)
var lastWebviewResponse = null;

// Listen for when the settings form is closed (saved)
Pebble.addEventListener('webviewclosed', function(e) {
    console.log('Settings form closed');
    if (e && e.response) {
        if (e.response === lastWebviewResponse) {
            console.log('Duplicate webviewclosed event, skipping');
            return;
        }
        lastWebviewResponse = e.response;
        // Check for vibe test request in raw response before Clay processes it
        var vibePattern = 0;
        var overlayTest = false;
        var soundPattern = 0;
        try {
            var raw = JSON.parse(decodeURIComponent(e.response));
            if (raw && raw._vibeTest) {
                vibePattern = raw._vibeTest;
            }
            if (raw && raw._overlayTest) {
                overlayTest = true;
            }
            if (raw && raw._soundTest) {
                soundPattern = raw._soundTest;
            }
        } catch (err) {
            // Not valid JSON or not our format — let Clay handle it
        }

        // Let Clay process settings normally
        clay.getSettings(e.response);

        // Load the freshly saved settings and push them to the watch first,
        // so any test command that follows sees the current configuration.
        appSettings = getSettings();
        sendSettings();
        // Re-read the plugin so a unit/delta change is re-sent even if the reading is unchanged.
        glucoseSource.onSettingsChanged();
        weatherSource.onSettingsChanged();

        // Queue test commands after settings so they arrive in order
        if (vibePattern > 0) {
            sendToPebble(
                { 'MSG_TYPE': MSG_TYPE_VIBE_TEST, 'VIBE_TEST': vibePattern },
                'Vibe test'
            );
        }

        if (overlayTest) {
            sendToPebble(
                { 'MSG_TYPE': MSG_TYPE_OVERLAY_TEST },
                'Overlay test'
            );
        }

        if (soundPattern > 0) {
            sendToPebble(
                { 'MSG_TYPE': MSG_TYPE_SOUND_TEST, 'SOUND_TEST': soundPattern },
                'Sound test'
            );
        }
    }
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
    window.localStorage.removeItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_FAIL_TIME);
    // Where the times are for, so a move invalidates them (IP-based lookups store none).
    if (typeof lastKnownLat === 'number' && typeof lastKnownLon === 'number') {
        window.localStorage.setItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_LOCATION,
            JSON.stringify({ latitude: lastKnownLat, longitude: lastKnownLon }));
    } else {
        window.localStorage.removeItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_LOCATION);
    }
}

/**
 * Load and use cached astronomy data
 * @returns {boolean} True if cache was successfully used, false if fresh data is needed
 */
function useCachedAstronomyData() {
    var cachedData = window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_DATA);
    
    if (!cachedData) {
        console.log('No cached astronomy data available');
        sendIfChanged('astronomy', {
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
        sendIfChanged('astronomy', {
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
        sendIfChanged('astronomy', {
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
                    if (tomorrowData.sunrise && tomorrowData.sunrise.indexOf('N/A') === -1) {
                        times.sunTime = tomorrowData.sunrise;
                        console.log('Using tomorrow sunrise: ' + times.sunTime);
                    }
                }
                
                // Cache tomorrow's moon data if needed
                if (times.needsTomorrowMoonData) {
                    cacheData.tomorrowMoonrise = tomorrowData.moonrise;
                    cacheData.tomorrowMoonset = tomorrowData.moonset;
                    
                    var moonEvent = Astronomy.determineTomorrowMoonEvent(todayData.moonrise, todayData.moonset);
                    
                    if (moonEvent.needMoonrise && tomorrowData.moonrise && tomorrowData.moonrise.indexOf('N/A') === -1) {
                        times.moonTime = tomorrowData.moonrise;
                        console.log('Using tomorrow moonrise: ' + times.moonTime);
                    } else if (moonEvent.needMoonset && tomorrowData.moonset && tomorrowData.moonset.indexOf('N/A') === -1) {
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
    sendIfChanged('astronomy', {
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
        sendIfChanged('astronomy', {
            "MSG_TYPE": MSG_TYPE_ASTRONOMY,
            "SUNTIME": "N/A",
            "MOONTIME": "N/A",
            "SUN_IS_RISING": 1,
            "MOON_IS_RISING": 1
        }, 'Astronomy (no API key)');
        return;
    }
    
    // Today's cache, unless the phone moved since (or it lacks tomorrow's data when needed)
    if (attemptCount === 0 && !shouldRefreshAstronomyData()) {
        console.log('Checking cached astronomy data');
        checkMoved(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_LOCATION, function(moved) {
            if (!moved && useCachedAstronomyData()) return;
            console.log(moved ? 'Location changed, fetching fresh astronomy data' : 'Cache incomplete, fetching fresh astronomy data');
            fetchFreshAstronomy(apiKey, 0);
        });
        return;
    }
    fetchFreshAstronomy(apiKey, attemptCount);
}

/**
 * Record that every astronomy attempt failed and show the cache, if any.
 */
function astronomyFailed() {
    console.log('Max retries reached (' + CONFIG.MAX_FETCH_RETRIES + '), falling back to cache');
    window.localStorage.setItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_FAIL_TIME, String(Date.now()));
    useCachedAstronomyData();
}

/**
 * Fetch astronomy data from the API (no cache check), with retries.
 * @param {string} apiKey - ipgeolocation.io API key
 * @param {number} attemptCount - Retry counter (starts at 0)
 */
function fetchFreshAstronomy(apiKey, attemptCount) {
    var failedAt = parseInt(window.localStorage.getItem(CONFIG.TIME_CACHE_KEYS.ASTRONOMY_FAIL_TIME), 10) || 0;
    var sinceFail = Date.now() - failedAt;
    if (attemptCount === 0 && sinceFail >= 0 && sinceFail < CONFIG.ASTRONOMY_FAIL_BACKOFF_MS) {
        console.log('Astronomy API failed ' + Math.round(sinceFail / 60000) + ' min ago; using cache until ' +
            (CONFIG.ASTRONOMY_FAIL_BACKOFF_MS / 60000) + ' min have passed');
        useCachedAstronomyData();
        return;
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
            // No coordinates in logs: they are read from live phones (scripts/device-check.sh).
            console.log('Astronomy using device coordinates');
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
                        astronomyFailed();
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
                        astronomyFailed();
                    }
                }
            );
        },
        { timeout: CONFIG.REQUEST_TIMEOUT_MS, maximumAge: CONFIG.GEOLOCATION_MAX_AGE_MS }
    );
}
