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
}