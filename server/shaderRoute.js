/*
 * /api/shader handler (Phase 5).
 *
 * Accepts { userPrompt, detectedClasses, signals, currentShader, masksAvailable }
 * Calls Anthropic with the shader system + user prompt, validates the JSON
 * output with validateShaderPlan, returns { ok, shaderPlan, errors }.
 *
 * Never executes generated code on the server. The browser's GLSL compiler is
 * the only thing that ever runs the shader text.
 */

import Anthropic from "@anthropic-ai/sdk";

import { validateShaderPlan } from "../llm/validateShaderPlan.js";
import { SYSTEM_PROMPT, buildUserMessage } from "../llm/shaderPrompt.js";

const MODEL = process.env.LATENT_CANVAS_MODEL || "claude-sonnet-4-6";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

export function isShaderRouteReady() {
  return !!client;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > 64 * 1024) {
        req.destroy();
        reject(new Error("body_too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export async function handleShader(req, res) {
  if (!client) {
    sendJson(res, 503, {
      ok: false,
      shaderPlan: null,
      errors: ["anthropic_api_key_not_configured"],
    });
    return;
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw);
  } catch (e) {
    sendJson(res, 400, { ok: false, shaderPlan: null, errors: ["invalid_request_body"] });
    return;
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(payload) }],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const v = validateShaderPlan(text);
    if (!v.ok) {
      sendJson(res, 422, { ok: false, shaderPlan: null, errors: v.errors });
      return;
    }
    sendJson(res, 200, { ok: true, shaderPlan: v.shaderPlan, errors: v.errors });
  } catch (err) {
    console.error("[shader] anthropic error:", err);
    sendJson(res, 500, {
      ok: false,
      shaderPlan: null,
      errors: [String(err.message || err)],
    });
  }
}
