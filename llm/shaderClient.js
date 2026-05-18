/*
 * Browser-side shader client (Phase 5).
 *
 * POSTs to /api/shader and validates the returned shader plan locally. The
 * compiler must never see a non-sanitized plan, even if the server already
 * sanitized it.
 */

import { validateShaderPlan } from "./validateShaderPlan.js";

const ENDPOINT = "/api/shader";
const TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function requestShaderPlan(payload) {
  const res = await fetchWithTimeout(
    ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    TIMEOUT_MS,
  );
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch (_) { /* ignore */ }
    const reason =
      body && Array.isArray(body.errors) && body.errors.length > 0
        ? body.errors.join(",")
        : `http_${res.status}`;
    throw new Error(reason);
  }
  const json = await res.json();
  if (!json || json.ok === false || !json.shaderPlan) {
    throw new Error(
      json && Array.isArray(json.errors) && json.errors.length > 0
        ? json.errors.join(",")
        : "invalid_response",
    );
  }
  const v = validateShaderPlan(json.shaderPlan);
  if (!v.ok) throw new Error(v.errors.join(","));
  return { shaderPlan: v.shaderPlan, warnings: v.errors };
}
