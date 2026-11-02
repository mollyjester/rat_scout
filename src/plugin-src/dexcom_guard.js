// Dexcom login guard for the Rat Scout Glucose plugin (src/plugin-src/main.js). ES5.
//
// The plugin is started fresh for every request, so the guard's state lives in the
// plugin's localStorage. The lock still matters if the host ever runs two requests at
// once; whether it does is UNVERIFIED, so this is best-effort: the worst case equals
// having no guard.
//
// Dexcom's lockout and rate-limit thresholds are UNVERIFIED and are never
// tested against the real service; the limits below are deliberately
// conservative and are verified only by unit tests with a mocked fetch.

var INFLIGHT_KEY = 'ratscout.auth.inflight';
var BADCREDS_KEY = 'ratscout.auth.badcreds';
var SESSION_CREDKEY_KEY = 'ratscout.auth.sessionCredKey';

// Longer than the two back-to-back login requests (account + session),
// each of which dexcom.js times out after 15 s. In the plugin that timeout
// needs setTimeout (UNVERIFIED on the phone, see xhr_shim.js); without it the
// host's own request TIMEOUT is the bound.
var INFLIGHT_TTL_MS = 45000;
// Pause after Dexcom rejects the credentials, until they change.
var BADCREDS_PAUSE_MS = 15 * 60 * 1000;
// After Dexcom's own lockout answer. How long Dexcom locks for is UNVERIFIED,
// so stay away for an hour rather than extend it.
var LOCKOUT_PAUSE_MS = 60 * 60 * 1000;
var MAX_ATTEMPTS_ERROR = 'Max authentication attempts exceeded';

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
 * Key identifying the Dexcom credentials in settings. The password is not part of it: a new
 * password bumps DEX_CRED_VERSION (settings.js save), so nothing derived from the password is
 * stored.
 * @param {Object} settings - Settings.load() result (DEX_LOGIN, DEX_REGION, DEX_CRED_VERSION)
 * @returns {string} Credential key
 */
function credKey(settings) {
    settings = settings || {};
    return djb2(String(settings.DEX_LOGIN || '') + '|' +
                String(settings.DEX_REGION || '') + '|' +
                String(settings.DEX_CRED_VERSION || '0'));
}

// dexcom.js errors from the login steps or a failed session. Anything else (no readings, a
// readings timeout or network error) happened with a valid session.
var LOGIN_ERROR = /^(Invalid credentials|Login failed|Max authentication attempts exceeded|Session validation failed|Authentication error|(Error|Network error|Timeout) fetching (account|session) ID)/;

/**
 * Whether a failed fetch still holds a Dexcom session worth keeping.
 * Dropping it after every failure made each poll a full login while Dexcom had no
 * reading (seen on the phone, plugin path; the direct path did the same every 5 min).
 * @param {Object} dex - dexcom.js instance after the failed run
 * @param {string} error - dexcom.js onError message
 * @returns {boolean} True to keep dex.accountId/sessionId
 */
function keepsSession(dex, error) {
    return !!(dex && dex.accountId && dex.sessionId && !LOGIN_ERROR.test(String(error || '')));
}

/**
 * Whether a dexcom.js onError message means Dexcom refused the login.
 * Counts: 'Invalid credentials' (HTTP 500 AccountPasswordInvalid, or a zero
 * account GUID), 'Login failed' (zero session GUID) and Dexcom's lockout
 * answer 'Max authentication attempts exceeded' (see dexcom.js
 * loginErrorMessage). Other HTTP errors, network errors and timeouts are
 * transient and retry at the normal cadence (at most once per ~minute), which
 * has run against Dexcom for over a year without problems.
 * @param {string} message - Error message from dexcom.js
 * @returns {boolean} True if the credentials should be paused
 */
function isAuthRejection(message) {
    var m = String(message || '');
    return m === 'Invalid credentials' || m === 'Login failed' || m === MAX_ATTEMPTS_ERROR;
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
 * @param {string} owner - Recorded with the lock ('plugin'); only the owner releases it
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
        if (bad && bad.credKey === key && t < bad.until) {
            // A pause longer than the longest one means the clock went back: keep pausing, but
            // no longer than LOCKOUT_PAUSE_MS from now.
            if (bad.until - t > LOCKOUT_PAUSE_MS) {
                storage.setItem(BADCREDS_KEY, JSON.stringify({ credKey: bad.credKey, until: t + LOCKOUT_PAUSE_MS }));
            }
            return 'badcreds';
        }
        var lock = readJson(storage, INFLIGHT_KEY);
        // A lock dated in the future (clock went back) counts as expired, as main.js's throttle.
        if (lock && typeof lock.at === 'number' && t >= lock.at && t - lock.at < INFLIGHT_TTL_MS) return 'inflight';
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
                var pause = error === MAX_ATTEMPTS_ERROR ? LOCKOUT_PAUSE_MS : BADCREDS_PAUSE_MS;
                storage.setItem(BADCREDS_KEY, JSON.stringify({ credKey: key, until: now() + pause }));
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
    LOCKOUT_PAUSE_MS: LOCKOUT_PAUSE_MS,
    credKey: credKey,
    isAuthRejection: isAuthRejection,
    keepsSession: keepsSession,
    create: create
};
