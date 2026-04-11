/* global DOMParser */
(function () {
  function liveToArray(live) {
    var a = [];
    for (var i = 0; i < live.length; i++) a.push(live[i]);
    return a;
  }

  function querySelectorAllImpl(root, selector) {
    var parts = selector.trim().split(/\s+/).filter(function (p) {
      return p.length;
    });
    if (parts.length === 1) {
      return liveToArray(root.getElementsByTagName(parts[0]));
    }
    if (parts.length === 2) {
      var ancestors = liveToArray(root.getElementsByTagName(parts[0]));
      var out = [];
      for (var i = 0; i < ancestors.length; i++) {
        var sub = ancestors[i].getElementsByTagName(parts[1]);
        for (var j = 0; j < sub.length; j++) out.push(sub[j]);
      }
      return out;
    }
    throw new Error('3MF parse worker: unsupported selector "' + selector + '"');
  }

  function querySelectorImpl(root, selector) {
    var nodes = querySelectorAllImpl(root, selector);
    return nodes.length ? nodes[0] : null;
  }

  var probe = new DOMParser().parseFromString('<x/>', 'application/xml');
  var docProto = Object.getPrototypeOf(probe);
  var elProto = Object.getPrototypeOf(probe.documentElement);

  if (typeof docProto.querySelector !== 'function') {
    docProto.querySelector = function (sel) {
      return querySelectorImpl(this, sel);
    };
    docProto.querySelectorAll = function (sel) {
      return querySelectorAllImpl(this, sel);
    };
  }
  if (typeof elProto.querySelector !== 'function') {
    elProto.querySelector = function (sel) {
      return querySelectorImpl(this, sel);
    };
    elProto.querySelectorAll = function (sel) {
      return querySelectorAllImpl(this, sel);
    };
  }
})();
