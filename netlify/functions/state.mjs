import { getDatabase } from "@netlify/database";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export default async (request) => {
  const db = getDatabase();
  const ownerKey = request.headers.get("x-owner-key") || "demo-owner";

  if (request.method === "GET") {
    const rows = await db.sql`SELECT payload, updated_at FROM app_state WHERE owner_key = ${ownerKey}`;
    return new Response(JSON.stringify(rows[0] || { payload: null }), { headers });
  }

  if (request.method === "PUT") {
    const body = await request.json();
    if (!body || typeof body.payload !== "object") {
      return new Response(JSON.stringify({ error: "Payload invalide" }), { status: 400, headers });
    }
    const payload = JSON.stringify(body.payload);
    const rows = await db.sql`
      INSERT INTO app_state (owner_key, payload, updated_at)
      VALUES (${ownerKey}, ${payload}::jsonb, NOW())
      ON CONFLICT (owner_key)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      RETURNING updated_at
    `;
    return new Response(JSON.stringify({ ok: true, updated_at: rows[0].updated_at }), { headers });
  }

  return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
};
