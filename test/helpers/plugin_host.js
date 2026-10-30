/**
 * Loads the generated plugin bundle (src/plugin/index.js) into a vm context
 * shaped like the plugin runtime: fetch, localStorage, console, Pebble, and
 * deliberately no setTimeout and no XMLHttpRequest.
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var BUNDLE = path.join(__dirname, '..', '..', 'src', 'plugin', 'index.js');

/**
 * Fake Dexcom Share server for fetch.
 * @param {Object} opts - {accountId, sessionId, accountResponse, sessionResponse ({status, body}),
 *   readings, readingsStatus, readingsBody, readingsQueue, fail}
 * @returns {Function} fetch implementation; .calls lists endpoint names
 */
function fakeDexcom(opts) {
    opts = opts || {};
    var calls = [];
    function res(status, body) {
        return Promise.resolve({ status: status, statusText: '', text: function() { return Promise.resolve(body); } });
    }
    var fetch = function(url, options) {
        var ep = url.indexOf('AuthenticatePublisherAccount') !== -1 ? 'account'
            : url.indexOf('LoginPublisherAccountById') !== -1 ? 'session'
            : url.indexOf('ReadPublisherLatestGlucoseValues') !== -1 ? 'readings' : 'other';
        calls.push({ ep: ep, url: url, body: options && options.body, headers: options && options.headers });
        if (opts.fail && opts.fail[ep]) return Promise.reject(new TypeError('fetch failed: ' + url));
        if (ep === 'account' && opts.accountResponse) return res(opts.accountResponse.status, opts.accountResponse.body);
        if (ep === 'session' && opts.sessionResponse) return res(opts.sessionResponse.status, opts.sessionResponse.body);
        if (ep === 'account') return res(200, '"' + (opts.accountId || 'acc-1') + '"');
        if (ep === 'session') return res(200, '"' + (opts.sessionId || 'sess-1') + '"');
        if (ep === 'readings') {
            if (opts.readingsQueue && opts.readingsQueue.length) {
                var q = opts.readingsQueue.shift();
                return res(q.status, q.body);
            }
            return res(opts.readingsStatus || 200, opts.readingsBody || JSON.stringify(opts.readings || [
                { WT: 'Date(1700000000000)', ST: '', DT: '', Value: 120, Trend: 'Flat' },
                { WT: 'Date(1699999700000)', ST: '', DT: '', Value: 115, Trend: 'Flat' }
            ]));
        }
        return res(404, '');
    };
    fetch.calls = calls;
    fetch.endpoints = function() { return calls.map(function(c) { return c.ep; }); };
    return fetch;
}

/**
 * Load the bundle.
 * @param {Object} opts - {fetch, storage (object of initial values), now (ms), source (bundle text)}
 * @returns {Object} {context, handler, store, request(req) -> Promise<{data}|{error}>, setNow(ms)}
 */
function load(opts) {
    opts = opts || {};
    var store = {};
    Object.keys(opts.storage || {}).forEach(function(k) { store[k] = String(opts.storage[k]); });
    var clock = { t: opts.now || 1700000100000 };
    var handlers = {};
    var logs = [];
    function FakeDate(v) { return arguments.length ? new Date(v) : new Date(clock.t); }
    FakeDate.now = function() { return clock.t; };
    var context = {
        console: {
            log: function() { logs.push([].slice.call(arguments).join(' ')); },
            error: function() { logs.push('ERROR ' + [].slice.call(arguments).join(' ')); },
            warn: function() { logs.push('WARN ' + [].slice.call(arguments).join(' ')); }
        },
        Date: FakeDate,
        Promise: Promise,
        JSON: JSON,
        localStorage: {
            getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
            setItem: function(k, v) { store[k] = String(v); },
            removeItem: function(k) { delete store[k]; }
        },
        fetch: opts.fetch || fakeDexcom(),
        Pebble: {
            registerSourceHandler: function(h) { handlers.source = h; }
        }
    };
    vm.createContext(context);
    vm.runInContext(opts.source || fs.readFileSync(BUNDLE, 'utf8'), context);

    function request(req) {
        return new Promise(function(resolve) {
            var respond = {
                data: function(env) { resolve({ data: JSON.parse(JSON.stringify(env)) }); },
                error: function(code, message) { resolve({ error: code, message: message }); }
            };
            var p = handlers.source(req, respond);
            if (p && typeof p.then === 'function') p.then(null, function(e) { resolve({ threw: e }); });
        });
    }

    return {
        context: context,
        handlers: handlers,
        store: store,
        logs: logs,
        request: request,
        setNow: function(ms) { clock.t = ms; },
        now: function() { return clock.t; }
    };
}

/**
 * Minimal sequential async test runner in the repo's assert style.
 * @param {string} title - Suite title
 * @returns {Object} {assert, test(name, fn), run()}
 */
function suite(title) {
    var passed = 0;
    var failed = 0;
    var tests = [];
    function assert(condition, message) {
        if (condition) {
            passed++;
            console.log('  ✓ ' + message);
        } else {
            failed++;
            console.error('  ✗ ' + message);
        }
    }
    return {
        assert: assert,
        test: function(name, fn) { tests.push({ name: name, fn: fn }); },
        run: function() {
            console.log(title + '\n');
            var i = 0;
            function next() {
                if (i >= tests.length) {
                    console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
                    process.exit(failed > 0 ? 1 : 0);
                    return;
                }
                var t = tests[i++];
                console.log(t.name);
                Promise.resolve().then(t.fn).then(next, function(e) {
                    assert(false, t.name + ' threw: ' + (e && e.stack ? e.stack : e));
                    next();
                });
            }
            next();
        }
    };
}

module.exports = { load: load, fakeDexcom: fakeDexcom, suite: suite, BUNDLE: BUNDLE };
