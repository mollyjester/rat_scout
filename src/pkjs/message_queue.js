// Watch message queue: one AppMessage in flight at a time (index.js sendToPebble). ES5.
//
// The host calls a send's success or failure callback (mobileapp libpebble3 startup.js
// sendAppMessage: failure at once when the watch isn't connected). Whether it always calls one
// is UNVERIFIED, so a send that hears nothing for SEND_TIMEOUT_MS counts as failed and the queue
// moves on; a callback arriving after that is ignored.

var SEND_TIMEOUT_MS = 30000;

/**
 * Create a queue.
 * @param {Object} deps - {sendAppMessage(dict, onOk, onFail), setTimeout, clearTimeout,
 *                        timeoutMs (optional)}
 * @returns {Object} {push(dict, type, onFailure), pending()}
 */
function create(deps) {
    var setT = deps.setTimeout || setTimeout;
    var clearT = deps.clearTimeout || clearTimeout;
    var timeoutMs = deps.timeoutMs || SEND_TIMEOUT_MS;
    var queue = [];
    var sending = false;

    function next() {
        if (sending || queue.length === 0) return;
        sending = true;
        var msg = queue.shift();
        var settled = false;
        var timer = null;

        function settle(ok, why) {
            if (settled) return;
            settled = true;
            if (timer !== null) clearT(timer);
            if (ok) {
                console.log(msg.type + ' sent to Pebble successfully');
            } else {
                console.error('Error sending ' + msg.type + ' to Pebble' + (why ? ' (' + why + ')' : ''));
                if (msg.onFailure) msg.onFailure();
            }
            sending = false;
            next();
        }

        timer = setT(function() {
            timer = null;
            settle(false, 'no answer in ' + (timeoutMs / 1000) + ' s');
        }, timeoutMs);
        try {
            deps.sendAppMessage(msg.dict,
                function() { settle(true); },
                function() { settle(false); });
        } catch (e) {
            settle(false, String(e && e.message ? e.message : e));
        }
    }

    return {
        /**
         * Queue a message.
         * @param {Object} dict - Dictionary
         * @param {string} type - Name for the log
         * @param {Function} onFailure - Optional: called if the send fails or times out
         */
        push: function(dict, type, onFailure) {
            queue.push({ dict: dict, type: type || 'data', onFailure: onFailure });
            next();
        },
        /** @returns {number} Messages waiting (not counting the one in flight) */
        pending: function() { return queue.length; }
    };
}

/**
 * Remembers the last dictionary sent per kind, so an unchanged one isn't sent again.
 * @returns {Object} {changed(kind, dict), forget(kind)}
 */
function createChangeFilter() {
    var last = {};
    return {
        /**
         * @param {string} kind - e.g. 'weather'
         * @param {Object} dict - Dictionary about to be sent
         * @returns {boolean} True if it differs from the last one (and records it)
         */
        changed: function(kind, dict) {
            var s = JSON.stringify(dict);
            if (last[kind] === s) return false;
            last[kind] = s;
            return true;
        },
        /** @param {string} kind - Forget the last one (its send failed), so it is sent again */
        forget: function(kind) {
            delete last[kind];
        }
    };
}

module.exports = {
    SEND_TIMEOUT_MS: SEND_TIMEOUT_MS,
    create: create,
    createChangeFilter: createChangeFilter
};
