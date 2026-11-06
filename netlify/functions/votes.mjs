import { getStore } from "@netlify/blobs";
import defaultUsers from "../../users.json" with { type: "json" };

const VALID_IDS = new Set(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"]);

function verifyAccount(usersList, login, password) {
  if (!login || !password || !Array.isArray(usersList)) return false;
  return usersList.some(
    (u) =>
      u &&
      String(u.login || "").trim() === login &&
      String(u.password || "").trim() === password
  );
}

export default async (req) => {
  const store = getStore("proforg-votes-2026");
  const url = new URL(req.url);

  const state = (await store.get("state", { type: "json" })) || {
    counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
    voters: {},
  };

  // Позволяет хранить/обновлять пользователей либо в users.json, либо в Netlify Blobs ("users")
  const dbUsers = (await store.get("users", { type: "json" })) || defaultUsers;

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "vote").trim();
    const login = String(body.login || "").trim().slice(0, 128);
    const password = String(body.password || "").trim().slice(0, 128);

    if (!verifyAccount(dbUsers, login, password)) {
      return Response.json(
        { ok: false, error: "Неверный логин или пароль" },
        { status: 401 }
      );
    }

    const voterKey = `user:${login}`;

    if (action === "login") {
      const myVote = state.voters[voterKey] || null;
      const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
      return Response.json({
        ok: true,
        login,
        counts: state.counts,
        my_vote: myVote,
        total,
      });
    }

    const candidateId = String(body.id || "").trim();
    if (!VALID_IDS.has(candidateId)) {
      return Response.json(
        { ok: false, error: "Invalid candidate id" },
        { status: 400 }
      );
    }

    const existingVote = state.voters[voterKey];
    if (!existingVote) {
      state.counts[candidateId] = (state.counts[candidateId] || 0) + 1;
      state.voters[voterKey] = candidateId;
      await store.setJSON("state", state);
    }

    const myVote = existingVote || candidateId;
    const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
    return Response.json({
      ok: true,
      login,
      counts: state.counts,
      my_vote: myVote,
      total,
    });
  }

  const login = (url.searchParams.get("login") || "").trim().slice(0, 128);
  const myVote = login ? state.voters[`user:${login}`] || null : null;
  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
  return Response.json({
    counts: state.counts,
    my_vote: myVote,
    total,
    login: login || null,
  });
};
