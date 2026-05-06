/**
 * timeline.js — Rebble timeline pin helpers for Quick View alert overlays.
 *
 * Pushes a short-lived timeline pin so the OS shows a Quick View banner
 * on the watch. The pin is immediately scheduled for deletion after
 * `duration_s` seconds so it does not persist in the user's timeline.
 *
 * API: https://timeline-api.rebble.io/v1/user/pins/<pinId>  (PUT / DELETE)
 *
 * The timeline token is obtained automatically via Pebble.getTimelineToken(),
 * which the Rebble companion app intercepts server-side. No manual token
 * entry is required.
 */

var TIMELINE_BASE_URL = 'https://timeline-api.rebble.io/v1/user/pins/';

/**
 * Push a timeline pin that triggers a Quick View overlay on the watch.
 * Obtains the user's timeline token via Pebble.getTimelineToken() and then
 * PUTs the pin to the Rebble timeline API. The pin is scheduled for deletion
 * after `duration_s` seconds so it does not persist in the user's timeline.
 *
 * @param {string} pinId      - Unique stable ID for this pin class (e.g. "rsalert-bghigh").
 *                              Re-using the same ID updates the existing pin rather than
 *                              creating a duplicate.
 * @param {string} title      - Short title shown in the Quick View banner.
 * @param {string} body       - Body text (the BG value or "Hourly alert").
 * @param {number} duration_s - Seconds after which the pin is deleted (default 300 = 5 min).
 */
function pushQuickViewPin(pinId, title, body, duration_s) {
    duration_s = duration_s || 300;

    Pebble.getTimelineToken(
        function(token) {
            _doPushPin(pinId, title, body, duration_s, token);
        },
        function(error) {
            console.error('timeline: getTimelineToken failed: ' + error);
        }
    );
}

/**
 * Perform the actual PUT request once we have a token.
 */
function _doPushPin(pinId, title, body, duration_s, token) {
    var now = new Date();
    var startIso = now.toISOString();

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
    pushQuickViewPin: pushQuickViewPin
};
