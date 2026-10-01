import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const collections = ["properties", "units", "tenants", "payments", "invoices", "maintenance", "inspections"];

export default async (request) => {
  const user = await getUser();
  if (!user?.id) return out({ error: "Connexion requise" }, 401);

  try {
    const db = getDatabase();
    if (request.method === "GET") {
      const [row] = await db.sql`SELECT payload, rev FROM app_state WHERE owner_key = ${user.id}`;
      return out(row || { payload: null, rev: 0 });
    }
    if (request.method !== "PUT") return out({ error: "Méthode non autorisée" }, 405);
    verifyRequestOrigin(request);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2_000_000) return out({ error: "Données trop volumineuses" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return out({ error: "JSON invalide" }, 400); }
    if (!body?.payload || typeof body.payload !== "object" || Array.isArray(body.payload)
      || collections.some((key) => !Array.isArray(body.payload[key]) || body.payload[key].length > 10_000)
      || !Number.isInteger(body.baseRev) || body.baseRev < 0) {
      return out({ error: "Données invalides" }, 400);
    }
    const payload = JSON.stringify(body.payload);
    const [current] = await db.sql`SELECT rev FROM app_state WHERE owner_key = ${user.id}`;
    if (current && current.rev !== body.baseRev) return out({ error: "Conflit", rev: current.rev }, 409);
    const rows = current
      ? await db.sql`UPDATE app_state SET payload = ${payload}::jsonb, rev = rev + 1, updated_at = NOW()
                     WHERE owner_key = ${user.id} AND rev = ${body.baseRev} RETURNING rev`
      : body.baseRev === 0
        ? await db.sql`INSERT INTO app_state (owner_key, payload, rev) VALUES (${user.id}, ${payload}::jsonb, 1)
                       ON CONFLICT (owner_key) DO NOTHING RETURNING rev`
        : [];
    if (!rows[0]) return out({ error: "Conflit" }, 409);
    return out({ ok: true, rev: rows[0].rev });
  } catch (error) {
    if (error?.status === 403) return out({ error: "Origine de requête non autorisée" }, 403);
    console.error("state", error);
    return out({ error: "Erreur serveur" }, 500);
  }
};
