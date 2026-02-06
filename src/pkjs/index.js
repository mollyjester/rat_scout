var Dexcom = require('./dexcom');
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

// Listen for when the watchface is opened
Pebble.addEventListener('ready',
    function(e) {
        console.log('PebbleKit JS ready!');

        appSettings = getSettings();

        getScoutReading();
        //getScoutReadingTest();
    }
);

// Listen for when an AppMessage is received
Pebble.addEventListener('appmessage',
    function(e) {
        console.log('AppMessage received!');

        appSettings = getSettings();

        getScoutReading();
        //getScoutReadingTest();
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

                            Pebble.sendAppMessage(dictionary,
                                function(e) {
                                    console.log('BG data sent to Pebble successfully.');
                                },
                                function(e) {
                                    console.log('Error sending BG data to Pebble.');
                                }
                            );
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

    Pebble.sendAppMessage(dictionary,
        function(e) {
            console.log('BG data sent to Pebble successfully.');
        },
        function(e) {
            console.log('Error sending BG data to Pebble.');
        }
    );

};