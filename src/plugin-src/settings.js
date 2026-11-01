// Rat Scout Glucose settings: the Dexcom account and display units, set on the plugin's own
// settings page (plugin/config.html). ES5 + Promise.
//
// The plugin is its own pbw with its own uuid, so it shares no storage with the watchface.
// Login, region and units live in the plugin's localStorage; the password lives in
// Pebble.secureStorage, which only this plugin can read and which is encrypted by the phone's
// keystore (Pebble plugins preview guide, "The script").

var LOGIN_KEY = 'ratscout.settings.login';
var REGION_KEY = 'ratscout.settings.region';
var UNITS_KEY = 'ratscout.settings.units';
var PASSWORD_KEY = 'dexcom.password';

var REGIONS = ['ous', 'us', 'jp'];
var UNITS = ['mg/dL', 'mmol/L'];
var DEFAULT_REGION = 'ous';
var DEFAULT_UNITS = 'mg/dL';

/**
 * Read the stored password.
 * @param {?Object} secure - Pebble.secureStorage (absent: no password)
 * @returns {Promise} Resolves the password, '' if none
 */
function readPassword(secure) {
    if (!secure || typeof secure.getItem !== 'function') return Promise.resolve('');
    return Promise.resolve(secure.getItem(PASSWORD_KEY)).then(function(v) {
        return v ? String(v) : '';
    });
}

/**
 * Pick a value from a list, falling back to a default.
 * @param {*} value - Candidate
 * @param {Array} allowed - Allowed values
 * @param {string} fallback - Default
 * @returns {string} Allowed value
 */
function oneOf(value, allowed, fallback) {
    return allowed.indexOf(value) !== -1 ? value : fallback;
}

/**
 * Load everything the source handler needs.
 * @param {Object} storage - localStorage
 * @param {?Object} secure - Pebble.secureStorage
 * @returns {Promise} Resolves {DEX_LOGIN, DEX_PASSWORD, DEX_REGION, BG_UNITS}
 */
function load(storage, secure) {
    return readPassword(secure).then(function(password) {
        return {
            DEX_LOGIN: storage.getItem(LOGIN_KEY) || '',
            DEX_PASSWORD: password,
            DEX_REGION: oneOf(storage.getItem(REGION_KEY), REGIONS, DEFAULT_REGION),
            BG_UNITS: oneOf(storage.getItem(UNITS_KEY), UNITS, DEFAULT_UNITS)
        };
    });
}

/**
 * What the settings page may see: never the password itself.
 * @param {Object} storage - localStorage
 * @param {?Object} secure - Pebble.secureStorage
 * @returns {Promise} Resolves {login, region, units, hasPassword}
 */
function view(storage, secure) {
    return load(storage, secure).then(function(s) {
        return { login: s.DEX_LOGIN, region: s.DEX_REGION, units: s.BG_UNITS, hasPassword: !!s.DEX_PASSWORD };
    });
}

/**
 * Store a settings page submission. An empty password keeps the stored one.
 * @param {Object} storage - localStorage
 * @param {?Object} secure - Pebble.secureStorage
 * @param {Object} msg - {login, password, region, units}
 * @returns {Promise} Resolves when stored
 */
function save(storage, secure, msg) {
    msg = msg || {};
    storage.setItem(LOGIN_KEY, String(msg.login || '').trim());
    storage.setItem(REGION_KEY, oneOf(msg.region, REGIONS, DEFAULT_REGION));
    storage.setItem(UNITS_KEY, oneOf(msg.units, UNITS, DEFAULT_UNITS));
    if (typeof msg.password === 'string' && msg.password !== '') {
        if (!secure || typeof secure.setItem !== 'function') {
            return Promise.reject(new Error('secure storage unavailable'));
        }
        return Promise.resolve(secure.setItem(PASSWORD_KEY, msg.password));
    }
    return Promise.resolve();
}

module.exports = {
    LOGIN_KEY: LOGIN_KEY,
    REGION_KEY: REGION_KEY,
    UNITS_KEY: UNITS_KEY,
    PASSWORD_KEY: PASSWORD_KEY,
    load: load,
    view: view,
    save: save
};
