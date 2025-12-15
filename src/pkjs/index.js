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
    }
);

// Listen for when an AppMessage is received
Pebble.addEventListener('appmessage',
    function(e) {
        console.log('AppMessage received!');

        appSettings = getSettings();

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

                            var dictionary = {
                                "BG_UNITS": bgUnits,
                                "BG_SHOW_DELTA": appSettings.BG_SHOW_DELTA ? 1 : 0,
                                "BG_SHOW_TIMEDELTA": appSettings.BG_SHOW_TIMEDELTA ? 1 : 0,
                                "BG": bgUnits === "mmol/L" ? (result.current._value / 18).toFixed(1) : result.current._value,
                                "BGDELTA": bgUnits === "mmol/L" ? (result.current._delta / 18).toFixed(1) : result.current._delta,
                                "TIMEDELTA": result.current._delta_time
                            };

                            console.log('Current WT: ' + result.current._json.WT);
                            console.log('Current datetime epoch secs: ' + Math.floor(result.current._datetime.getTime() / 1000));

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