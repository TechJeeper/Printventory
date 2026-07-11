/**
 * Opt-in debug logging. Enable in extension options. Used in page, service worker, and options.
 */
(function (g) {
  'use strict';
  const PREFIX = '[Printventory Watcher]';
  var enabled = false;
  g.pvSetDebug = function (v) {
    enabled = !!v;
  };
  g.pvIsDebug = function () {
    return enabled;
  };
  g.pvLog = function () {
    if (!enabled) return;
    const a = [PREFIX, '[debug]'];
    for (let i = 0; i < arguments.length; i++) a.push(arguments[i]);
    console.log.apply(console, a);
  };
  g.pvWarn = function () {
    if (!enabled) return;
    const a = [PREFIX, '[debug]'];
    for (let i = 0; i < arguments.length; i++) a.push(arguments[i]);
    console.warn.apply(console, a);
  };
  /** Truncate long strings for console (e.g. notes, base64). */
  g.pvShort = function (s, max) {
    if (s == null) return s;
    const t = String(s);
    const m = max == null ? 200 : max;
    return t.length <= m ? t : t.slice(0, m) + '…';
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
