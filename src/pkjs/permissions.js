// Logs the state of a permission the face uses, with what the user can do about it, through
// Pebble.permissions.query (preview guide, "Checking a permission"). Diagnostic only: nothing
// depends on the answer, and a query doesn't count as using the permission. ES5.
//
// Keys: built-in permissions by name ("Location"); a permission another plugin defines as
// "<plugin uuid>:<name>" (mobileapp libpebble3 permissions/PluginDefinedPermissions.kt
// pluginPermissionKey), e.g. the Rat Scout Glucose plugin's "Glucose".

var HINTS = {
    granted: 'granted',
    prompt: 'waiting for approval: allow it on Rat Scout\'s page in the Pebble app',
    denied: 'turned off for Rat Scout: allow it on Rat Scout\'s page in the Pebble app'
};

/**
 * Query a permission and log its state. Does nothing where the API is missing (phone app
 * before the permission system, or the emulator).
 * @param {Object} pebble - Pebble global
 * @param {string} key - Permission key ("Location", "<uuid>:Glucose")
 * @param {string} label - Name for the log (never the uuid)
 * @param {string} prefix - Log prefix (the source's label)
 * @returns {boolean} True if a query was made
 */
function logPermission(pebble, key, label, prefix) {
    var api = pebble && pebble.permissions;
    if (!api || typeof api.query !== 'function') return false;
    function fail(e) {
        console.log(prefix + ': permission ' + label + ' query failed: ' + (e && e.message ? e.message : e));
    }
    try {
        var answer = api.query(key);
        if (!answer || typeof answer.then !== 'function') return false;
        answer.then(function(state) {
            console.log(prefix + ': permission ' + label + ' ' + (HINTS[state] || String(state)));
        }, fail);
        return true;
    } catch (e) {
        fail(e);
        return false;
    }
}

module.exports = {
    logPermission: logPermission
};
