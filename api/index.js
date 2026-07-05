/**
 * Vercel serverless entry — forwards /api/* to the Express app built as dist/server.cjs
 */
let invoke;

module.exports = async (req, res) => {
  if (!invoke) {
    const mod = require("../dist/server.cjs");
    invoke = mod.handler;
    if (typeof invoke !== "function") {
      throw new Error("dist/server.cjs did not export handler — run npm run build first.");
    }
  }
  return invoke(req, res);
};
