import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { getUser, verifyRequestOrigin } from "@netlify/identity";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const mimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
function matches(bytes, mime) {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v);
  return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

export default async (request) => {
  const user = await getUser();
  if (!user?.id) return json({ error: "Connexion requise" }, 401);
  if (!Array.isArray(user.roles) || !user.roles.includes("admin")) return json({ error: "Accès réservé au propriétaire administrateur" }, 403);
  const url = new URL(request.url);
  const propertyId = url.searchParams.get("property");
  const inspectionId = propertyId || url.searchParams.get("inspection");
  const photoId = url.searchParams.get("id");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(inspectionId || "")) return json({ error: "État des lieux invalide" }, 400);
  try {
    const db = getDatabase();
    const [row] = await db.sql`SELECT payload, rev FROM app_state WHERE owner_key = ${user.id}`;
    const inspection = row?.payload?.[propertyId ? "properties" : "inspections"]?.find((i) => i.id === inspectionId);
    if (!inspection) return json({ error: "État des lieux introuvable" }, 404);
    if (inspection.finalizedAt && (request.method === "POST" || request.method === "DELETE")) return json({ error: "Constat signé : photos verrouillées" }, 409);
    const store = getStore({ name: "gestiloc-photos", consistency: "strong" });
    const scope = propertyId ? `property-${propertyId}` : inspectionId;
    if (propertyId && ["POST","DELETE"].includes(request.method) && row.rev !== Number(url.searchParams.get("rev"))) return json({error:"Données modifiées. Actualisez avant de modifier la photo."},409);
    if (request.method === "POST") {
      verifyRequestOrigin(request);
      const mime = request.headers.get("content-type")?.split(";")[0]?.toLowerCase();
      if (!mimeTypes.has(mime)) return json({ error: "Format JPEG, PNG ou WebP requis" }, 415);
      const buffer = await request.arrayBuffer();
      if (!buffer.byteLength || buffer.byteLength > 3_000_000) return json({ error: "Photo limitée à 3 Mo" }, 413);
      if (!matches(new Uint8Array(buffer), mime)) return json({ error: "Fichier image invalide" }, 415);
      const id = randomUUID();
      await store.set(`${user.id}/${scope}/${id}`, new Blob([buffer], { type: mime }));
      if (propertyId) {
        const previous = inspection.photo;
        inspection.photo = {id,mime};
        const payload = JSON.stringify(row.payload);
        const [saved] = await db.sql`UPDATE app_state SET payload = ${payload}::jsonb, rev = rev + 1, updated_at = NOW() WHERE owner_key = ${user.id} AND rev = ${row.rev} RETURNING rev`;
        if (!saved) { await store.delete(`${user.id}/${scope}/${id}`); return json({error:"Conflit. Actualisez puis réessayez."},409); }
        if (previous?.id) await store.delete(`${user.id}/${scope}/${previous.id}`).catch(()=>console.error("Old property photo cleanup failed"));
        return json({payload:row.payload,rev:saved.rev},201);
      }
      return json({ id, mime }, 201);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(photoId || "")) return json({ error: "Photo invalide" }, 400);
    const photo = propertyId ? (inspection.photo?.id === photoId ? inspection.photo : null) : inspection.photos?.find((p) => p.id === photoId);
    if (!photo) return json({ error: "Photo introuvable" }, 404);
    const key = `${user.id}/${scope}/${photo.id}`;
    if (request.method === "DELETE") {
      verifyRequestOrigin(request);
      if (propertyId) {
        delete inspection.photo;
        const payload = JSON.stringify(row.payload);
        const [saved] = await db.sql`UPDATE app_state SET payload = ${payload}::jsonb, rev = rev + 1, updated_at = NOW() WHERE owner_key = ${user.id} AND rev = ${row.rev} RETURNING rev`;
        if (!saved) return json({error:"Conflit. Actualisez puis réessayez."},409);
        await store.delete(key);
        return json({payload:row.payload,rev:saved.rev});
      }
      await store.delete(key);
      return json({ ok: true });
    }
    if (request.method !== "GET") return json({ error: "Méthode non autorisée" }, 405);
    const image = await store.get(key, { type: "arrayBuffer" });
    if (!image) return json({ error: "Photo introuvable" }, 404);
    return new Response(image, { headers: {
      "content-type": mimeTypes.has(photo.mime) ? photo.mime : "application/octet-stream",
      "cache-control": "private, no-store", "x-content-type-options": "nosniff"
    } });
  } catch (error) {
    if (error?.status === 403) return json({ error: "Origine non autorisée" }, 403);
    console.error("photo", error);
    return json({ error: "Erreur serveur" }, 500);
  }
};
