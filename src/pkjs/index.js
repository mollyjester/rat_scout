var Dexcom = require('./dexcom');
var Geolocation = require('./geolocation');
var Clay = require('pebble-clay');
var clayConfig = require('./config.json');
var clay = new Clay(clayConfig);
var appSettings = {};

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

        //getScoutReading();
        getScoutReadingTest();
    }
);

// Listen for when an AppMessage is received
Pebble.addEventListener('appmessage',
    function(e) {
        console.log('AppMessage received!');

        appSettings = getSettings();

        //getScoutReading();
        getScoutReadingTest();
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
        //getScoutReading();
        getScoutReadingTest();
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

// Fetch astronomy data and combine with BG data before sending to watchface
function fetchAndSendAstronomy(bgDictionary) {
    console.log('Fetching astronomy data...');
    
    var apiKey = appSettings.ASTRO_API_KEY || "2eded28003f44d859d55d984a1a6af68";
    
    // Check if API key is provided
    if (!apiKey) {
        console.log('No astronomy API key configured, sending BG data only');
        
        // Send BG data only without astronomy data
        bgDictionary.SUNRISE = "N/A";
        bgDictionary.SUNSET = "N/A";
        bgDictionary.MOONRISE = "N/A";
        bgDictionary.MOONSET = "N/A";
        bgDictionary.MOON_PHASE = "N/A";
        
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
    
    Geolocation.fetchAstronomyData(apiKey, undefined, undefined,
        function(astronomyData) {
            console.log('Astronomy data received, combining with BG data');
            
            // Add astronomy data to the dictionary
            bgDictionary.SUNRISE = astronomyData.sunrise || "N/A";
            bgDictionary.SUNSET = astronomyData.sunset || "N/A";
            bgDictionary.MOONRISE = astronomyData.moonrise || "N/A";
            bgDictionary.MOONSET = astronomyData.moonset || "N/A";
            bgDictionary.MOON_PHASE = astronomyData.moonPhase || "N/A";
            
            // Send combined data to watchface
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
            console.log('Error fetching astronomy data: ' + error + ', sending BG data only');
            
            // Send BG data only if astronomy fails
            bgDictionary.SUNRISE = "N/A";
            bgDictionary.SUNSET = "N/A";
            bgDictionary.MOONRISE = "N/A";
            bgDictionary.MOONSET = "N/A";
            bgDictionary.MOON_PHASE = "N/A";
            
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