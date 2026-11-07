"use strict";

var core = require("@capacitor/core");

// CJS entry (kept for Node interop). Bundlers pick dist/esm/index.js via the
// "module" field.
var YtCompat = core.registerPlugin("YtCompat", {
  web: function () {
    return Promise.resolve(require("./web.cjs.js").YtCompatWeb).then(function (m) {
      return new m();
    });
  },
});

module.exports = { YtCompat: YtCompat };
