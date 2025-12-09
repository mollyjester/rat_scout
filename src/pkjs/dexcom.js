//Credits: https://github.com/gagebenne/pydexcom
// ES5 compatible version
var DEXCOM_APPLICATION_ID_US = 'd89443d2-327c-4a6f-89e5-496bbb0317db';
var DEXCOM_APPLICATION_ID_OUS = DEXCOM_APPLICATION_ID_US;
var DEXCOM_APPLICATION_ID_JP = 'd8665ade-9673-4e27-9ff6-92db4ce13d13'

var DEXCOM_BASE_URL = 'https://share2.dexcom.com/ShareWebServices/Services/'
var DEXCOM_BASE_URL_OUS = 'https://shareous1.dexcom.com/ShareWebServices/Services/'
var DEXCOM_BASE_URL_JP = 'https://share.dexcom.jp/ShareWebServices/Services/'

var DEXCOM_AUTHENTICATE_ENDPOINT = "General/AuthenticatePublisherAccount"
var DEXCOM_LOGIN_ID_ENDPOINT = "General/LoginPublisherAccountById"
var DEXCOM_GLUCOSE_READINGS_ENDPOINT = "Publisher/ReadPublisherLatestGlucoseValues"

var Regions = {
    US: 'us',
    OUS: 'ous',
    JP: 'jp'
};

var BaseURLs = {
    us: DEXCOM_BASE_URL,
    ous: DEXCOM_BASE_URL_OUS,
    jp: DEXCOM_BASE_URL_JP
};

var AppIDs = {
    us: DEXCOM_APPLICATION_ID_US,
    ous: DEXCOM_APPLICATION_ID_OUS,
    jp: DEXCOM_APPLICATION_ID_JP
}

function Dexcom(_username, _password, _onResults, _region) {
    this.username = _username;
    this.password = _password;
    this.region = (_region || Regions.OUS).toLowerCase();
    this.baseUrl = BaseURLs[this.region] || BaseURLs.ous;
    this.applicationId = AppIDs[this.region] || AppIDs.ous;
    this.sessionId = null;
    this.accountId = null;
    this.xhr = xhr;
    this.formatReading = formatReading;
    this.getGlucoseStatus = getGlucoseStatus;
    this.getTrendDescription = getTrendDescription;
    this.authenticate = authenticate;
    this.getLatestGlucoseWithDelta = getLatestGlucoseWithDelta;
    this._fetchGlucoseReadings = _fetchGlucoseReadings;
    this.onResults = _onResults;
}

function xhr(_method, _url) {
    var req = new XMLHttpRequest();
    req.open(_method, _url, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.setRequestHeader('Accept', 'application/json');
    req.setRequestHeader('User-Agent', 'Dexcom Share/3.0.2.11');
    return req;
}

function formatReading(reading, dexcom) {
    var TREND_ARROWS = {
        None: '→',          
        DoubleUp: '↑↑',     
        SingleUp: '↑',      
        FortyFiveUp: '↗',   
        Flat: '→',          
        FortyFiveDown: '↘', 
        SingleDown: '↓',    
        DoubleDown: '↓↓',   
        NotComputable: '?', 
        RateOutOfRange: '⚠️'
    };

    return {
        _json: {
            WT: reading.WT,
            ST: reading.ST,
            DT: reading.DT,
            Value: reading.Value,
            Trend: reading.Trend
        },
        _value: reading.Value,
        _trend_direction: reading.Trend,
        _trend_arrow: TREND_ARROWS[reading.Trend] || '?',
        _datetime: new Date(parseInt(reading.WT.match(/\d+/)[0])),
        _status: dexcom.getGlucoseStatus(reading.Value)
    };
}

function getGlucoseStatus(value) {
    /*TODO: Make thresholds configurable*/
    if (value < 70) return 'LOW';     
    if (value > 180) return 'HIGH';   
    return 'IN RANGE';                
}

function getTrendDescription(delta) {
    if (delta === null) return 'Unknown';
    if (delta > 15) return 'Rising quickly';    
    if (delta > 7) return 'Rising';             
    if (delta > 3) return 'Rising slowly';      
    if (delta >= -3) return 'Stable';           
    if (delta >= -7) return 'Dropping slowly';  
    if (delta >= -15) return 'Dropping';        
    return 'Dropping quickly';                  
}

function authenticate(_callback) {
    var self = this;
    try {
        if (!this.accountId) {
            console.log('Getting account ID...');
            var authUrl = this.baseUrl + DEXCOM_AUTHENTICATE_ENDPOINT; 
            var req = this.xhr('POST', authUrl);

            req.onload = 
                function(e) {
                    if (req.readyState == 4) 
                    {
                        if (req.status == 200) 
                        {
                            self.accountId = (req.responseText).replace(/"/g, '');

                            console.log('Account ID: ' + self.accountId);
            
                            if (self.accountId === '00000000-0000-0000-0000-000000000000') {
                                throw new Error('Invalid credentials');
                            }

                            if (!self.sessionId) {
                                console.log('Getting session ID...');
                                var loginUrl = self.baseUrl + DEXCOM_LOGIN_ID_ENDPOINT;
                                var loginReq = self.xhr('POST', loginUrl);
                                
                                loginReq.onload = 
                                    function(e) {
                                        if (loginReq.readyState == 4) 
                                        {
                                            if (loginReq.status == 200) 
                                            {
                                                self.sessionId = (loginReq.responseText).replace(/"/g, '');
                                                console.log('Session ID: ' + self.sessionId);
                                
                                                if (self.sessionId === '00000000-0000-0000-0000-000000000000') {
                                                    throw new Error('Login failed');
                                                }

                                                _callback.call(self);
                                            } 
                                            else 
                                            {
                                                console.log('Error fetching session ID');
                                            }
                                        }
                                    };

                                loginReq.send(JSON.stringify({
                                    accountId: self.accountId,
                                    password: self.password,
                                    applicationId: self.applicationId
                                }));
                            }
                            else {
                                _callback.call(self);
                            }
                        } 
                        else 
                        {
                          console.log('Error fetching reading');
                        }
                    }
                };

            req.send(JSON.stringify({
                accountName: self.username,
                password: self.password,
                applicationId: self.applicationId
            }));
        }
        else {
            _callback.call(self);
        }
    }
    catch (error) {
        throw new Error('Authentication error: '+ error.message);
    }
}

function getLatestGlucoseWithDelta() {
    if (!this.sessionId) {
        this.authenticate(this.getLatestGlucoseWithDelta);
        return;
    }

    this._fetchGlucoseReadings();
}

function _fetchGlucoseReadings() {
    try {
        console.log('Fetching glucose readings...');

        var self = this;
        var url = this.baseUrl + DEXCOM_GLUCOSE_READINGS_ENDPOINT;
        var req = this.xhr('POST', url);

        req.onload = 
            function(e) {
                if (req.readyState == 4) {
                    if (req.status == 200) 
                    {
                        var readings = JSON.parse(req.responseText);

                        if (!Array.isArray(readings) || readings.length === 0) {
                            throw new Error('No readings available');
                        }

                        var current = self.formatReading(readings[0], self);
                        var previous = readings.length > 1 ? self.formatReading(readings[1], self) : null;
                        var delta = previous ? current._value - previous._value : null;
                        var deltaTime = previous ? 
                            (current._datetime.getTime() - previous._datetime.getTime()) / (1000 * 60) :
                            null;
                        
                        var currentObj = {
                            _json: current._json,
                            _value: current._value,
                            _trend_direction: current._trend_direction,
                            _trend_arrow: current._trend_arrow,
                            _datetime: current._datetime,
                            _status: current._status,
                            _delta: delta,
                            _delta_time: deltaTime,
                            _previous_value: previous ? previous._value : null,
                            _rate_of_change: deltaTime ? (delta / deltaTime) : null,
                            _trend_description: self.getTrendDescription(delta)
                        };

                        self.onResults({
                            current: currentObj,
                            previous: previous 
                        });
                    } 
                    else if (req.status == 500) 
                    {
                        var error = JSON.parse(req.responseText);

                        if (error.Code === 'SessionIdNotFound') {
                            self.sessionId = null;
                            self.authenticate(self.getLatestGlucoseWithDelta);
                        }
                        else {
                            throw new Error('Server error: ' + error.Message);
                        }
                    }
                    else 
                    {
                        throw new Error('Failed to get readings: ' + req.status);
                    }
                }
            };

        req.send(JSON.stringify({
                sessionId: this.sessionId,
                minutes: 10,
                maxCount: 2
            }));
    } 
    catch (error) {
        if (error.message.includes('SessionIdNotFound')) {
            this.sessionId = null;
            this.accountId = null;
            this.authenticate(this.getLatestGlucoseWithDelta);
        }
        else {
            throw error;
        }
    }
}
/*
var username = null;
var password = null;
var region = null;
var baseUrl = null;
var applicationId = null;
var sessionId = null;
var accountId = null;

function init(_username, _password, _region = Regions.OUS) {
    username = _username;
    password = _password;
    region = _region.toLowerCase();
    baseUrl = BaseURLs[region] || BaseURLs.ous;
    applicationId = AppIDs[region] || AppIDs.ous;
    sessionId = null;
    accountId = null;
}

function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        let url;
        let method = 'GET';
        let headers = {};

        if (typeof options === 'string') {
            url = options;
        } else if (options && options.url) {
            url = options.url;
            method = options.method || method;
            headers = options.headers || {};
        } else if (options && options.hostname && options.path) {
            const protocol = options.port === 443 ? 'https:' : 'http:';
            url = `${protocol}//${options.hostname}${options.path}`;
            method = options.method || method;
            headers = options.headers || {};
        } else {
            return reject(new Error('Invalid request options'));
        }

        try {
            const xhr = new XMLHttpRequest();
            xhr.open(method, url);

            Object.keys(headers).forEach((k) => {
                try { xhr.setRequestHeader(k, headers[k]); } catch (e) {}
            });

            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    const responseText = xhr.responseText || '';
                    const status = xhr.status || 0;
                    const response = {
                        status,
                        ok: status >= 200 && status < 300,
                        json: () => JSON.parse(responseText),
                        text: () => responseText
                    };
                    resolve(response);
                }
            };

            xhr.onerror = function () {
                reject(new Error('Network request failed'));
            };

            if (data) {
                const payload = typeof data === 'string' ? data : JSON.stringify(data);
                xhr.send(payload);
            } else {
                xhr.send();
            }
        } catch (err) {
            reject(err);
        }
    });
}

function parseUrl(url, method = 'GET') {
    const parsedUrl = new URL(url);
    return {
        url: parsedUrl.href,
        method,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Dexcom Share/3.0.2.11'
        }
    };
}

function authenticate() {
    try {
    
        if (!accountId) {
            console.log('Getting account ID...');
            const authUrl = baseUrl + Dexcom.DEXCOM_AUTHENTICATE_ENDPOINT; 
            const authOptions = parseUrl(authUrl, 'POST');
            
            const response = makeRequest(authOptions, {
                accountName: username,
                password: password,
                applicationId: applicationId
            });

            if (!response.ok) {
                throw new Error(`Account authentication failed: ${response.status}`);
            }

            accountId = (response.text()).replace(/"/g, '');
            
            if (accountId === '00000000-0000-0000-0000-000000000000') {
                throw new Error('Invalid credentials');
            }
        }
        
        console.log('Getting session ID...');
        const loginUrl = baseUrl + Dexcom.DEXCOM_LOGIN_ID_ENDPOINT;
        const loginOptions = parseUrl(loginUrl, 'POST');
        
        const loginResponse = makeRequest(loginOptions, {
            accountId: accountId,
            password: password,
            applicationId: applicationId
        });

        if (!loginResponse.ok) {
            throw new Error(`Session login failed: ${loginResponse.status}`);
        }

        sessionId = (loginResponse.text()).replace(/"/g, '');
        
        if (sessionId === '00000000-0000-0000-0000-000000000000') {
            throw new Error('Login failed');
        }

        return sessionId;
    } 
    catch (error) {
        throw new Error(`Authentication error: ${error.message}`);
    }
}

function getLatestGlucoseWithDelta() {
    if (!sessionId) {
        authenticate();
    }

    try {
        console.log('Fetching glucose readings...');

        const url = `${baseUrl}${Dexcom.DEXCOM_GLUCOSE_READINGS_ENDPOINT}?sessionId=${sessionId}&minutes=10&maxCount=2`;
        const options = parseUrl(url, 'POST');
        const response = makeRequest(options);

        
        if (response.status === 500) {
            const error = response.json();

            if (error.Code === 'SessionIdNotFound') {
                sessionId = null;
                authenticate();

                return getLatestGlucoseWithDelta();
            }

            throw new Error(`Server error: ${error.Message}`);
        }

        if (!response.ok) {
            throw new Error(`Failed to get readings: ${response.status}`);
        }

        const readings = response.json();

        if (!Array.isArray(readings) || readings.length === 0) {
            throw new Error('No readings available');
        }

        const current = formatReading(readings[0]);
        const previous = readings.length > 1 ? formatReading(readings[1]) : null;
        const delta = previous ? current._value - previous._value : null;
        const deltaTime = previous ? 
            (current._datetime.getTime() - previous._datetime.getTime()) / (1000 * 60) :
            null;
        
        var currentObj = {
            _json: current._json,
            _value: current._value,
            _trend_direction: current._trend_direction,
            _trend_arrow: current._trend_arrow,
            _datetime: current._datetime,
            _status: current._status,
            _delta: delta,
            _delta_time: deltaTime,
            _previous_value: previous ? previous._value : null,
            _rate_of_change: deltaTime ? (delta / deltaTime) : null,
            _trend_description: getTrendDescription(delta)
        };
        
        return {
            current: currentObj,
            previous: previous 
        };
    } 
    catch (error) {
        if (error.message.includes('SessionIdNotFound')) {
            sessionId = null;
            accountId = null;
            authenticate();
            return getLatestGlucoseWithDelta();
        }

        throw error;
    }
}

function getLatestGlucose() {
    if (!sessionId) {
        authenticate();
    }

    try {
        const url = `${baseUrl}${Dexcom.DEXCOM_GLUCOSE_READINGS_ENDPOINT}?sessionId=${sessionId}&minutes=10&maxCount=1`;
        const options = parseUrl(url, 'POST');
        const response = makeRequest(options);

        if (response.status === 500) {
            const error = response.json();
            if (error.Code === 'SessionIdNotFound') {
                sessionId = null;
                return getLatestGlucose();
            }

            throw new Error(`Server error: ${error.Message}`);
        }

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        const readings = response.json();

        if (!Array.isArray(readings) || readings.length === 0) {
            throw new Error('No readings available');
        }

        return formatReading(readings[0]);
    } 
    catch (error) {
        if (error.message.includes('SessionIdNotFound')) {
            sessionId = null;
            return getLatestGlucose();
        }

        throw error;
    }
}

function formatReading(reading) {
    const TREND_ARROWS = {
        None: '→',          
        DoubleUp: '↑↑',     
        SingleUp: '↑',      
        FortyFiveUp: '↗',   
        Flat: '→',          
        FortyFiveDown: '↘', 
        SingleDown: '↓',    
        DoubleDown: '↓↓',   
        NotComputable: '?', 
        RateOutOfRange: '⚠️'
    };

    return {
        _json: {
            WT: reading.WT,
            ST: reading.ST,
            DT: reading.DT,
            Value: reading.Value,
            Trend: reading.Trend
        },
        _value: reading.Value,
        _trend_direction: reading.Trend,
        _trend_arrow: TREND_ARROWS[reading.Trend] || '?',
        _datetime: new Date(parseInt(reading.WT.match(/\d+/)[0])),
        _status: getGlucoseStatus(reading.Value)
    };
}

function getGlucoseStatus(value) {
    if (value < 70) return 'LOW';     
    if (value > 180) return 'HIGH';   
    return 'IN RANGE';                
}

function getTrendDescription(delta) {
    if (delta === null) return 'Unknown';
    if (delta > 15) return 'Rising quickly';    
    if (delta > 7) return 'Rising';             
    if (delta > 3) return 'Rising slowly';      
    if (delta >= -3) return 'Stable';           
    if (delta >= -7) return 'Dropping slowly';  
    if (delta >= -15) return 'Dropping';        
    return 'Dropping quickly';                  
}
*/
module.exports = Dexcom;