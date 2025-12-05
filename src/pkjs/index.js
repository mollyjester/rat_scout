//var dexcom = require('./dexcom');

//##################### dexcom.js ##########################
//Credits: https://github.com/gagebenne/pydexcom
//Credits: https://github.com/faymaz/jsdexcom

const DEXCOM_APPLICATION_ID_US = 'd89443d2-327c-4a6f-89e5-496bbb0317db';
const DEXCOM_APPLICATION_ID_OUS = DEXCOM_APPLICATION_ID_US;
const DEXCOM_APPLICATION_ID_JP = 'd8665ade-9673-4e27-9ff6-92db4ce13d13'

const DEXCOM_BASE_URL = 'https://share2.dexcom.com/ShareWebServices/Services/'
const DEXCOM_BASE_URL_OUS = 'https://shareous1.dexcom.com/ShareWebServices/Services/'
const DEXCOM_BASE_URL_JP = 'https://share.dexcom.jp/ShareWebServices/Services/'

const DEXCOM_AUTHENTICATE_ENDPOINT = "General/AuthenticatePublisherAccount"
const DEXCOM_LOGIN_ID_ENDPOINT = "General/LoginPublisherAccountById"
const DEXCOM_GLUCOSE_READINGS_ENDPOINT = "Publisher/ReadPublisherLatestGlucoseValues"

const Regions = {
    US: 'us',
    OUS: 'ous',
    JP: 'jp'
};

const BaseURLs = {
    us: DEXCOM_BASE_URL,
    ous: DEXCOM_BASE_URL_OUS,
    jp: DEXCOM_BASE_URL_JP
};

const AppIDs = {
    us: DEXCOM_APPLICATION_ID_US,
    ous: DEXCOM_APPLICATION_ID_OUS,
    jp: DEXCOM_APPLICATION_ID_JP
}

var username = null;
var password = null;
var region = null;
var baseUrl = null;
var applicationId = null;
var sessionId = null;
var accountId = null;

function dex_init(_username, _password, _region = Regions.OUS) {
    username = _username;
    password = _password;
    region = _region.toLowerCase();
    baseUrl = BaseURLs[region] || BaseURLs.ous;
    applicationId = AppIDs[region] || AppIDs.ous;
    sessionId = null;
    accountId = null;
}

function dex_auth() {
    try {
        if (!accountId) {
            console.log('Getting account ID...');
            const authUrl = baseUrl + DEXCOM_AUTHENTICATE_ENDPOINT; 

            var req = new XMLHttpRequest();

            req.open('POST', authUrl, true);
            req.setRequestHeader('Content-Type', 'application/json');
            req.setRequestHeader('Accept', 'application/json');
            req.setRequestHeader('User-Agent', 'Dexcom Share/3.0.2.11');
            req.onload = 
                function(e) 
                {
                    if (req.readyState == 4) 
                    {
                        if (req.status == 200) 
                        {
                            accountId = (req.responseText).replace(/"/g, '');

                            console.log(`Account ID: ${accountId}`);
            
                            if (accountId === '00000000-0000-0000-0000-000000000000') {
                                throw new Error('Invalid credentials');
                            }

                            if (!sessionId) {
                                console.log('Getting session ID...');
                                const loginUrl = baseUrl + DEXCOM_LOGIN_ID_ENDPOINT;
                                
                                var loginReq = new XMLHttpRequest();

                                loginReq.open('POST', loginUrl, true);
                                loginReq.setRequestHeader('Content-Type', 'application/json');
                                loginReq.setRequestHeader('Accept', 'application/json');
                                loginReq.setRequestHeader('User-Agent', 'Dexcom Share/3.0.2.11');
                                loginReq.onload = 
                                    function(e) 
                                    {
                                        if (loginReq.readyState == 4) 
                                        {
                                            if (loginReq.status == 200) 
                                            {
                                                sessionId = (loginReq.responseText).replace(/"/g, '');
                                                console.log(`Session ID: ${sessionId}`);
                                
                                                if (sessionId === '00000000-0000-0000-0000-000000000000') {
                                                    throw new Error('Login failed');
                                                }
                                            } 
                                            else 
                                            {
                                                console.log('Error fetching session ID');
                                            }
                                        }
                                    };

                                loginReq.send(JSON.stringify({
                                    accountId: accountId,
                                    password: password,
                                    applicationId: applicationId
                                }));
                            }
                        } 
                        else 
                        {
                          console.log('Error fetching reading');
                        }
                    }
                };

            req.send(JSON.stringify({
                accountName: username,
                password: password,
                applicationId: applicationId
            }));
        }
    }
    catch (error) {
        throw new Error(`Authentication error: ${error.message}`);
    }
}
//##################### End of dexcom.js ##########################

// Listen for when the watchface is opened
Pebble.addEventListener('ready', 
  function(e) {
    console.log('PebbleKit JS ready!');

    getScoutReading();
  }
);

// Listen for when an AppMessage is received
Pebble.addEventListener('appmessage',
  function(e) {
    console.log('AppMessage received!');

    getScoutReading();
  }                     
);

function getScoutReading() {
  console.log('Getting a reading');
  
  dex_init('+35679255488', 'tFah$D8ZSOvzmpd', Regions.OUS);

  try {
    dex_auth();
    /*
    const result = dex_getLatestGlucoseWithDelta();

    console.log(`Current: ${result.current._value} mg/dL ${result.current._trend_arrow}`);
    console.log(`Change: ${result.current._delta} mg/dL`);
    console.log(`Trend: ${result.current._trend_description}`);
    console.log(`Rate: ${result.current._rate_of_change ? result.current._rate_of_change.toFixed(2) : 'N/A'} mg/dL/min`);
    console.log(`Status: ${result.current._status}`);
    */
  } catch (error) {
    console.error('Error:', error && error.message ? error.message : error);
  }
  /*
    var url = 'https://daf9.ns.gluroo.com/pebble?token=daf9b6a4-05d6-4603-91fd-07cb5ac5f8a5&count=1';
    var req = new XMLHttpRequest();

    req.open('GET', url, true);
    req.onload = 
      function(e) 
      {
        if (req.readyState == 4) 
        {
          if (req.status == 200) 
          {
            var response = JSON.parse(req.responseText);

            if (response) 
            {
              var sgv = response.bgs[0].sgv;
              console.log('SGV: ' + sgv);

              var bgdelta = response.bgs[0].bgdelta;
              console.log('BGDELTA: ' + bgdelta);

              var dictionary = {
                'SGV': sgv,
                'TREND': 0,
                'DIRECTION': '',
                'DATETIME': 0,
                'BGDELTA': bgdelta,
                'COB': 0,
                'IOB': 0
              };

              Pebble.sendAppMessage(dictionary,
                function(e) {
                  console.log('BG data sent to Pebble successfullly.');
                },
                function(e) {
                  console.log('Error sending BG data to Pebble.');
                }
              )
            }
          } 
          else 
          {
            console.log('Error fetching reading');
          }
      }
    }

    req.send(null);
    */
};