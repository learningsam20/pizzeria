/**
 * Vercel serverless entry — forwards /api/* to the Express app built as dist/server.cjs
 * Uses ESM because package.json has "type": "module".
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let invoke;

export default async function handler(req, res) {
  if (!invoke) {
    const mod = require("../dist/server.cjs");
    invoke = mod.handler;
    if (typeof invoke !== "function") {
      throw new Error("dist/server.cjs did not export handler — run npm run build first.");
    }
  }
  return invoke(req, res);
}
