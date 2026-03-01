/**
 * Tests for clay-config.js vibration test buttons.
 * Verifies that AFTER_BUILD attaches DOM click handlers to each text item
 * and that clicking them sends the correct Pebble.sendAppMessage calls.
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

// --- Mock DOM element ---
function MockElement() {
    this._listeners = {};
    this.style = {};
}
MockElement.prototype.addEventListener = function(event, handler) {
    if (!this._listeners[event]) {
        this._listeners[event] = [];
    }
    this._listeners[event].push(handler);
};
MockElement.prototype.dispatchClick = function() {
    var handlers = this._listeners['click'] || [];
    for (var i = 0; i < handlers.length; i++) {
        handlers[i]();
    }
};

// --- Mock ClayItem with $element ---
function MockClayItem(id) {
    this._id = id;
    this._element = new MockElement();
    this.$element = [this._element];
    this.config = { defaultValue: 'Test' };
}

// --- Mock ClayConfig ---
function MockClayConfig() {
    this._listeners = {};
    this._itemsById = {};
    this.EVENTS = { AFTER_BUILD: 'AFTER_BUILD' };
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

// --- Mock Pebble ---
var sendAppMessageCalls = [];
global.Pebble = {
    sendAppMessage: function(data, success, failure) {
        sendAppMessageCalls.push(data);
        if (success) { success(); }
    }
};

// --- Load the module under test ---
var customFn = require('./clay-config');

// ---- Tests ----
console.log('clay-config.js vibration test button tests\n');

// Test 1: DOM click handlers attached after AFTER_BUILD
(function() {
    console.log('Test: DOM click handlers attached after AFTER_BUILD');
    var config = new MockClayConfig();
    var highItem = config.registerItem('vibe-test-high');
    var lowItem = config.registerItem('vibe-test-low');
    var hourlyItem = config.registerItem('vibe-test-hourly');

    // Call customFn with `this` = config
    customFn.call(config, {});

    // Fire AFTER_BUILD
    config.trigger('AFTER_BUILD');

    assert(
        highItem._element._listeners.click && highItem._element._listeners.click.length === 1,
        'vibe-test-high has a DOM click listener'
    );
    assert(
        lowItem._element._listeners.click && lowItem._element._listeners.click.length === 1,
        'vibe-test-low has a DOM click listener'
    );
    assert(
        hourlyItem._element._listeners.click && hourlyItem._element._listeners.click.length === 1,
        'vibe-test-hourly has a DOM click listener'
    );
})();

// Test 2: Clicking vibe-test-high sends MSG_TYPE=4, VIBE_TEST=1
(function() {
    console.log('Test: Click vibe-test-high sends correct message');
    var config = new MockClayConfig();
    config.registerItem('vibe-test-high');
    config.registerItem('vibe-test-low');
    config.registerItem('vibe-test-hourly');

    customFn.call(config, {});
    config.trigger('AFTER_BUILD');

    sendAppMessageCalls = [];
    config.getItemById('vibe-test-high')._element.dispatchClick();

    assert(sendAppMessageCalls.length === 1, 'sendAppMessage called once');
    assert(sendAppMessageCalls[0].MSG_TYPE === 4, 'MSG_TYPE is 4');
    assert(sendAppMessageCalls[0].VIBE_TEST === 1, 'VIBE_TEST is 1');
})();

// Test 3: Clicking vibe-test-low sends MSG_TYPE=4, VIBE_TEST=2
(function() {
    console.log('Test: Click vibe-test-low sends correct message');
    var config = new MockClayConfig();
    config.registerItem('vibe-test-high');
    config.registerItem('vibe-test-low');
    config.registerItem('vibe-test-hourly');

    customFn.call(config, {});
    config.trigger('AFTER_BUILD');

    sendAppMessageCalls = [];
    config.getItemById('vibe-test-low')._element.dispatchClick();

    assert(sendAppMessageCalls.length === 1, 'sendAppMessage called once');
    assert(sendAppMessageCalls[0].MSG_TYPE === 4, 'MSG_TYPE is 4');
    assert(sendAppMessageCalls[0].VIBE_TEST === 2, 'VIBE_TEST is 2');
})();

// Test 4: Clicking vibe-test-hourly sends MSG_TYPE=4, VIBE_TEST=3
(function() {
    console.log('Test: Click vibe-test-hourly sends correct message');
    var config = new MockClayConfig();
    config.registerItem('vibe-test-high');
    config.registerItem('vibe-test-low');
    config.registerItem('vibe-test-hourly');

    customFn.call(config, {});
    config.trigger('AFTER_BUILD');

    sendAppMessageCalls = [];
    config.getItemById('vibe-test-hourly')._element.dispatchClick();

    assert(sendAppMessageCalls.length === 1, 'sendAppMessage called once');
    assert(sendAppMessageCalls[0].MSG_TYPE === 4, 'MSG_TYPE is 4');
    assert(sendAppMessageCalls[0].VIBE_TEST === 3, 'VIBE_TEST is 3');
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

// Test 6: cursor style is set to pointer
(function() {
    console.log('Test: cursor style is set to pointer');
    var config = new MockClayConfig();
    var highItem = config.registerItem('vibe-test-high');
    config.registerItem('vibe-test-low');
    config.registerItem('vibe-test-hourly');

    customFn.call(config, {});
    config.trigger('AFTER_BUILD');

    assert(highItem._element.style.cursor === 'pointer', 'cursor style is pointer');
})();

// --- Results ---
console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
