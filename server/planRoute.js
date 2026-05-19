/*
 * Mirage reference server (Phase 5).
 *
 * Serves the static frontend AND a POST /api/shader endpoint that:
 *   - takes { userPrompt, detectedClasses, signals, currentShader, masksAvailable }
 *   - calls Anthropic with the shader system + user prompt
 *   - parses + validates the model's JSON output with validateShaderPlan
 *   - returns { ok, shaderPlan, errors }
 *
 * Single port so the frontend can hit /api/shader without CORS gymnastics.
 *
 * Requires: ANTHROPIC_API_KEY in the environment, and `npm install` at the
 * project root (depends on @anthropic-ai/sdk).
 *
 * Note: this file is named planRoute.js for legacy reasons (Phase 4 used
 * /api/plan). Phase 5 retired that endpoint in favor of /api/shader.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handleShader, isShaderRouteReady } from "./shaderRoute.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8000;
const MODEL = process.env.LATENT_CANVAS_MODEL || "claude-sonnet-4-6";

if (!isShaderRouteReady()) {
  console.warn(
    "[server] ANTHROPIC_API_KEY not set — /api/shader will return 503. " +
      "The frontend default shader still renders OpenCV masks without the LLM.",
  );
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch (_) {
    res.writeHead(400);
    res.end("bad request");
    return;
  }
  if (urlPath === "/") urlPath = "/index.html";
  const fp = path.normalize(path.join(ROOT, urlPath));
  if (!fp.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.stat(fp, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(fp).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/shader") {
    handleShader(req, res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mirage: http://localhost:${PORT} (bound to 0.0.0.0)`);
  console.log(`Model: ${MODEL}`);
  console.log(isShaderRouteReady() ? "Shader route: live" : "Shader route: disabled (no API key)");
});
