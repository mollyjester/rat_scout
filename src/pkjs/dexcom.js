//Credits: https://github.com/gagebenne/pydexcom
//Credits: https://github.com/faymaz/jsdexcom

import https from 'https';

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
        this.baseUrl = Dexcom.BaseUrls[this.region] || Dexcom.BaseUrls.ous;
        this.applicationId = Dexcom.AppIDs[this.region] || Dexcom.AppIDs.ous;
        this.sessionId = null;
        this.accountId = null;
    }

    makeRequest(options, data = null) {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    const response = {
                        status: res.statusCode,
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        json: () => JSON.parse(responseData),
                        text: () => responseData
                    };
                    resolve(response);
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (data) {
                req.write(JSON.stringify(data));
            }

            req.end();
        });
    }

    parseUrl(url, method = 'GET', extraHeaders = {}) {
        const parsedUrl = new URL(url);
        return {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            port: 443,
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
}