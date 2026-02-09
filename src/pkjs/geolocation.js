// ipgeolocation.io API integration for sunrise/sunset and moonrise/moonset times
// API Documentation: https://ipgeolocation.io/astronomy-api.html

var IPGEOLOCATION_API_URL = 'https://api.ipgeolocation.io/v2/astronomy';

/**
 * Fetch astronomy data (sunrise/sunset, moonrise/moonset) from ipgeolocation.io
 * @param {string} apiKey - Required API key from ipgeolocation.io
 * @param {number} lat - Latitude (optional, will use IP geolocation if not provided)
 * @param {number} lon - Longitude (optional, will use IP geolocation if not provided)
 * @param {function} onSuccess - Callback with astronomy data
 * @param {function} onError - Callback with error message
 */
function fetchAstronomyData(apiKey, lat, lon, onSuccess, onError) {
    // API key is mandatory
    if (!apiKey) {
        console.error('API key is required for astronomy data. Please set ASTRO_API_KEY in settings.');
        if (onError) {
            onError('API key is required');
        }
        return;
    }
    
    var url = IPGEOLOCATION_API_URL;
    
    // Build query parameters
    var params = [];
    
    // API key is required
    params.push('apiKey=' + encodeURIComponent(apiKey));
    
    if (lat !== undefined && lon !== undefined) {
        params.push('lat=' + lat);
        params.push('lng=' + lon);
    }
    
    if (params.length > 0) {
        url += '?' + params.join('&');
    }
    
    console.log('Fetching astronomy data from: ' + url);
    
    var xhr = new XMLHttpRequest();
    
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                var response = JSON.parse(xhr.responseText);
                
                // Extract the astronomy data from the nested astronomy object
                var astronomyData = response.astronomy || {};
                
                var data = {
                    sunrise: astronomyData.sunrise,        // HH:MM format
                    sunset: astronomyData.sunset,          // HH:MM format
                    moonrise: astronomyData.moonrise,      // HH:MM format or N/A
                    moonset: astronomyData.moonset,        // HH:MM format or N/A
                    moonPhase: astronomyData.moon_phase,   // String description (e.g., "LAST_QUARTER")
                    moonIllumination: astronomyData.moon_illumination_percentage  // Percentage string
                };
                
                console.log('Astronomy data received:');
                console.log('  Sunrise: ' + data.sunrise);
                console.log('  Sunset: ' + data.sunset);
                console.log('  Moonrise: ' + data.moonrise);
                console.log('  Moonset: ' + data.moonset);
                console.log('  Moon Phase: ' + data.moonPhase);
                console.log('  Moon Illumination: ' + data.moonIllumination);
                
                if (onSuccess) {
                    onSuccess(data);
                }
            } catch (e) {
                console.error('Error parsing astronomy response: ' + e.message);
                if (onError) {
                    onError('Failed to parse response: ' + e.message);
                }
            }
        } else {
            console.error('Astronomy API error: ' + xhr.status);
            if (onError) {
                onError('API error: ' + xhr.status);
            }
        }
    };
    
    xhr.onerror = function() {
        console.error('Network error fetching astronomy data');
        if (onError) {
            onError('Network error');
        }
    };
    
    xhr.open('GET', url);
    xhr.send();
}

module.exports.fetchAstronomyData = fetchAstronomyData;
