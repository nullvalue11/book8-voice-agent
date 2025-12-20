// src/state/callState.js
const calls = new Map();

// OPTIONAL: expire old calls to avoid memory growth
const TTL_MS = 1000 * 60 * 30; // 30 minutes

export function getCallState(callSid) {
  if (!callSid) return null;
  const v = calls.get(callSid);
  if (!v) return null;
  if (Date.now() - v.updatedAt > TTL_MS) {
    calls.delete(callSid);
    return null;
  }
  return v.state;
}

export function upsertCallState(callSid, patch) {
  if (!callSid) return;
  const existing = calls.get(callSid)?.state || {};
  const next = { ...existing, ...patch };
  calls.set(callSid, { state: next, updatedAt: Date.now() });
  return next;
}

export function clearCallState(callSid) {
  if (!callSid) return;
  calls.delete(callSid);
}

