//Credits: https://github.com/gagebenne/pydexcom
// ES5 compatible version

// Constants
var DEXCOM_APPLICATION_ID_US = 'd89443d2-327c-4a6f-89e5-496bbb0317db';
var DEXCOM_APPLICATION_ID_OUS = DEXCOM_APPLICATION_ID_US;
var DEXCOM_APPLICATION_ID_JP = 'd8665ade-9673-4e27-9ff6-92db4ce13d13';

var DEXCOM_BASE_URL = 'https://share2.dexcom.com/ShareWebServices/Services/';
var DEXCOM_BASE_URL_OUS = 'https://shareous1.dexcom.com/ShareWebServices/Services/';
var DEXCOM_BASE_URL_JP = 'https://share.dexcom.jp/ShareWebServices/Services/';

var DEXCOM_AUTHENTICATE_ENDPOINT = "General/AuthenticatePublisherAccount";
var DEXCOM_LOGIN_ID_ENDPOINT = "General/LoginPublisherAccountById";
var DEXCOM_GLUCOSE_READINGS_ENDPOINT = "Publisher/ReadPublisherLatestGlucoseValues";

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
};

/**
 * Dexcom constructor
 * @param {string} username - Dexcom username
 * @param {string} password - Dexcom password
 * @param {Function} onResults - Callback on successful glucose fetch
 * @param {string} region - Region code (us, ous, jp)
 */
function Dexcom(username, password, onResults, region) {
    this.username = username;
    this.password = password;
    this.region = (region || Regions.OUS).toLowerCase();
    this.baseUrl = BaseURLs[this.region] || BaseURLs.ous;
    this.applicationId = AppIDs[this.region] || AppIDs.ous;
    this.sessionId = null;
    this.accountId = null;
    this.onResults = onResults;
}

/**
 * Make XHR request
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @returns {XMLHttpRequest} XHR object
 */
Dexcom.prototype.xhr = function(method, url) {
    var req = new XMLHttpRequest();
    req.open(method, url, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.setRequestHeader('Accept', 'application/json');
    req.setRequestHeader('User-Agent', 'Dexcom Share/3.0.2.11');
    return req;
};

/**
 * Trim quotes from string
 * @param {string} str - String to trim
 * @returns {string} Trimmed string
 */
Dexcom.prototype.trimQuotes = function(str) {
    return str.replace(/"/g, '');
};

/**
 * Format a glucose reading
 * @param {Object} reading - Raw reading object
 * @returns {Object} Formatted reading
 */
Dexcom.prototype.formatReading = function(reading) {
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
        _status: this.getGlucoseStatus(reading.Value)
    };
};

/**
 * Get glucose status
 * @param {number} value - BG value
 * @returns {string} Status (LOW, HIGH, IN RANGE)
 */
Dexcom.prototype.getGlucoseStatus = function(value) {
    if (value < 70) return 'LOW';
    if (value > 180) return 'HIGH';
    return 'IN RANGE';
};

/**
 * Get trend description from delta
 * @param {number} delta - BG delta value
 * @returns {string} Trend description
 */
Dexcom.prototype.getTrendDescription = function(delta) {
    if (delta === null) return 'Unknown';
    if (delta > 15) return 'Rising quickly';
    if (delta > 7) return 'Rising';
    if (delta > 3) return 'Rising slowly';
    if (delta >= -3) return 'Stable';
    if (delta >= -7) return 'Dropping slowly';
    if (delta >= -15) return 'Dropping';
    return 'Dropping quickly';
};

/**
 * Handle XHR response
 * @param {number} status - HTTP status
 * @param {string} responseText - Response body
 * @returns {Object} Parsed response
 */
Dexcom.prototype.parseResponse = function(status, responseText) {
    if (status === 200) {
        return {
            ok: true,
            data: this.trimQuotes(responseText)
        };
    } else if (status === 500) {
        return {
            ok: false,
            isServerError: true,
            data: JSON.parse(responseText)
        };
    }
    return {
        ok: false,
        isServerError: false,
        status: status
    };
};

/**
 * Authenticate with Dexcom API
 * @param {Function} callback - Callback when done
 */
Dexcom.prototype.authenticate = function(callback) {
    var self = this;
    
    try {
        // Step 1: Get account ID if not already set
        if (!this.accountId) {
            console.log('Getting account ID...');
            this._getAccountId(function() {
                // Step 2: Get session ID
                self._getSessionId(callback);
            });
        } else if (!this.sessionId) {
            // Step 2: Get session ID only
            this._getSessionId(callback);
        } else {
            // Already authenticated
            callback.call(self);
        }
    } catch (error) {
        throw new Error(`Authentication error: ${error.message}`);
    }
};

/**
 * Get account ID from Dexcom API
 * @param {Function} callback - Callback when complete
 */
Dexcom.prototype._getAccountId = function(callback) {
    var self = this;
    var authUrl = this.baseUrl + DEXCOM_AUTHENTICATE_ENDPOINT;
    var req = this.xhr('POST', authUrl);

    req.onload = function() {
        if (req.readyState !== 4) return;

        if (req.status === 200) {
            self.accountId = self.trimQuotes(req.responseText);
            console.log(`Account ID: ${self.accountId}`);

            if (self.accountId === '00000000-0000-0000-0000-000000000000') {
                throw new Error('Invalid credentials');
            }

            callback.call(self);
        } else {
            throw new Error(`Error fetching account ID: ${req.status}`);
        }
    };

    req.send(JSON.stringify({
        accountName: this.username,
        password: this.password,
        applicationId: this.applicationId
    }));
};

/**
 * Get session ID from Dexcom API
 * @param {Function} callback - Callback when complete
 */
Dexcom.prototype._getSessionId = function(callback) {
    var self = this;
    var loginUrl = this.baseUrl + DEXCOM_LOGIN_ID_ENDPOINT;
    var loginReq = this.xhr('POST', loginUrl);
    var timeoutHandle = null;

    // Set 15 second timeout for session ID fetch
    loginReq.timeout = 15000;

    loginReq.onload = function() {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (loginReq.readyState !== 4) return;

        if (loginReq.status === 200) {
            self.sessionId = self.trimQuotes(loginReq.responseText);
            console.log(`Session ID: ${self.sessionId}`);

            if (self.sessionId === '00000000-0000-0000-0000-000000000000') {
                throw new Error('Login failed');
            }

            callback.call(self);
        } else {
            throw new Error(`Error fetching session ID: ${loginReq.status}`);
        }
    };

    loginReq.onerror = function() {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        console.error('Network error fetching session ID');
        throw new Error('Network error fetching session ID');
    };

    loginReq.ontimeout = function() {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        console.error('Timeout fetching session ID (15s)');
        throw new Error('Timeout fetching session ID');
    };

    // Fallback timeout using setTimeout for better compatibility
    timeoutHandle = setTimeout(function() {
        if (loginReq.readyState !== 4) {
            console.error('Request timeout: session ID fetch took too long');
            loginReq.abort();
        }
    }, 15000);

    loginReq.send(JSON.stringify({
        accountId: this.accountId,
        password: this.password,
        applicationId: this.applicationId
    }));
};

/**
 * Get latest glucose reading with delta change
 */
Dexcom.prototype.getLatestGlucoseWithDelta = function() {
    var self = this;
    
    if (!this.sessionId) {
        this.authenticate(function() {
            self._fetchGlucoseReadings();
        });
        return;
    }

    this._fetchGlucoseReadings();
};

/**
 * Fetch glucose readings from Dexcom API
 */
Dexcom.prototype._fetchGlucoseReadings = function() {
    var self = this;
    
    try {
        console.log('Fetching glucose readings...');

        var url = this.baseUrl + DEXCOM_GLUCOSE_READINGS_ENDPOINT;
        var req = this.xhr('POST', url);
        var timeoutHandle = null;

        // Set 15 second timeout for glucose readings
        req.timeout = 15000;

        req.onload = function() {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (req.readyState !== 4) return;

            try {
                if (req.status === 200) {
                    self._handleGlucoseResponse(JSON.parse(req.responseText));
                } else if (req.status === 500) {
                    self._handleServerError(JSON.parse(req.responseText));
                } else {
                    throw new Error(`Failed to get readings: ${req.status}`);
                }
            } catch (error) {
                console.error(`Error processing response: ${error.message}`);
            }
        };

        req.onerror = function() {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            console.error('Network error fetching glucose readings');
        };

        req.ontimeout = function() {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            console.error('Timeout fetching glucose readings (15s)');
        };

        // Fallback timeout using setTimeout for better compatibility
        timeoutHandle = setTimeout(function() {
            if (req.readyState !== 4) {
                console.error('Request timeout: glucose readings fetch took too long');
                req.abort();
            }
        }, 15000);

        req.send(JSON.stringify({
            sessionId: this.sessionId,
            minutes: 10,
            maxCount: 2
        }));
    } catch (error) {
        console.error(`Error fetching glucose: ${error.message}`);
    }
};

/**
 * Handle successful glucose response
 * @param {Array} readings - Array of glucose readings
 */
Dexcom.prototype._handleGlucoseResponse = function(readings) {
    if (!Array.isArray(readings) || readings.length === 0) {
        throw new Error('No readings available');
    }

    var current = this.formatReading(readings[0]);
    var previous = readings.length > 1 ? this.formatReading(readings[1]) : null;
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
        _trend_description: this.getTrendDescription(delta)
    };

    this.onResults({
        current: currentObj,
        previous: previous
    });
};

/**
 * Handle server error response
 * @param {Object} error - Error object from server
 */
Dexcom.prototype._handleServerError = function(error) {
    var self = this;
    
    // Track retry attempts to prevent infinite loops
    if (!this.retryCount) {
        this.retryCount = 0;
    }
    
    if (error.Code === 'SessionIdNotFound' || error.Code === 'SessionNotValid') {
        // Limit retries to prevent infinite loop
        if (this.retryCount < 2) {
            this.retryCount++;
            console.log(`Session error: ${error.Code}, re-authenticating (attempt ${this.retryCount})...`);
            this.sessionId = null;
            this.authenticate(function() {
                self.getLatestGlucoseWithDelta();
            });
        } else {
            console.error(`Session error: ${error.Code}, max retries reached (${this.retryCount})`);
            this.retryCount = 0;
            throw new Error(`Session validation failed after ${this.retryCount} attempts`);
        }
    } else {
        this.retryCount = 0;
        throw new Error(`Server error: ${error.Message}`);
    }
};

module.exports = Dexcom;