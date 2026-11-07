"use strict";

var core = require("@capacitor/core");

// CJS entry (kept for Node interop). Bundlers pick dist/esm/index.js via the
// "module" field.
var YtPlayer = core.registerPlugin("YtPlayer", {
  web: function () {
    return Promise.resolve(require("./web.cjs.js").YtPlayerWeb).then(function (m) {
      return new m();
    });
  },
});

module.exports = { YtPlayer: YtPlayer };
