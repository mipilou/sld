import { createHash, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@netlify/database";

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: HEADERS });
const MAX_BYTES = 2_000_000;
const sha = (s) => createHash("sha256").update(s).digest();

// ACCESS_CODES = "code1,code2" (variable d'environnement Netlify). Chaque code ouvre un espace de données distinct.
function authenticate(code) {
  const list = (process.env.ACCESS_CODES || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return { error: 503 };
  const hash = sha(code || "");
  return list.some((c) => timingSafeEqual(sha(c), hash)) ? { key: hash.toString("hex") } : { error: 401 };
}

export default async (request) => {
  const auth = authenticate(request.headers.get("x-access-code"));
  if (auth.error === 503) return out({ error: "Serveur non configuré : définissez ACCESS_CODES" }, 503);
  if (auth.error) { await new Promise((r) => setTimeout(r, 600)); return out({ error: "Code d'accès invalide" }, 401); }

  try {
    const db = getDatabase();
    if (request.method === "GET") {
      const [row] = await db.sql`SELECT payload, rev FROM app_state WHERE owner_key = ${auth.key}`;
      return out(row || { payload: null, rev: 0 });
    }
    if (request.method === "PUT") {
      const raw = await request.text();
      if (raw.length > MAX_BYTES) return out({ error: "Données trop volumineuses" }, 413);
      const body = JSON.parse(raw);
      if (!body || typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload)) {
        return out({ error: "Payload invalide" }, 400);
      }
      const payload = JSON.stringify(body.payload);
      const [cur] = await db.sql`SELECT rev FROM app_state WHERE owner_key = ${auth.key}`;
      if (cur && body.baseRev !== undefined && body.baseRev !== cur.rev) return out({ error: "Conflit", rev: cur.rev }, 409);
      const rows = cur
        ? await db.sql`UPDATE app_state SET payload = ${payload}::jsonb, rev = rev + 1, updated_at = NOW()
                       WHERE owner_key = ${auth.key} AND rev = ${cur.rev} RETURNING rev`
        : await db.sql`INSERT INTO app_state (owner_key, payload, rev) VALUES (${auth.key}, ${payload}::jsonb, 1)
                       ON CONFLICT (owner_key) DO NOTHING RETURNING rev`;
      if (!rows[0]) return out({ error: "Conflit" }, 409);
      return out({ ok: true, rev: rows[0].rev });
    }
    return out({ error: "Méthode non autorisée" }, 405);
  } catch {
    return out({ error: "Erreur serveur" }, 500);
  }
};
