//Credits: https://github.com/gagebenne/pydexcom
//Credits: https://github.com/faymaz/jsdexcom

class Dexcom {
    static DEXCOM_APPLICATION_ID_US = 'd89443d2-327c-4a6f-89e5-496bbb0317db';
    static DEXCOM_APPLICATION_ID_OUS = DEXCOM_APPLICATION_ID_US;
    static DEXCOM_APPLICATION_ID_JP = 'd8665ade-9673-4e27-9ff6-92db4ce13d13'

    static DEXCOM_BASE_URL = 'https://share2.dexcom.com/ShareWebServices/Services/'
    static DEXCOM_BASE_URL_OUS = 'https://shareous1.dexcom.com/ShareWebServices/Services/'
    static DEXCOM_BASE_URL_JP = 'https://share.dexcom.jp/ShareWebServices/Services/'

    static DEXCOM_AUTHENTICATE_ENDPOINT = "General/AuthenticatePublisherAccount"
    static DEXCOM_LOGIN_ID_ENDPOINT = "General/LoginPublisherAccountById"
    static DEXCOM_GLUCOSE_READINGS_ENDPOINT = "Publisher/ReadPublisherLatestGlucoseValues"

    static Regions = {
        US: 'us',
        OUS: 'ous',
        JP: 'jp'
    };

    static BaseURLs = {
        us: DEXCOM_BASE_URL,
        ous: DEXCOM_BASE_URL_OUS,
        jp: DEXCOM_BASE_URL_JP
    };

    static AppIDs = {
        us: DEXCOM_APPLICATION_ID_US,
        ous: DEXCOM_APPLICATION_ID_OUS,
        jp: DEXCOM_APPLICATION_ID_JP
    }

    constructor(username, password, region = Dexcom.Regions.OUS) {
        this.username = username;
        this.password = password;
        this.region = region.toLowerCase();
        this.baseUrl = Dexcom.BaseURLs[this.region] || Dexcom.BaseURLs.ous;
        this.applicationId = Dexcom.AppIDs[this.region] || Dexcom.AppIDs.ous;
        this.sessionId = null;
        this.accountId = null;
    }

    makeRequest(options, data = null) {
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

    parseUrl(url, method = 'GET', extraHeaders = {}) {
        const parsedUrl = new URL(url);
        return {
            url: parsedUrl.href,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Dexcom Share/3.0.2.11',
                ...extraHeaders
            }
        };
    }

    async authenticate() {
        try {
        
            if (!this.accountId) {
                console.log('Getting account ID...');
                const authUrl = this.baseUrl + Dexcom.DEXCOM_AUTHENTICATE_ENDPOINT; 
                const authOptions = this.parseUrl(authUrl, 'POST');
                
                const response = await this.makeRequest(authOptions, {
                    accountName: this.username,
                    password: this.password,
                    applicationId: this.applicationId
                });

                if (!response.ok) {
                    throw new Error(`Account authentication failed: ${response.status}`);
                }

                this.accountId = (await response.text()).replace(/"/g, '');
                
                if (this.accountId === '00000000-0000-0000-0000-000000000000') {
                    throw new Error('Invalid credentials');
                }
            }

            
            console.log('Getting session ID...');
            const loginUrl = this.baseUrl + Dexcom.DEXCOM_LOGIN_ID_ENDPOINT;
            const loginOptions = this.parseUrl(loginUrl, 'POST');
            
            const loginResponse = await this.makeRequest(loginOptions, {
                accountId: this.accountId,
                password: this.password,
                applicationId: this.applicationId
            });

            if (!loginResponse.ok) {
                throw new Error(`Session login failed: ${loginResponse.status}`);
            }

            this.sessionId = (await loginResponse.text()).replace(/"/g, '');
            
            if (this.sessionId === '00000000-0000-0000-0000-000000000000') {
                throw new Error('Login failed');
            }

            return this.sessionId;
        } 
        catch (error) {
            throw new Error(`Authentication error: ${error.message}`);
        }
    }

    async getLatestGlucoseWithDelta() {
        if (!this.sessionId) {
            await this.authenticate();
        }

        try {
            console.log('Fetching glucose readings...');

            const url = `${this.baseUrl}${Dexcom.DEXCOM_GLUCOSE_READINGS_ENDPOINT}?sessionId=${this.sessionId}&minutes=10&maxCount=2`;
            const options = this.parseUrl(url, 'POST');
            const response = await this.makeRequest(options);

            
            if (response.status === 500) {
                const error = await response.json();

                if (error.Code === 'SessionIdNotFound') {
                    this.sessionId = null;
                    await this.authenticate();

                    return this.getLatestGlucoseWithDelta();
                }

                throw new Error(`Server error: ${error.Message}`);
            }

            if (!response.ok) {
                throw new Error(`Failed to get readings: ${response.status}`);
            }

            const readings = await response.json();

            if (!Array.isArray(readings) || readings.length === 0) {
                throw new Error('No readings available');
            }

            const current = this.formatReading(readings[0]);
            const previous = readings.length > 1 ? this.formatReading(readings[1]) : null;
            const delta = previous ? current._value - previous._value : null;
            const deltaTime = previous ? 
                (current._datetime.getTime() - previous._datetime.getTime()) / (1000 * 60) :
                null;
            
            return {
                current: {
                    ...current,
                    _delta: delta,                                         
                    _delta_time: deltaTime,                                
                    _previous_value: previous?._value,                     
                    _rate_of_change: deltaTime ? (delta / deltaTime) : null,
                    _trend_description: this.getTrendDescription(delta)     
                },
                previous: previous 
            };
        } 
        catch (error) {
            if (error.message.includes('SessionIdNotFound')) {
                this.sessionId = null;
                this.accountId = null;
                await this.authenticate();
                return this.getLatestGlucoseWithDelta();
            }

            throw error;
        }
    }

    async getLatestGlucose() {
        if (!this.sessionId) {
            await this.authenticate();
        }

        try {
            const url = `${this.baseUrl}${Dexcom.DEXCOM_GLUCOSE_READINGS_ENDPOINT}?sessionId=${this.sessionId}&minutes=10&maxCount=1`;
            const options = this.parseUrl(url, 'POST');
            const response = await this.makeRequest(options);

            if (response.status === 500) {
                const error = await response.json();
                if (error.Code === 'SessionIdNotFound') {
                    this.sessionId = null;
                    return this.getLatestGlucose();
                }

                throw new Error(`Server error: ${error.Message}`);
            }

            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            const readings = await response.json();

            if (!Array.isArray(readings) || readings.length === 0) {
                throw new Error('No readings available');
            }

            return this.formatReading(readings[0]);
        } 
        catch (error) {
            if (error.message.includes('SessionIdNotFound')) {
                this.sessionId = null;
                return this.getLatestGlucose();
            }

            throw error;
        }
    }

    formatReading(reading) {
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
            _status: this.getGlucoseStatus(reading.Value)
        };
    }

    getGlucoseStatus(value) {
        if (value < 70) return 'LOW';     
        if (value > 180) return 'HIGH';   
        return 'IN RANGE';                
    }

    getTrendDescription(delta) {
        if (delta === null) return 'Unknown';
        if (delta > 15) return 'Rising quickly';    
        if (delta > 7) return 'Rising';             
        if (delta > 3) return 'Rising slowly';      
        if (delta >= -3) return 'Stable';           
        if (delta >= -7) return 'Dropping slowly';  
        if (delta >= -15) return 'Dropping';        
        return 'Dropping quickly';                  
    }
}

export default Dexcom;