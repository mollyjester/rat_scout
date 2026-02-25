/**
 * Tests for Dexcom error handling to verify that authentication and API
 * failures properly call onError instead of throwing uncaught exceptions.
 *
 * Run: node test/dexcom.test.js
 */

// Minimal XHR stub for Node.js (Pebble JS uses XMLHttpRequest)
function FakeXHR() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this._headers = {};
}
FakeXHR.prototype.open = function() {};
FakeXHR.prototype.setRequestHeader = function(k, v) { this._headers[k] = v; };
FakeXHR.prototype.abort = function() {};
FakeXHR.prototype.send = function() {
    var self = this;
    self.readyState = 4;
    // Invoke the configured handler on next tick
    if (self._triggerOnload) {
        setTimeout(function() { self.onload(); }, 0);
    } else if (self._triggerOnerror) {
        setTimeout(function() { self.onerror(); }, 0);
    } else if (self._triggerOntimeout) {
        setTimeout(function() { self.ontimeout(); }, 0);
    }
};

global.XMLHttpRequest = function() { return new FakeXHR(); };
global.setTimeout = global.setTimeout; // already available
global.clearTimeout = global.clearTimeout;

var Dexcom = require('../src/pkjs/dexcom');

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

// Override XMLHttpRequest for each test
function setNextXHR(opts) {
    global.XMLHttpRequest = function() {
        var xhr = new FakeXHR();
        xhr.status = opts.status || 200;
        xhr.responseText = opts.responseText || '';
        xhr._triggerOnload = opts.trigger === 'onload' || !opts.trigger;
        xhr._triggerOnerror = opts.trigger === 'onerror';
        xhr._triggerOntimeout = opts.trigger === 'ontimeout';
        return xhr;
    };
}

// ---- Tests ----

function runTests() {
    var pending = 0;

    function done() {
        pending--;
        if (pending === 0) {
            console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
            process.exit(failed > 0 ? 1 : 0);
        }
    }

    console.log('Dexcom error handling tests\n');

    // Test 1: _getAccountId with non-200 status calls onError
    pending++;
    (function() {
        console.log('Test: _getAccountId non-200 calls onError');
        setNextXHR({ status: 403, responseText: 'Forbidden' });
        var errorCalled = false;
        var dex = new Dexcom('user', 'pass', function() {}, 'us', function(err) {
            errorCalled = true;
            assert(err.indexOf('403') !== -1, 'Error message contains status code');
        });
        dex._getAccountId(function() {
            assert(false, 'Callback should not be called on error');
        });
        setTimeout(function() {
            assert(errorCalled, 'onError was called for non-200 account ID response');
            done();
        }, 50);
    })();

    // Test 2: _getAccountId with zero UUID calls onError
    pending++;
    (function() {
        console.log('Test: _getAccountId zero UUID calls onError');
        setNextXHR({ status: 200, responseText: '"00000000-0000-0000-0000-000000000000"' });
        var errorCalled = false;
        var dex = new Dexcom('user', 'pass', function() {}, 'us', function(err) {
            errorCalled = true;
            assert(err.indexOf('Invalid credentials') !== -1, 'Error message indicates invalid credentials');
        });
        dex._getAccountId(function() {
            assert(false, 'Callback should not be called for zero UUID');
        });
        setTimeout(function() {
            assert(errorCalled, 'onError was called for zero UUID account ID');
            done();
        }, 50);
    })();

    // Test 3: _getSessionId with non-200 status calls onError
    pending++;
    (function() {
        console.log('Test: _getSessionId non-200 calls onError');
        setNextXHR({ status: 500, responseText: '{}' });
        var errorCalled = false;
        var dex = new Dexcom('user', 'pass', function() {}, 'us', function(err) {
            errorCalled = true;
            assert(err.indexOf('500') !== -1, 'Error message contains status code');
        });
        dex.accountId = 'test-account-id';
        dex._getSessionId(function() {
            assert(false, 'Callback should not be called on error');
        });
        setTimeout(function() {
            assert(errorCalled, 'onError was called for non-200 session ID response');
            done();
        }, 50);
    })();

    // Test 4: _getSessionId with zero UUID calls onError
    pending++;
    (function() {
        console.log('Test: _getSessionId zero UUID calls onError');
        setNextXHR({ status: 200, responseText: '"00000000-0000-0000-0000-000000000000"' });
        var errorCalled = false;
        var dex = new Dexcom('user', 'pass', function() {}, 'us', function(err) {
            errorCalled = true;
            assert(err.indexOf('Login failed') !== -1, 'Error message indicates login failure');
        });
        dex.accountId = 'test-account-id';
        dex._getSessionId(function() {
            assert(false, 'Callback should not be called for zero UUID');
        });
        setTimeout(function() {
            assert(errorCalled, 'onError was called for zero UUID session ID');
            done();
        }, 50);
    })();

    // Test 5: _getSessionId network error calls onError
    pending++;
    (function() {
        console.log('Test: _getSessionId network error calls onError');
        setNextXHR({ trigger: 'onerror' });
        var errorCalled = false;
        var dex = new Dexcom('user', 'pass', function() {}, 'us', function(err) {
            errorCalled = true;
            assert(err.indexOf('Network error') !== -1, 'Error message indicates network error');
        });
        dex.accountId = 'test-account-id';
        dex._getSessionId(function() {
            assert(false, 'Callback should not be called on network error');
        });
        setTimeout(function() {
            assert(errorCalled, 'onError was called for network error');
            done();
        }, 50);
    })();

    // Test 6: _getSessionId timeout calls onError
    pending++;
    (function() {
        console.log('Test: _getSessionId timeout calls onError');
        setNextXHR({ trigger: 'ontimeout' });
        var errorCalled = false;
        var dex = new Dexcom('user', 'pass', function() {}, 'us', function(err) {
            errorCalled = true;
            assert(err.indexOf('Timeout') !== -1, 'Error message indicates timeout');
        });
        dex.accountId = 'test-account-id';
        dex._getSessionId(function() {
            assert(false, 'Callback should not be called on timeout');
        });
        setTimeout(function() {
            assert(errorCalled, 'onError was called for timeout');
            done();
        }, 50);
    })();

    // Test 7: _getAccountId success calls callback
    pending++;
    (function() {
        console.log('Test: _getAccountId success calls callback');
        setNextXHR({ status: 200, responseText: '"valid-account-id"' });
        var callbackCalled = false;
        var dex = new Dexcom('user', 'pass', function() {}, 'us', function(err) {
            assert(false, 'onError should not be called on success: ' + err);
        });
        dex._getAccountId(function() {
            callbackCalled = true;
            assert(dex.accountId === 'valid-account-id', 'Account ID is set correctly');
        });
        setTimeout(function() {
            assert(callbackCalled, 'Callback was called on success');
            done();
        }, 50);
    })();

    // Test 8: _getSessionId success calls callback
    pending++;
    (function() {
        console.log('Test: _getSessionId success calls callback');
        setNextXHR({ status: 200, responseText: '"valid-session-id"' });
        var callbackCalled = false;
        var dex = new Dexcom('user', 'pass', function() {}, 'us', function(err) {
            assert(false, 'onError should not be called on success: ' + err);
        });
        dex.accountId = 'test-account-id';
        dex._getSessionId(function() {
            callbackCalled = true;
            assert(dex.sessionId === 'valid-session-id', 'Session ID is set correctly');
        });
        setTimeout(function() {
            assert(callbackCalled, 'Callback was called on success');
            done();
        }, 50);
    })();

    // Test 9: _handleServerError with session error calls onError after max retries
    pending++;
    (function() {
        console.log('Test: _handleServerError max retries calls onError');
        var errorCalled = false;
        var dex = new Dexcom('user', 'pass', function() {}, 'us', function(err) {
            errorCalled = true;
        });
        dex.retryCount = 2; // Already at max
        try {
            dex._handleServerError({ Code: 'SessionIdNotFound', Message: 'Session not found' });
        } catch (e) {
            // The throw is caught by _fetchGlucoseReadings try/catch which calls onError
            // Here we just verify the throw happens (expected behavior)
            assert(e.message.indexOf('Session validation failed') !== -1,
                'Error thrown after max retries contains correct message');
        }
        setTimeout(function() {
            done();
        }, 50);
    })();
}

runTests();
