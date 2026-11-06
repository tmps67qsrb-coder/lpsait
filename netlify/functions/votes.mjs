import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const VALID_IDS = new Set(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"]);

function parseCookieVoterId(cookieHeader) {
  if (!cookieHeader) return "";
  const mVoter = cookieHeader.match(/(?:^|;\s*)lp26_voter=([^;]+)/);
  if (mVoter) return decodeURIComponent(mVoter[1]).trim().slice(0, 128);
  const mDev = cookieHeader.match(/(?:^|;\s*)lp26_dev=([^;]+)/);
  if (mDev) return decodeURIComponent(mDev[1]).trim().slice(0, 128);
  return "";
}

export default async (req) => {
  const store = getStore("proforg-votes-2026");
  const url = new URL(req.url);
  let deviceId = (url.searchParams.get("device_id") || "").trim().slice(0, 128);
  let cookieId = parseCookieVoterId(req.headers.get("cookie") || "");
  let setCookieHeader = null;

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const candidateId = String(body.id || "").trim();
    deviceId = String(body.device_id || deviceId).trim().slice(0, 128);

    if (!VALID_IDS.has(candidateId)) {
      return Response.json({ error: "Invalid candidate id" }, { status: 400 });
    }

    if (!cookieId) {
      cookieId = deviceId || crypto.randomUUID();
      setCookieHeader = `lp26_voter=${encodeURIComponent(cookieId)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`;
    }
    if (!deviceId) {
      deviceId = cookieId;
    }

    const state = (await store.get("state", { type: "json" })) || {
      counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
      voters: {},
    };

    const existingVote =
      (cookieId && state.voters[`cookie:${cookieId}`]) ||
      (deviceId && state.voters[`dev:${deviceId}`]);

    if (!existingVote) {
      state.counts[candidateId] = (state.counts[candidateId] || 0) + 1;
      if (cookieId) state.voters[`cookie:${cookieId}`] = candidateId;
      if (deviceId) state.voters[`dev:${deviceId}`] = candidateId;
      await store.setJSON("state", state);
    }

    const myVote = existingVote || candidateId;
    const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
    const headers = setCookieHeader ? { "Set-Cookie": setCookieHeader } : {};
    return Response.json({ counts: state.counts, my_vote: myVote, total }, { headers });
  }

  if (!cookieId) {
    cookieId = deviceId || crypto.randomUUID();
    setCookieHeader = `lp26_voter=${encodeURIComponent(cookieId)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`;
  }

  const state = (await store.get("state", { type: "json" })) || {
    counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
    voters: {},
  };
  const myVote =
    (cookieId && state.voters[`cookie:${cookieId}`]) ||
    (deviceId && state.voters[`dev:${deviceId}`]) ||
    null;
  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
  const headers = setCookieHeader ? { "Set-Cookie": setCookieHeader } : {};
  return Response.json({ counts: state.counts, my_vote: myVote, total }, { headers });
};
