/**
 * Tests for src/pkjs/weather.js helper functions.
 *
 * Run: node test/weather.test.js
 */

// weather.js uses XMLHttpRequest and navigator.geolocation at module level when
// fetchWeatherData is called; the helpers we test here are pure functions.
global.XMLHttpRequest = function() { return {}; };
global.navigator = { geolocation: { getCurrentPosition: function() {} } };

var weather = require('../src/pkjs/weather');
var hasPrecipitation = weather.hasPrecipitation;
var parseWeatherData = weather.parseWeatherData;
var checkForecastPrecipitation = weather.checkForecastPrecipitation;

var passed = 0;
var failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log('  ✓ ' + message);
    } else {
        failed++;
        console.error('  ✗ ' + message);
    }
}

console.log('weather.js tests\n');

// --- hasPrecipitation ---
console.log('hasPrecipitation');
assert(hasPrecipitation(null) === false, 'null → false');
assert(hasPrecipitation([]) === false, 'empty array → false');
assert(hasPrecipitation([{ id: 800 }]) === false, 'clear sky (800) → false');
assert(hasPrecipitation([{ id: 500 }]) === true, 'rain (500) → true');
assert(hasPrecipitation([{ id: 200 }]) === true, 'thunderstorm (200) → true');
assert(hasPrecipitation([{ id: 600 }]) === true, 'snow (600) → true');
assert(hasPrecipitation([{ id: 199 }]) === false, 'boundary low (199) → false');
assert(hasPrecipitation([{ id: 700 }]) === false, 'boundary high (700) → false');
assert(hasPrecipitation([{ id: 699 }]) === true, 'just below boundary (699) → true');

// --- parseWeatherData ---
console.log('\nparseWeatherData');
var normalResponse = {
    main: { temp: 21.7 },
    wind: { speed: 5.3 },
    weather: [{ id: 800 }]
};
var result1 = parseWeatherData(normalResponse, null);
assert(result1.temp === 22, 'temp is rounded (21.7 → 22)');
assert(result1.windSpeed === 5, 'windSpeed is rounded (5.3 → 5)');
assert(result1.needsUmbrella === false, 'no umbrella for clear sky');

// Missing main/wind
var result2 = parseWeatherData({}, null);
assert(result2.temp === 0, 'missing main → temp 0');
assert(result2.windSpeed === 0, 'missing wind → windSpeed 0');

// Rain in current conditions triggers umbrella
var rainResponse = {
    main: { temp: 15 },
    wind: { speed: 3 },
    weather: [{ id: 500 }]
};
var result3 = parseWeatherData(rainResponse, null);
assert(result3.needsUmbrella === true, 'rain in current conditions → umbrella');

// No forecast list — uses current weather only
var result4 = parseWeatherData(normalResponse, null);
assert(result4.needsUmbrella === false, 'no forecast, no rain → no umbrella');

// Umbrella triggered by forecast
var now = Math.floor(Date.now() / 1000);
var forecastWithRain = [{ dt: now, pop: 0.8, weather: [{ id: 800 }] }];
var result5 = parseWeatherData(normalResponse, forecastWithRain);
assert(result5.needsUmbrella === true, 'high pop in forecast → umbrella');

// --- checkForecastPrecipitation ---
console.log('\ncheckForecastPrecipitation');
assert(checkForecastPrecipitation(null, 0.3) === false, 'null list → false');
assert(checkForecastPrecipitation([], 0.3) === false, 'empty list → false');

// High pop triggers true
var highPop = [{ dt: now, pop: 0.9 }];
assert(checkForecastPrecipitation(highPop, 0.3) === true, 'pop > threshold → true');

// Low pop does not trigger
var lowPop = [{ dt: now, pop: 0.1 }];
assert(checkForecastPrecipitation(lowPop, 0.3) === false, 'pop < threshold → false');

// Rain data triggers
var rainData = [{ dt: now, pop: 0, rain: { '3h': 0.5 } }];
assert(checkForecastPrecipitation(rainData, 0.3) === true, 'rain.3h > 0 → true');

// Snow data triggers
var snowData = [{ dt: now, pop: 0, snow: { '3h': 1.0 } }];
assert(checkForecastPrecipitation(snowData, 0.3) === true, 'snow.3h > 0 → true');

// Future timestamp beyond today is ignored
var farFuture = Math.floor(new Date(Date.now() + 48 * 3600 * 1000).getTime() / 1000);
var futureRain = [{ dt: farFuture, pop: 0.9 }];
assert(checkForecastPrecipitation(futureRain, 0.3) === false, 'future timestamp → false');

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
