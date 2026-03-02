const runtimeContext = require("../runtime-context.js");

if (!runtimeContext.collectors || typeof runtimeContext.collectors !== "object") {
  runtimeContext.collectors = {};
}

module.exports = runtimeContext;
