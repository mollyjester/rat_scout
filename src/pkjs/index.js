var Dexcom = require('./dexcom');
var Geolocation = require('./geolocation');
var Clay = require('pebble-clay');
var clayConfig = require('./config.json');
var clay = new Clay(clayConfig);
var appSettings = {};

var debug = false;

function getSettings() {
    var settings = {};

    try {
        settings = JSON.parse(window.localStorage.getItem('clay-settings')) || {};
    }
    catch (e) {
        console.error('Error parsing settings: ' + e);
    }

    return settings;
}

// Send settings to the watchface
function sendSettings() {
    var dictionary = {
        "BG_SHOW_DELTA": appSettings.BG_SHOW_DELTA ? 1 : 0,
        "BG_SHOW_TIMEDELTA": appSettings.BG_SHOW_TIMEDELTA ? 1 : 0,
        "BG_UNITS": appSettings.BG_UNITS || "mg/dL",
        "HOURLY_VIBRATION": appSettings.HOURLY_VIBRATION ? 1 : 0,
        "ASTRO_API_KEY": appSettings.ASTRO_API_KEY || ""
    };
    
    Pebble.sendAppMessage(dictionary,
        function(e) {
            console.log('Settings sent to Pebble successfully.');
        },
        function(e) {
            console.log('Error sending settings to Pebble.');
        }
    );
}

// Listen for when the watchface is opened
Pebble.addEventListener('ready',
    function(e) {
        console.log('PebbleKit JS ready!');

        appSettings = getSettings();
        
        // Send current settings to watchface
        sendSettings();

        if (debug) {
            console.log('Debug mode enabled, skipping real data fetch');
            getScoutReadingTest();
            return;
        }

        getScoutReading();
    }
);

// Listen for when an AppMessage is received
Pebble.addEventListener('appmessage',
    function(e) {
        console.log('AppMessage received!');

        appSettings = getSettings();

        if (debug) {
            console.log('Debug mode enabled, skipping real data fetch');
            getScoutReadingTest();
            return;
        }

        getScoutReading();
    }
);

// Listen for when the settings form is closed (saved)
Pebble.addEventListener('webviewclosed',
    function(e) {
        console.log('Settings form closed!');
        
        // Reload settings from storage
        appSettings = getSettings();
        
        // Send updated settings to watchface immediately
        sendSettings();
        
        // Also fetch fresh glucose data to apply new settings
        if (debug) {
            console.log('Debug mode enabled, skipping real data fetch');
            getScoutReadingTest();
            return;
        }

        getScoutReading();
    }
);

function getScoutReading() {
    console.log('Getting a reading');

    if (!appSettings || !appSettings.DEX_LOGIN || !appSettings.DEX_PASSWORD) {
        console.log('No Dexcom login info set');
        return;
    }

    var accountId = window.localStorage.getItem('accountId');
    var sessionId = window.localStorage.getItem('sessionId');
    var dex = new Dexcom(appSettings.DEX_LOGIN,
                        appSettings.DEX_PASSWORD,
                        function(result) {
                            var bgUnits = appSettings.BG_UNITS || "mg/dL";
                            var readingTimestamp = Math.floor(result.current._datetime.getTime() / 1000);
                            
                            // Format BGDELTA with positive sign for positive values
                            var bgdelta = bgUnits === "mmol/L" ? (result.current._delta / 18).toFixed(1) : result.current._delta;
                            bgdelta = bgdelta > 0 ? '+' + bgdelta : bgdelta;

                            var dictionary = {
                                "BG_UNITS": bgUnits,
                                "BG_SHOW_DELTA": appSettings.BG_SHOW_DELTA ? 1 : 0,
                                "BG_SHOW_TIMEDELTA": appSettings.BG_SHOW_TIMEDELTA ? 1 : 0,
                                "BG": bgUnits === "mmol/L" ? (result.current._value / 18).toFixed(1) : result.current._value,
                                "BGDELTA": bgdelta,
                                "TIMEDELTA": result.current._delta_time,
                                "TIMESTAMP": readingTimestamp
                            };

                            console.log('Current WT: ' + result.current._json.WT);
                            console.log('Current datetime epoch secs: ' + readingTimestamp);

                            window.localStorage.setItem('accountId', dex.accountId);
                            window.localStorage.setItem('sessionId', dex.sessionId);

                            // Fetch astronomy data and send along with BG data
                            fetchAndSendAstronomy(dictionary);
                        });

    if (accountId && sessionId) {
        dex.accountId = accountId;
        dex.sessionId = sessionId;
    }

    try {
        dex.getLatestGlucoseWithDelta();
    }
    catch (error) {
        console.error('Error fetching glucose data: ' + (error && error.message ? error.message : error));
    }
};

// Check if astronomy data needs to be refreshed (once per day at midnight)
function shouldRefreshAstronomyData() {
    var lastFetchTime = window.localStorage.getItem('lastAstronomyFetchTime');
    
    if (!lastFetchTime) {
        console.log('No cached astronomy data, will fetch new data');
        return true;
    }
    
    var lastFetchTimestamp = parseInt(lastFetchTime);
    var now = Date.now();
    var lastFetchDate = new Date(lastFetchTimestamp);
    var nowDate = new Date(now);
    
    // Check if the date has changed (we've passed midnight since last fetch)
    if (lastFetchDate.toDateString() !== nowDate.toDateString()) {
        console.log('Date has changed since last fetch, will refresh astronomy data');
        return true;
    }
    
    console.log('Astronomy data is still fresh from today');
    return false;
}

// Parse time string in HH:MM format to minutes since midnight
function timeToMinutes(timeStr) {
    if (!timeStr || timeStr === 'N/A' || timeStr === 'N/A (The Sun never rises)' || timeStr === 'N/A (The Sun never sets)') {
        return null;
    }
    
    var parts = timeStr.split(':');
    if (parts.length !== 2) return null;
    
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    
    if (isNaN(hours) || isNaN(minutes)) return null;
    
    return hours * 60 + minutes;
}

// Get current time in minutes since midnight
function getCurrentTimeInMinutes() {
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}

// Determine which sun time to display (sunrise or sunset)
function getSunTime(sunrise, sunset) {
    var currentMinutes = getCurrentTimeInMinutes();
    var sunriseMinutes = timeToMinutes(sunrise);
    var sunsetMinutes = timeToMinutes(sunset);
    
    // If sunrise time has passed, show sunset time
    if (sunriseMinutes !== null && currentMinutes >= sunriseMinutes) {
        console.log('Sunrise has passed, showing sunset time: ' + sunset);
        return sunset;
    }
    
    console.log('Sunrise has not passed, showing sunrise time: ' + sunrise);
    return sunrise;
}

// Determine which moon time to display (moonrise or moonset)
// Also returns a flag indicating if tomorrow's moon data is needed
function getMoonTime(moonrise, moonset) {
    var currentMinutes = getCurrentTimeInMinutes();
    var moonriseMinutes = timeToMinutes(moonrise);
    var moonsetMinutes = timeToMinutes(moonset);
    
    // If moonrise time has passed, show moonset time
    if (moonriseMinutes !== null && currentMinutes >= moonriseMinutes) {
        console.log('Moonrise has passed, showing moonset time: ' + moonset);
        return {
            time: moonset,
            needsTomorrowData: false
        };
    }
    
    // If neither moonrise nor moonset have passed, show moonrise
    if (moonriseMinutes !== null && currentMinutes < moonriseMinutes) {
        console.log('Moonrise has not passed, showing moonrise time: ' + moonrise);
        return {
            time: moonrise,
            needsTomorrowData: false
        };
    }
    
    // If we reach here, moonrise and/or moonset might be on the next day
    console.log('Moon times might be on next day, will need to fetch tomorrow data');
    return {
        time: moonset,
        needsTomorrowData: true
    };
}

// Get tomorrow's date in YYYY-MM-DD format
function getTomorrowDateString() {
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    var year = tomorrow.getFullYear();
    var month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    var day = String(tomorrow.getDate()).padStart(2, '0');
    
    return year + '-' + month + '-' + day;
}

// Fetch astronomy data and combine with BG data before sending to watchface
function fetchAndSendAstronomy(bgDictionary) {
    console.log('Fetching astronomy data...');
    
    var apiKey = appSettings.ASTRO_API_KEY || "2eded28003f44d859d55d984a1a6af68";
    
    // Check if API key is provided
    if (!apiKey) {
        console.log('No astronomy API key configured, sending BG data only');
        
        // Send BG data only without astronomy data
        bgDictionary.SUNTIME = "N/A";
        bgDictionary.MOONTIME = "N/A";
        
        Pebble.sendAppMessage(bgDictionary,
            function(e) {
                console.log('BG data sent to Pebble successfully.');
            },
            function(e) {
                console.log('Error sending BG data to Pebble.');
            }
        );
        return;
    }
    
    // Check if we should refresh the astronomy data
    if (shouldRefreshAstronomyData()) {
        console.log('Fetching fresh astronomy data from API');
        
        Geolocation.fetchAstronomyData(apiKey, undefined, undefined,
            function(todayData) {
                console.log('Today astronomy data received');
                
                // Determine which sun time to show
                var displaySunTime = getSunTime(todayData.sunrise, todayData.sunset);
                
                // Determine which moon time to show
                var moonTimeResult = getMoonTime(todayData.moonrise, todayData.moonset);
                var displayMoonTime = moonTimeResult.time;
                var needsTomorrowData = moonTimeResult.needsTomorrowData;
                
                // Prepare cache data
                var cacheData = {
                    sunrise: todayData.sunrise,
                    sunset: todayData.sunset,
                    moonrise: todayData.moonrise,
                    moonset: todayData.moonset,
                    moonPhase: todayData.moonPhase,
                    tomorrowMoonrise: null,
                    tomorrowMoonset: null
                };
                
                // If we need tomorrow's moon data, fetch it
                if (needsTomorrowData) {
                    console.log('Fetching tomorrow moon data for complete moon information');
                    
                    var tomorrowDate = getTomorrowDateString();
                    Geolocation.fetchAstronomyData(apiKey, undefined, undefined, tomorrowDate,
                        function(tomorrowData) {
                            console.log('Tomorrow moon data received');
                            
                            // Store tomorrow's moon data in cache
                            cacheData.tomorrowMoonrise = tomorrowData.moonrise;
                            cacheData.tomorrowMoonset = tomorrowData.moonset;
                            
                            // Update display moon time with tomorrow's moonrise if applicable
                            if (tomorrowData.moonrise && tomorrowData.moonrise !== 'N/A') {
                                displayMoonTime = tomorrowData.moonrise;
                                console.log('Using tomorrow moonrise: ' + displayMoonTime);
                            }
                            
                            // Cache the complete astronomy data
                            window.localStorage.setItem('cachedAstronomyData', JSON.stringify(cacheData));
                            window.localStorage.setItem('lastAstronomyFetchTime', String(Date.now()));
                            
                            // Add to dictionary and send
                            bgDictionary.SUNTIME = displaySunTime || "N/A";
                            bgDictionary.MOONTIME = displayMoonTime || "N/A";
                            
                            Pebble.sendAppMessage(bgDictionary,
                                function(e) {
                                    console.log('BG and astronomy data sent to Pebble successfully.');
                                },
                                function(e) {
                                    console.log('Error sending combined data to Pebble.');
                                }
                            );
                        },
                        function(error) {
                            console.log('Error fetching tomorrow moon data: ' + error + ', using today moon data');
                            
                            // Cache without tomorrow data
                            window.localStorage.setItem('cachedAstronomyData', JSON.stringify(cacheData));
                            window.localStorage.setItem('lastAstronomyFetchTime', String(Date.now()));
                            
                            // Add to dictionary and send with computed times
                            bgDictionary.SUNTIME = displaySunTime || "N/A";
                            bgDictionary.MOONTIME = displayMoonTime || "N/A";
                            
                            Pebble.sendAppMessage(bgDictionary,
                                function(e) {
                                    console.log('BG and astronomy data sent to Pebble successfully.');
                                },
                                function(e) {
                                    console.log('Error sending combined data to Pebble.');
                                }
                            );
                        }
                    );
                } else {
                    // No need for tomorrow's data, cache and send now
                    window.localStorage.setItem('cachedAstronomyData', JSON.stringify(cacheData));
                    window.localStorage.setItem('lastAstronomyFetchTime', String(Date.now()));
                    
                    // Add astronomy data to the dictionary
                    bgDictionary.SUNTIME = displaySunTime || "N/A";
                    bgDictionary.MOONTIME = displayMoonTime || "N/A";
                    
                    // Send combined data to watchface
                    Pebble.sendAppMessage(bgDictionary,
                        function(e) {
                            console.log('BG and astronomy data sent to Pebble successfully.');
                        },
                        function(e) {
                            console.log('Error sending combined data to Pebble.');
                        }
                    );
                }
            },
            function(error) {
                console.log('Error fetching astronomy data: ' + error + ', using cached data or sending BG only');
                
                // Try to use cached data
                var cachedData = window.localStorage.getItem('cachedAstronomyData');
                
                if (cachedData) {
                    try {
                        var astronomyData = JSON.parse(cachedData);
                        console.log('Using cached astronomy data');
                        
                        // Determine which sun time to show using cached data
                        var displaySunTime = getSunTime(astronomyData.sunrise, astronomyData.sunset);
                        
                        // Determine which moon time to show using cached data
                        var moonTimeResult = getMoonTime(astronomyData.moonrise, astronomyData.moonset);
                        var displayMoonTime = moonTimeResult.time;
                        
                        // If we need tomorrow's data and have it cached, use it
                        if (moonTimeResult.needsTomorrowData && astronomyData.tomorrowMoonrise) {
                            displayMoonTime = astronomyData.tomorrowMoonrise;
                        }
                        
                        bgDictionary.SUNTIME = displaySunTime || "N/A";
                        bgDictionary.MOONTIME = displayMoonTime || "N/A";
                    } catch (e) {
                        console.error('Error parsing cached astronomy data: ' + e);
                        bgDictionary.SUNTIME = "N/A";
                        bgDictionary.MOONTIME = "N/A";
                    }
                } else {
                    // No cached data available
                    bgDictionary.SUNTIME = "N/A";
                    bgDictionary.MOONTIME = "N/A";
                }
                
                // Send data to watchface
                Pebble.sendAppMessage(bgDictionary,
                    function(e) {
                        console.log('BG data sent to Pebble successfully.');
                    },
                    function(e) {
                        console.log('Error sending BG data to Pebble.');
                    }
                );
            }
        );
    } else {
        // Use cached astronomy data
        console.log('Using cached astronomy data from earlier today');
        
        var cachedData = window.localStorage.getItem('cachedAstronomyData');
        
        if (cachedData) {
            try {
                var astronomyData = JSON.parse(cachedData);
                
                // Determine which sun time to show using cached data
                var displaySunTime = getSunTime(astronomyData.sunrise, astronomyData.sunset);
                
                // Determine which moon time to show using cached data
                var moonTimeResult = getMoonTime(astronomyData.moonrise, astronomyData.moonset);
                var displayMoonTime = moonTimeResult.time;
                
                // If we need tomorrow's data and have it cached, use it
                if (moonTimeResult.needsTomorrowData && astronomyData.tomorrowMoonrise) {
                    displayMoonTime = astronomyData.tomorrowMoonrise;
                    console.log('Using cached tomorrow moonrise: ' + displayMoonTime);
                }
                
                // Add cached astronomy data to the dictionary
                bgDictionary.SUNTIME = displaySunTime || "N/A";
                bgDictionary.MOONTIME = displayMoonTime || "N/A";
                
                console.log('Cached astronomy data loaded successfully');
            } catch (e) {
                console.error('Error parsing cached astronomy data: ' + e);
                bgDictionary.SUNTIME = "N/A";
                bgDictionary.MOONTIME = "N/A";
            }
        } else {
            console.log('No cached astronomy data available');
            bgDictionary.SUNTIME = "N/A";
            bgDictionary.MOONTIME = "N/A";
        }
        
        // Send data with cached or missing astronomy info
        Pebble.sendAppMessage(bgDictionary,
            function(e) {
                console.log('BG and astronomy data sent to Pebble successfully.');
            },
            function(e) {
                console.log('Error sending combined data to Pebble.');
            }
        );
    }
}

function getScoutReadingTest() {
    var readingTimestamp = (Date.now() - (4.3 * 60 * 1000)) / 1000; // Use current time for testing (5 minutes ago)
                            
    // Format BGDELTA with positive sign for positive values
    var bgdelta = (16.2 / 18).toFixed(1);
    bgdelta = bgdelta > 0 ? '+' + bgdelta : bgdelta;

    var dictionary = {
        "BG_UNITS": "mmol/L",
        "BG_SHOW_DELTA": 1,
        "BG_SHOW_TIMEDELTA": 0,
        "BG": (259.2 / 18).toFixed(1),
        "BGDELTA": bgdelta,
        "TIMEDELTA": 1000,
        "TIMESTAMP": readingTimestamp
    };

    fetchAndSendAstronomy(dictionary);
    /*
    Pebble.sendAppMessage(dictionary,
        function(e) {
            console.log('BG data sent to Pebble successfully.');
        },
        function(e) {
            console.log('Error sending BG data to Pebble.');
        }
    );
    */

};