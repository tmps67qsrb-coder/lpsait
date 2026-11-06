import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const VALID_IDS = new Set(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"]);

export default async (req, context) => {
  const store = getStore("proforg-votes-2026");
  const ip =
    context.ip ||
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "";
  const ua = (req.headers.get("user-agent") || "").slice(0, 256);
  const url = new URL(req.url);
  let deviceId = (url.searchParams.get("device_id") || "").trim().slice(0, 128);
  let fp = (url.searchParams.get("fp") || "").trim().slice(0, 256);

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const candidateId = String(body.id || "").trim();
    deviceId = String(body.device_id || deviceId).trim().slice(0, 128);
    fp = String(body.fp || fp).trim().slice(0, 256);

    if (!VALID_IDS.has(candidateId)) {
      return Response.json({ error: "Invalid candidate id" }, { status: 400 });
    }

    const fpHash = crypto
      .createHash("sha256")
      .update(`${fp}|${ip}|${ua}`)
      .digest("hex");

    const state = (await store.get("state", { type: "json" })) || {
      counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
      voters: {},
    };

    const existingVote =
      (ip && state.voters[`ip:${ip}`]) ||
      (deviceId && state.voters[`dev:${deviceId}`]) ||
      (fp && state.voters[`fp:${fpHash}`]);

    if (!existingVote) {
      state.counts[candidateId] = (state.counts[candidateId] || 0) + 1;
      if (ip) state.voters[`ip:${ip}`] = candidateId;
      if (deviceId) state.voters[`dev:${deviceId}`] = candidateId;
      if (fp) state.voters[`fp:${fpHash}`] = candidateId;
      await store.setJSON("state", state);
    }

    const myVote = existingVote || candidateId;
    const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
    return Response.json({ counts: state.counts, my_vote: myVote, total });
  }

  const fpHash = fp
    ? crypto.createHash("sha256").update(`${fp}|${ip}|${ua}`).digest("hex")
    : "";
  const state = (await store.get("state", { type: "json" })) || {
    counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
    voters: {},
  };
  const myVote =
    (ip && state.voters[`ip:${ip}`]) ||
    (deviceId && state.voters[`dev:${deviceId}`]) ||
    (fpHash && state.voters[`fp:${fpHash}`]) ||
    null;
  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
  return Response.json({ counts: state.counts, my_vote: myVote, total });
};
