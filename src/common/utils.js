/**
 * Build query string from params object
 * @param {Object} params - Query parameters
 * @returns {string} Encoded query string
 */
function buildQueryString(params) {
    var parts = [];
    Object.keys(params).forEach(function(key) {
        if (params[key] !== undefined && params[key] !== null) {
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
        }
    });
    return parts.length > 0 ? '?' + parts.join('&') : '';
}

module.exports = { buildQueryString: buildQueryString };
