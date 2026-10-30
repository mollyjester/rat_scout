// XMLHttpRequest subset built on fetch, for running src/pkjs/dexcom.js
// unchanged inside the plugin. ES5 + Promise.
//
// The plugin runtime documents fetch, WebSocket, navigator.geolocation,
// localStorage, Pebble.secureStorage, readSource/subscribeSource/
// refreshSources and console, "Nothing else" (Pebble plugins preview guide,
// "The script"). XMLHttpRequest and setTimeout on the phone are UNVERIFIED,
// so the bundle always uses this shim (scripts/build-plugin.js binds it in
// bundle scope; the global is never touched). The emulator's plugin host has
// both (pypkjs/plugins/js_plugin.py installs Timers and XHRExtension), which
// is why the shim is used unconditionally: otherwise the emulator would test
// a different code path from the phone.
//
// DEVIATIONS from a real XMLHttpRequest, all for dexcom.js's benefit:
// - A network failure calls onerror; if a caller sets no onerror it calls
//   onload with status 0, so the caller still gets an error callback.
// - abort() calls onabort, else ontimeout, else onerror (dexcom.js aborts
//   only from its own timeout fallback and sets no onabort).
// - Every request finishes at most once.

/**
 * Create the shim bound to a fetch implementation and optional timers.
 * @param {Function} fetchFn - fetch(url, options) returning a Promise
 * @param {?Function} setTimeoutFn - setTimeout if the runtime has one
 * @param {?Function} clearTimeoutFn - clearTimeout if the runtime has one
 * @returns {Function} XMLHttpRequest-compatible constructor
 */
function createXHR(fetchFn, setTimeoutFn, clearTimeoutFn) {
    function FetchXHR() {
        this.readyState = 0;
        this.status = 0;
        this.statusText = '';
        this.responseText = '';
        this.timeout = 0;
        this.onload = null;
        this.onerror = null;
        this.ontimeout = null;
        this.onabort = null;
        this._headers = {};
        this._done = false;
        this._timer = null;
    }

    FetchXHR.prototype.open = function(method, url) {
        this._method = method;
        this._url = url;
        this.readyState = 1;
    };

    FetchXHR.prototype.setRequestHeader = function(name, value) {
        this._headers[name] = value;
    };

    FetchXHR.prototype.getAllResponseHeaders = function() {
        return '';
    };

    /**
     * Finish once: set readyState 4 and call the first available handler.
     * @param {Array} handlerNames - Handler property names in preference order
     */
    FetchXHR.prototype._finish = function(handlerNames) {
        if (this._done) return;
        this._done = true;
        this.readyState = 4;
        if (this._timer !== null && clearTimeoutFn) clearTimeoutFn(this._timer);
        for (var i = 0; i < handlerNames.length; i++) {
            var fn = this[handlerNames[i]];
            if (typeof fn === 'function') {
                try {
                    fn.call(this);
                } catch (e) {
                    console.error('xhr_shim: ' + handlerNames[i] + ' threw: ' + (e && e.message ? e.message : e));
                }
                return;
            }
        }
    };

    FetchXHR.prototype._fail = function() {
        this.status = 0;
        this._finish(['onerror', 'onload']);
    };

    FetchXHR.prototype.abort = function() {
        this.status = 0;
        this._finish(['onabort', 'ontimeout', 'onerror']);
    };

    FetchXHR.prototype.send = function(body) {
        var self = this;
        var options = { method: this._method || 'GET', headers: this._headers };
        if (body !== undefined && body !== null) options.body = body;

        if (this.timeout > 0 && setTimeoutFn) {
            this._timer = setTimeoutFn(function() {
                self._timer = null;
                self.status = 0;
                self._finish(['ontimeout', 'onerror']);
            }, this.timeout);
        }

        var promise;
        try {
            promise = fetchFn(this._url, options);
        } catch (e) {
            // Whether fetch accepts a User-Agent header is UNVERIFIED: retry without it.
            var headers = {};
            for (var k in this._headers) {
                if (k.toLowerCase() !== 'user-agent') headers[k] = this._headers[k];
            }
            options.headers = headers;
            try {
                promise = fetchFn(this._url, options);
            } catch (e2) {
                self._fail();
                return;
            }
        }

        promise.then(function(res) {
            return res.text().then(function(text) {
                return { res: res, text: text };
            });
        }).then(function(r) {
            self.status = r.res.status;
            self.statusText = r.res.statusText || '';
            self.responseText = r.text;
            self._finish(['onload']);
        }, function() {
            self._fail();
        });
    };

    return FetchXHR;
}

module.exports = { createXHR: createXHR };
