/**
 * Tests for clay-config.js vibration test buttons.
 * Verifies that AFTER_BUILD attaches click handlers to each button
 * and that clicking them calls serialize() and sets location.href
 * with the correct _vibeTest value in the payload.
 *
 * Run: node src/pkjs/test-clay-config.js
 */

var passed = 0;
var failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log('  PASS: ' + message);
    } else {
        failed++;
        console.error('  FAIL: ' + message);
    }
}

// --- Mock ClayItem ---
function MockClayItem(id) {
    this._id = id;
    this._listeners = {};
}
MockClayItem.prototype.on = function(event, handler) {
    if (!this._listeners[event]) {
        this._listeners[event] = [];
    }
    this._listeners[event].push(handler);
};
MockClayItem.prototype.trigger = function(event) {
    var handlers = this._listeners[event] || [];
    for (var i = 0; i < handlers.length; i++) {
        handlers[i]();
    }
};

// --- Mock ClayConfig ---
function MockClayConfig() {
    this._listeners = {};
    this._itemsById = {};
    this.EVENTS = { AFTER_BUILD: 'AFTER_BUILD' };
    this._serialized = { foo: 'bar' };
}
MockClayConfig.prototype.on = function(event, handler) {
    if (!this._listeners[event]) {
        this._listeners[event] = [];
    }
    this._listeners[event].push(handler);
};
MockClayConfig.prototype.trigger = function(event) {
    var handlers = this._listeners[event] || [];
    for (var i = 0; i < handlers.length; i++) {
        handlers[i].call(this);
    }
};
MockClayConfig.prototype.getItemById = function(id) {
    return this._itemsById[id] || null;
};
MockClayConfig.prototype.registerItem = function(id) {
    var item = new MockClayItem(id);
    this._itemsById[id] = item;
    return item;
};
MockClayConfig.prototype.serialize = function() {
    // Return a copy so mutations don't affect the stored object
    return JSON.parse(JSON.stringify(this._serialized));
};

// --- Mock window / location ---
global.window = { returnTo: 'pebblejs://close#' };
var lastHref = null;
global.location = {
    get href() { return lastHref; },
    set href(val) { lastHref = val; }
};

// --- Load the module under test ---
var customFn = require('./clay-config');

// ---- Tests ----
console.log('clay-config.js vibration test button tests\n');

// Test 1: Click handlers attached after AFTER_BUILD
(function() {
    console.log('Test: Click handlers attached after AFTER_BUILD');
    var config = new MockClayConfig();
    var highItem = config.registerItem('vibe-test-high');
    var lowItem = config.registerItem('vibe-test-low');
    var hourlyItem = config.registerItem('vibe-test-hourly');

    // Call customFn with `this` = config
    customFn.call(config, {});

    // Fire AFTER_BUILD
    config.trigger('AFTER_BUILD');

    assert(
        highItem._listeners.click && highItem._listeners.click.length === 1,
        'vibe-test-high has a click listener'
    );
    assert(
        lowItem._listeners.click && lowItem._listeners.click.length === 1,
        'vibe-test-low has a click listener'
    );
    assert(
        hourlyItem._listeners.click && hourlyItem._listeners.click.length === 1,
        'vibe-test-hourly has a click listener'
    );
})();

// Test 2: Clicking vibe-test-high sets location.href with _vibeTest=1
(function() {
    console.log('Test: Click vibe-test-high sets location.href with _vibeTest=1');
    var config = new MockClayConfig();
    config.registerItem('vibe-test-high');
    config.registerItem('vibe-test-low');
    config.registerItem('vibe-test-hourly');

    customFn.call(config, {});
    config.trigger('AFTER_BUILD');

    lastHref = null;
    config.getItemById('vibe-test-high').trigger('click');

    assert(lastHref !== null, 'location.href was set');
    var payload = JSON.parse(decodeURIComponent(lastHref.replace('pebblejs://close#', '')));
    assert(payload._vibeTest === 1, '_vibeTest is 1');
    assert(payload.foo === 'bar', 'serialized settings are included');
})();

// Test 3: Clicking vibe-test-low sets location.href with _vibeTest=2
(function() {
    console.log('Test: Click vibe-test-low sets location.href with _vibeTest=2');
    var config = new MockClayConfig();
    config.registerItem('vibe-test-high');
    config.registerItem('vibe-test-low');
    config.registerItem('vibe-test-hourly');

    customFn.call(config, {});
    config.trigger('AFTER_BUILD');

    lastHref = null;
    config.getItemById('vibe-test-low').trigger('click');

    assert(lastHref !== null, 'location.href was set');
    var payload = JSON.parse(decodeURIComponent(lastHref.replace('pebblejs://close#', '')));
    assert(payload._vibeTest === 2, '_vibeTest is 2');
    assert(payload.foo === 'bar', 'serialized settings are included');
})();

// Test 4: Clicking vibe-test-hourly sets location.href with _vibeTest=3
(function() {
    console.log('Test: Click vibe-test-hourly sets location.href with _vibeTest=3');
    var config = new MockClayConfig();
    config.registerItem('vibe-test-high');
    config.registerItem('vibe-test-low');
    config.registerItem('vibe-test-hourly');

    customFn.call(config, {});
    config.trigger('AFTER_BUILD');

    lastHref = null;
    config.getItemById('vibe-test-hourly').trigger('click');

    assert(lastHref !== null, 'location.href was set');
    var payload = JSON.parse(decodeURIComponent(lastHref.replace('pebblejs://close#', '')));
    assert(payload._vibeTest === 3, '_vibeTest is 3');
    assert(payload.foo === 'bar', 'serialized settings are included');
})();

// Test 5: Missing item does not throw
(function() {
    console.log('Test: Missing item does not throw');
    var config = new MockClayConfig();
    // Do NOT register any items — getItemById will return null

    var threw = false;
    try {
        customFn.call(config, {});
        config.trigger('AFTER_BUILD');
    } catch (e) {
        threw = true;
    }
    assert(!threw, 'No error thrown when items are missing');
})();

// --- Results ---
console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
