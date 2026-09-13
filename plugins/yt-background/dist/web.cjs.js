"use strict";

var YtBackgroundWeb = function () {};

YtBackgroundWeb.prototype.enable = function () {
  return Promise.resolve();
};
YtBackgroundWeb.prototype.update = function () {
  return Promise.resolve();
};
YtBackgroundWeb.prototype.disable = function () {
  return Promise.resolve();
};
YtBackgroundWeb.prototype.addListener = function () {
  return Promise.resolve({ remove: function () { return Promise.resolve(); } });
};
YtBackgroundWeb.prototype.removeAllListeners = function () {
  return Promise.resolve();
};

module.exports = { YtBackgroundWeb: YtBackgroundWeb };
