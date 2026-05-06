/**
 * timeline.js — Rebble timeline pin helpers for Quick View alert overlays.
 *
 * Pushes a short-lived timeline pin so the OS shows a Quick View banner
 * on the watch. The pin is immediately scheduled for deletion after
 * `duration_s` seconds so it does not persist in the user's timeline.
 *
 * API: https://timeline-api.rebble.io/v1/user/pins/<pinId>  (PUT / DELETE)
 *
 * The Rebble timeline token is read from Clay settings (`REBBLE_TOKEN`).
 * It is cached in localStorage under CONFIG.STORAGE_KEYS.REBBLE_TOKEN so the
 * key is only read from localStorage once per session.
 */

var TIMELINE_BASE_URL = 'https://timeline-api.rebble.io/v1/user/pins/';

// In-memory cache avoids repeated localStorage reads per alert
var _cachedToken = null;

/**
 * Return the Rebble user token, reading from localStorage on first call.
 * Returns null when no token is configured.
 * @returns {string|null}
 */
function getCachedToken() {
    if (_cachedToken !== null) return _cachedToken;
    try {
        var settings = JSON.parse(window.localStorage.getItem('clay-settings') || '{}');
        _cachedToken = settings.REBBLE_TOKEN || null;
    } catch (e) {
        console.error('timeline: error reading settings: ' + e.message);
        _cachedToken = null;
    }
    return _cachedToken;
}

/**
 * Invalidate the cached token (call when settings are saved).
 */
function invalidateCachedToken() {
    _cachedToken = null;
}

/**
 * Push a timeline pin that triggers a Quick View overlay on the watch.
 * The pin is scheduled for deletion after `duration_s` seconds by sending
 * a DELETE request after the configured duration expires.
 *
 * No-ops silently when no Rebble token is configured.
 *
 * @param {string} pinId      - Unique stable ID for this pin class (e.g. "rsalert-bghigh").
 *                              Re-using the same ID updates the existing pin rather than
 *                              creating a duplicate.
 * @param {string} title      - Short title shown in the Quick View banner.
 * @param {string} body       - Body text (the BG value or "Hourly alert").
 * @param {number} duration_s - Seconds after which the pin is deleted (default 300 = 5 min).
 */
function pushQuickViewPin(pinId, title, body, duration_s) {
    var token = getCachedToken();
    if (!token) {
        console.log('timeline: no Rebble token configured, skipping pin push');
        return;
    }

    duration_s = duration_s || 300;

    // Build the "now" time and a time slightly in the future so the system
    // shows it as a current/upcoming event rather than a past event.
    var now = new Date();
    var startIso = now.toISOString();
    // End time = start + duration so Quick View duration matches the alert
    var endDate = new Date(now.getTime() + duration_s * 1000);
    var endIso = endDate.toISOString();

    var pin = {
        id: pinId,
        time: startIso,
        layout: {
            type: 'genericPin',
            title: title,
            body: body
        },
        duration: duration_s / 60  // minutes, for display purposes
    };

    var url = TIMELINE_BASE_URL + encodeURIComponent(pinId);

    var xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-User-Token', token);
    xhr.timeout = 10000;

    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            console.log('timeline: pin pushed OK (' + pinId + ')');
            // Schedule deletion after duration_s so pin doesn't linger
            setTimeout(function() { _deletePin(pinId, token); }, duration_s * 1000);
        } else {
            console.error('timeline: PUT failed status=' + xhr.status + ' for pin ' + pinId);
        }
    };

    xhr.onerror = function() {
        console.error('timeline: network error pushing pin ' + pinId);
    };

    xhr.ontimeout = function() {
        console.error('timeline: request timed out pushing pin ' + pinId);
    };

    xhr.send(JSON.stringify(pin));
}

/**
 * Delete a previously pushed pin by ID.
 * @param {string} pinId - The pin ID to delete.
 * @param {string} token - Rebble user token.
 */
function _deletePin(pinId, token) {
    var url = TIMELINE_BASE_URL + encodeURIComponent(pinId);
    var xhr = new XMLHttpRequest();
    xhr.open('DELETE', url, true);
    xhr.setRequestHeader('X-User-Token', token);
    xhr.timeout = 10000;
    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            console.log('timeline: pin deleted OK (' + pinId + ')');
        } else {
            console.error('timeline: DELETE failed status=' + xhr.status + ' for pin ' + pinId);
        }
    };
    xhr.onerror = function() {
        console.error('timeline: network error deleting pin ' + pinId);
    };
    xhr.send();
}

module.exports = {
    getCachedToken: getCachedToken,
    invalidateCachedToken: invalidateCachedToken,
    pushQuickViewPin: pushQuickViewPin
};
