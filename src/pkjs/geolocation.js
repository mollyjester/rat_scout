// ipgeolocation.io API integration for sunrise/sunset and moonrise/moonset times
// API Documentation: https://ipgeolocation.io/astronomy-api.html

var IPGEOLOCATION_API_URL = 'https://api.ipgeolocation.io/v2/astronomy';

/**
 * Build query string for astronomy API
 * @param {Object} params - Query parameters
 * @returns {string} Query string
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

/**
 * Parse astronomy response
 * @param {Object} response - Raw response
 * @returns {Object} Formatted data
 */
function parseAstronomyResponse(response) {
    var astronomyData = response.astronomy || {};
    
    return {
        sunrise: astronomyData.sunrise,
        sunset: astronomyData.sunset,
        moonrise: astronomyData.moonrise,
        moonset: astronomyData.moonset,
        moonPhase: astronomyData.moon_phase,
        moonIllumination: astronomyData.moon_illumination_percentage
    };
}

/**
 * Log astronomy data for debugging
 * @param {Object} data - Astronomy data
 */
function logAstronomyData(data) {
    console.log('Astronomy data received:');
    console.log(`  Sunrise: ${data.sunrise}`);
    console.log(`  Sunset: ${data.sunset}`);
    console.log(`  Moonrise: ${data.moonrise}`);
    console.log(`  Moonset: ${data.moonset}`);
    console.log(`  Moon Phase: ${data.moonPhase}`);
    console.log(`  Moon Illumination: ${data.moonIllumination}`);
}

/**
 * Fetch astronomy data (sunrise/sunset, moonrise/moonset) from ipgeolocation.io
 * 
 * Usage examples:
 *   fetchAstronomyData(apiKey, onSuccess, onError)
 *   fetchAstronomyData(apiKey, lat, lon, onSuccess, onError)
 *   fetchAstronomyData(apiKey, lat, lon, date, onSuccess, onError)
 * 
 * @param {string} apiKey - Required API key from ipgeolocation.io
 * @param {number|Function} latOrCallback - Latitude or callback (for parameter flexibility)
 * @param {number|Function} lonOrCallback - Longitude or callback (for parameter flexibility)
 * @param {string|Function} dateOrCallback - Date (YYYY-MM-DD) or callback
 * @param {Function} onSuccess - Callback with astronomy data
 * @param {Function} onError - Callback with error message
 */
function fetchAstronomyData(apiKey, latOrCallback, lonOrCallback, dateOrCallback, onSuccess, onError) {
    // API key is mandatory
    if (!apiKey) {
        console.error('API key is required for astronomy data. Please set ASTRO_API_KEY in settings.');
        if (typeof onError === 'function') {
            onError('API key is required');
        }
        return;
    }
    
    // Handle parameter overloading for flexibility
    var lat, lon, date;
    
    if (typeof latOrCallback === 'function') {
        // fetchAstronomyData(apiKey, onSuccess, onError)
        onSuccess = latOrCallback;
        onError = lonOrCallback;
        lat = undefined;
        lon = undefined;
        date = undefined;
    } else if (typeof dateOrCallback === 'function') {
        // fetchAstronomyData(apiKey, lat, lon, onSuccess, onError)
        lat = latOrCallback;
        lon = lonOrCallback;
        onError = onSuccess;
        onSuccess = dateOrCallback;
        date = undefined;
    } else if (typeof onSuccess === 'undefined' && typeof onError === 'function') {
        // fetchAstronomyData(apiKey, lat, lon, date, onSuccess)
        lat = latOrCallback;
        lon = lonOrCallback;
        date = dateOrCallback;
        onSuccess = onError;
        onError = arguments[5];
    } else {
        // Normal case: all parameters provided
        lat = latOrCallback;
        lon = lonOrCallback;
        date = dateOrCallback;
    }
    
    // Build query parameters
    var queryParams = { apiKey: apiKey };
    
    if (lat !== undefined && lon !== undefined) {
        queryParams.lat = lat;
        queryParams.lng = lon;
    }
    
    if (date !== undefined) {
        queryParams.date = date;
    }
    
    var url = IPGEOLOCATION_API_URL + buildQueryString(queryParams);
    console.log('Fetching astronomy data from API');
    
    var xhr = new XMLHttpRequest();
    var timeoutHandle = null;
    
    // Set 20 second timeout for astronomy API (slightly longer due to geolocation lookups)
    xhr.timeout = 20000;
    
    xhr.onload = function() {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        
        if (xhr.status === 200) {
            try {
                var response = JSON.parse(xhr.responseText);
                var data = parseAstronomyResponse(response);
                
                logAstronomyData(data);
                
                if (onSuccess) {
                    onSuccess(data);
                }
            } catch (e) {
                console.error(`Error parsing astronomy response: ${e.message}`);
                if (onError) {
                    onError(`Failed to parse response: ${e.message}`);
                }
            }
        } else {
            console.error(`Astronomy API error: ${xhr.status}`);
            if (onError) {
                onError(`API error: ${xhr.status}`);
            }
        }
    };
    
    xhr.onerror = function() {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        console.error('Network error fetching astronomy data');
        if (onError) {
            onError('Network error');
        }
    };
    
    xhr.ontimeout = function() {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        console.error('Timeout fetching astronomy data (20s)');
        if (onError) {
            onError('Astronomy API request timeout');
        }
    };
    
    // Fallback timeout using setTimeout for better compatibility
    timeoutHandle = setTimeout(function() {
        if (xhr.readyState !== 4) {
            console.error('Request timeout: astronomy data fetch took too long');
            xhr.abort();
        }
    }, 20000);
    
    xhr.open('GET', url);
    xhr.send();
}

module.exports.fetchAstronomyData = fetchAstronomyData;
