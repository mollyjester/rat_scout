// OpenWeatherMap API 2.5 integration
// API Documentation: https://openweathermap.org/current
//                     https://openweathermap.org/forecast5

var utils = require('../common/utils');
var OWM_WEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';
var OWM_FORECAST_URL = 'https://api.openweathermap.org/data/2.5/forecast';
var REQUEST_TIMEOUT_MS = 15000;
var GEOLOCATION_MAX_AGE_MS = 300000;

/**
 * Check if weather conditions indicate precipitation
 * Weather condition codes: 2xx=Thunderstorm, 3xx=Drizzle, 5xx=Rain, 6xx=Snow
 * @param {Array} weatherArray - Array of weather condition objects
 * @returns {boolean} True if precipitation detected
 */
function hasPrecipitation(weatherArray) {
    if (!weatherArray || weatherArray.length === 0) return false;
    var id = weatherArray[0].id;
    return id >= 200 && id < 700;
}

/**
 * Check forecast list for precipitation today
 * @param {Array} forecastList - Forecast list (3-hour blocks)
 * @param {number} threshold - Probability threshold (0-1)
 * @returns {boolean} True if precipitation likely
 */
function checkForecastPrecipitation(forecastList, threshold) {
    if (!forecastList || forecastList.length === 0) return false;

    var endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    var endTimestamp = Math.floor(endOfDay.getTime() / 1000);

    for (var i = 0; i < forecastList.length; i++) {
        var item = forecastList[i];
        if (item.dt > endTimestamp) break;
        if ((item.pop || 0) > threshold) return true;
        if (item.rain && item.rain['3h'] > 0) return true;
        if (item.snow && item.snow['3h'] > 0) return true;
        if (hasPrecipitation(item.weather)) return true;
    }
    return false;
}

/**
 * Parse current weather + forecast into weather data
 * @param {Object} currentResponse - Current weather API response
 * @param {Array|null} forecastList - Optional forecast list for umbrella check
 * @returns {Object} Parsed weather data { temp, windSpeed, needsUmbrella }
 */
function parseWeatherData(currentResponse, forecastList) {
    var main = currentResponse.main || {};
    var wind = currentResponse.wind || {};
    var PRECIP_THRESHOLD = 0.3;

    var umbrella = hasPrecipitation(currentResponse.weather);
    if (!umbrella && forecastList) {
        umbrella = checkForecastPrecipitation(forecastList, PRECIP_THRESHOLD);
    }

    return {
        temp: Math.round(main.temp || 0),
        windSpeed: Math.round(wind.speed || 0),
        needsUmbrella: umbrella
    };
}

/**
 * Log weather data for debugging
 * @param {Object} data - Parsed weather data
 */
function logWeatherData(data) {
    console.log('Weather data received:');
    console.log('  Temperature: ' + data.temp);
    console.log('  Wind speed: ' + data.windSpeed);
    console.log('  Umbrella needed: ' + data.needsUmbrella);
}

/**
 * Make an XHR GET request
 * @param {string} url - Request URL
 * @param {Function} onSuccess - Called with parsed JSON response
 * @param {Function} onError - Called with error string
 */
function httpGet(url, onSuccess, onError) {
    var xhr = new XMLHttpRequest();
    xhr.timeout = REQUEST_TIMEOUT_MS;

    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                var response = JSON.parse(xhr.responseText);
                if (onSuccess) onSuccess(response);
            } catch (e) {
                console.error('Error parsing response: ' + e.message);
                if (onError) onError('Parse error: ' + e.message);
            }
        } else {
            if (onError) onError('HTTP ' + xhr.status);
        }
    };

    xhr.onerror = function() {
        if (onError) onError('Network error');
    };

    xhr.ontimeout = function() {
        if (onError) onError('Request timeout');
    };

    xhr.open('GET', url);
    xhr.send();
}

/**
 * Fetch weather data from OpenWeatherMap 2.5 API.
 * Fetches current weather and 5-day forecast for umbrella prediction.
 * Uses the phone's GPS for location.
 *
 * @param {string} apiKey - OpenWeatherMap API key
 * @param {string} units - 'metric' (°C, m/s) or 'imperial' (°F, mph)
 * @param {Function} onSuccess - Callback with parsed weather data and location
 * @param {Function} onError - Callback with error message
 */
function fetchWeatherData(apiKey, units, onSuccess, onError) {
    if (!apiKey) {
        console.error('OpenWeatherMap API key is required');
        if (onError) onError('API key is required');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function(pos) {
            var latitude = pos.coords.latitude;
            var longitude = pos.coords.longitude;
            
            var params = {
                lat: latitude.toFixed(4),
                lon: longitude.toFixed(4),
                appid: apiKey,
                units: units || 'metric'
            };

            var weatherUrl = OWM_WEATHER_URL + utils.buildQueryString(params);
            var forecastUrl = OWM_FORECAST_URL + utils.buildQueryString(params);

            console.log('Fetching weather from OpenWeatherMap 2.5 API');

            httpGet(weatherUrl,
                function(currentResponse) {
                    httpGet(forecastUrl,
                        function(forecastResponse) {
                            var data = parseWeatherData(currentResponse, forecastResponse.list);
                            data.latitude = latitude;
                            data.longitude = longitude;
                            logWeatherData(data);
                            if (onSuccess) onSuccess(data);
                        },
                        function() {
                            console.log('Forecast fetch failed, using current weather only');
                            var data = parseWeatherData(currentResponse, null);
                            data.latitude = latitude;
                            data.longitude = longitude;
                            logWeatherData(data);
                            if (onSuccess) onSuccess(data);
                        }
                    );
                },
                function(error) {
                    console.error('Weather API error: ' + error);
                    if (onError) onError('API error: ' + error);
                }
            );
        },
        function(err) {
            console.error('Geolocation error: ' + err.message);
            if (onError) onError('Location error: ' + err.message);
        },
        { timeout: REQUEST_TIMEOUT_MS, maximumAge: GEOLOCATION_MAX_AGE_MS }
    );
}

module.exports = {
    fetchWeatherData: fetchWeatherData,
    hasPrecipitation: hasPrecipitation,
    parseWeatherData: parseWeatherData,
    checkForecastPrecipitation: checkForecastPrecipitation
};
