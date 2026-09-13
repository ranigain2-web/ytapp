"use strict";

var core = require("@capacitor/core");

// CJS entry (kept for Node interop). Bundlers pick dist/esm/index.js via the
// "module" / "exports.import" fields.
var YtBackground = core.registerPlugin("YtBackground", {
  web: function () {
    return Promise.resolve(require("./web.cjs.js").YtBackgroundWeb).then(function (m) {
      return new m();
    });
  },
});

module.exports = { YtBackground: YtBackground };
