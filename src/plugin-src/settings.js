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
// Bumped by every save that stores a new password, so the plugin can tell credentials apart
// without keeping anything derived from the password (dexcom_guard.js credKey).
var CRED_VERSION_KEY = 'ratscout.settings.credVersion';

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
    // Inside the chain, so a throwing secure storage rejects instead of escaping the caller.
    return Promise.resolve().then(function() {
        if (!secure || typeof secure.getItem !== 'function') return '';
        return secure.getItem(PASSWORD_KEY);
    }).then(function(v) {
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
 * @returns {Promise} Resolves {DEX_LOGIN, DEX_PASSWORD, DEX_REGION, BG_UNITS, DEX_CRED_VERSION}
 */
function load(storage, secure) {
    return readPassword(secure).then(function(password) {
        return {
            DEX_LOGIN: storage.getItem(LOGIN_KEY) || '',
            DEX_PASSWORD: password,
            DEX_REGION: oneOf(storage.getItem(REGION_KEY), REGIONS, DEFAULT_REGION),
            BG_UNITS: oneOf(storage.getItem(UNITS_KEY), UNITS, DEFAULT_UNITS),
            DEX_CRED_VERSION: storage.getItem(CRED_VERSION_KEY) || '0'
        };
    });
}

/**
 * Bump the credential version (a new password was stored).
 * @param {Object} storage - localStorage
 */
function bumpCredVersion(storage) {
    var v = parseInt(storage.getItem(CRED_VERSION_KEY), 10) || 0;
    storage.setItem(CRED_VERSION_KEY, String(v + 1));
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
 * @returns {Promise} Resolves {credentialsChanged} when stored
 */
function save(storage, secure, msg) {
    msg = msg || {};
    return Promise.resolve().then(function() {
        var login = String(msg.login || '').trim();
        var region = oneOf(msg.region, REGIONS, DEFAULT_REGION);
        var changed = login !== (storage.getItem(LOGIN_KEY) || '') ||
            region !== oneOf(storage.getItem(REGION_KEY), REGIONS, DEFAULT_REGION);
        storage.setItem(LOGIN_KEY, login);
        storage.setItem(REGION_KEY, region);
        storage.setItem(UNITS_KEY, oneOf(msg.units, UNITS, DEFAULT_UNITS));
        if (typeof msg.password !== 'string' || msg.password === '') return { credentialsChanged: changed };
        if (!secure || typeof secure.setItem !== 'function') throw new Error('secure storage unavailable');
        return readPassword(secure).then(function(old) {
            if (old === msg.password) return { credentialsChanged: changed };
            return Promise.resolve(secure.setItem(PASSWORD_KEY, msg.password)).then(function() {
                bumpCredVersion(storage);
                return { credentialsChanged: true };
            });
        });
    });
}

module.exports = {
    LOGIN_KEY: LOGIN_KEY,
    REGION_KEY: REGION_KEY,
    UNITS_KEY: UNITS_KEY,
    PASSWORD_KEY: PASSWORD_KEY,
    CRED_VERSION_KEY: CRED_VERSION_KEY,
    bumpCredVersion: bumpCredVersion,
    load: load,
    view: view,
    save: save
};
