// Removes Dexcom data left by Rat Scout versions that fetched Dexcom in the watchface's PKJS.
// The Rat Scout Glucose plugin owns the Dexcom account now. Clay keeps every stored key, so
// DEX_PASSWORD would otherwise stay in the watchface's clay-settings. ES5.

var LEGACY_KEYS = ['accountId', 'sessionId', 'ratscout.plugin.lastReading', 'ratscout.plugin.lastAttempt',
    'ratscout.auth.inflight', 'ratscout.auth.badcreds', 'ratscout.auth.sessionCredKey'];
var LEGACY_SETTINGS = ['DEX_LOGIN', 'DEX_PASSWORD', 'DEX_REGION'];

/**
 * Delete legacy Dexcom keys and the Dexcom fields of clay-settings.
 * @param {Object} storage - localStorage
 * @returns {boolean} True if clay-settings held Dexcom credentials (now removed)
 */
function purgeLegacyDexcomData(storage) {
    LEGACY_KEYS.forEach(function(key) { storage.removeItem(key); });
    var stored;
    try {
        stored = JSON.parse(storage.getItem('clay-settings'));
    } catch (e) {
        console.error('Could not read Clay settings: ' + e.message);
        return false;
    }
    if (!stored || typeof stored !== 'object') return false;
    var changed = false;
    LEGACY_SETTINGS.forEach(function(key) {
        if (Object.prototype.hasOwnProperty.call(stored, key)) {
            delete stored[key];
            changed = true;
        }
    });
    if (changed) {
        storage.setItem('clay-settings', JSON.stringify(stored));
        console.log('Removed Dexcom credentials left in Clay settings');
    }
    return changed;
}

module.exports = {
    LEGACY_KEYS: LEGACY_KEYS,
    LEGACY_SETTINGS: LEGACY_SETTINGS,
    purgeLegacyDexcomData: purgeLegacyDexcomData
};
