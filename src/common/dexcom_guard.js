// Dexcom login guard, shared by the plugin (src/plugin-src/main.js) and by
// PKJS in fallback mode (src/pkjs/glucose.js). ES5.
//
// Both run against the same localStorage (Pebble plugins preview guide:
// "localStorage for state, shared with your app's PKJS"), so the guard's
// state lives there. Whether writes are atomic between the two contexts is
// UNVERIFIED, so this is best-effort: the worst case equals having no guard.
//
// Dexcom's lockout and rate-limit thresholds are UNVERIFIED and are never
// tested against the real service; the limits below are deliberately
// conservative and are verified only by unit tests with a mocked fetch.

var INFLIGHT_KEY = 'ratscout.auth.inflight';
var BADCREDS_KEY = 'ratscout.auth.badcreds';
var SESSION_CREDKEY_KEY = 'ratscout.auth.sessionCredKey';

// Longer than two back-to-back 15 s Dexcom request timeouts (dexcom.js).
var INFLIGHT_TTL_MS = 45000;
// Pause after Dexcom rejects the credentials, until they change.
var BADCREDS_PAUSE_MS = 15 * 60 * 1000;

/**
 * djb2 hash of a string as unsigned hex. A change detector, not security.
 * @param {string} str - Input
 * @returns {string} Hex hash
 */
function djb2(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
        h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16);
}

/**
 * Key identifying the Dexcom credentials in settings.
 * @param {Object} settings - Clay settings (DEX_LOGIN, DEX_PASSWORD, DEX_REGION)
 * @returns {string} Credential key
 */
function credKey(settings) {
    settings = settings || {};
    return djb2(String(settings.DEX_LOGIN || '') + '|' +
                String(settings.DEX_REGION || '') + '|' +
                String(settings.DEX_PASSWORD || ''));
}

/**
 * Whether a dexcom.js onError message means Dexcom refused the login.
 * Only the explicit zero-GUID answers ('Invalid credentials' / 'Login failed')
 * count. HTTP errors, network errors and timeouts are transient and retry at
 * the normal cadence (at most once per ~minute), which has run against Dexcom
 * for over a year without problems.
 * @param {string} message - Error message from dexcom.js
 * @returns {boolean} True if the credentials should be paused
 */
function isAuthRejection(message) {
    var m = String(message || '');
    return m === 'Invalid credentials' || m === 'Login failed';
}

/**
 * Read and parse a JSON value from storage.
 * @param {Object} storage - localStorage-like object
 * @param {string} key - Key
 * @returns {*} Parsed value or null
 */
function readJson(storage, key) {
    try {
        var raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

/**
 * Create a guard bound to a storage and a clock.
 * @param {Object} storage - localStorage-like object (getItem/setItem/removeItem)
 * @param {string} owner - 'plugin' or 'pkjs', recorded with the lock
 * @param {Function} now - Optional clock returning epoch ms (default Date.now)
 * @returns {Object} Guard API
 */
function create(storage, owner, now) {
    now = now || function() { return Date.now(); };

    /**
     * Why an authentication must not start now.
     * @param {string} key - Current credential key
     * @returns {?string} 'badcreds', 'inflight' or null
     */
    function blockReason(key) {
        var t = now();
        var bad = readJson(storage, BADCREDS_KEY);
        if (bad && bad.credKey === key && t < bad.until) return 'badcreds';
        var lock = readJson(storage, INFLIGHT_KEY);
        if (lock && typeof lock.at === 'number' && t - lock.at < INFLIGHT_TTL_MS) return 'inflight';
        return null;
    }

    return {
        owner: owner,

        credKey: credKey,

        blockReason: blockReason,

        /**
         * Take the authentication lock unless blocked.
         * @param {string} key - Current credential key
         * @returns {?string} null if the lock was taken, else the block reason
         */
        begin: function(key) {
            var reason = blockReason(key);
            if (reason) return reason;
            storage.setItem(INFLIGHT_KEY, JSON.stringify({ owner: owner, at: now() }));
            return null;
        },

        /**
         * Release our lock and record the outcome.
         * @param {string} key - Credential key used for the attempt
         * @param {?string} error - dexcom.js error message, or null on success
         */
        end: function(key, error) {
            var lock = readJson(storage, INFLIGHT_KEY);
            if (lock && lock.owner === owner) storage.removeItem(INFLIGHT_KEY);
            if (!error) {
                storage.removeItem(BADCREDS_KEY);
                storage.setItem(SESSION_CREDKEY_KEY, key);
            } else if (isAuthRejection(error)) {
                storage.setItem(BADCREDS_KEY, JSON.stringify({ credKey: key, until: now() + BADCREDS_PAUSE_MS }));
            }
        },

        /**
         * Whether a cached Dexcom session belongs to these credentials.
         * A session with no recorded key (written by direct-mode PKJS) is trusted.
         * @param {string} key - Current credential key
         * @returns {boolean} True if usable
         */
        sessionUsable: function(key) {
            var stored = storage.getItem(SESSION_CREDKEY_KEY);
            return !stored || stored === key;
        }
    };
}

module.exports = {
    INFLIGHT_KEY: INFLIGHT_KEY,
    BADCREDS_KEY: BADCREDS_KEY,
    SESSION_CREDKEY_KEY: SESSION_CREDKEY_KEY,
    INFLIGHT_TTL_MS: INFLIGHT_TTL_MS,
    BADCREDS_PAUSE_MS: BADCREDS_PAUSE_MS,
    credKey: credKey,
    isAuthRejection: isAuthRejection,
    create: create
};
