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
  const url = new URL(request.url);
  const inspectionId = url.searchParams.get("inspection");
  const photoId = url.searchParams.get("id");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(inspectionId || "")) return json({ error: "État des lieux invalide" }, 400);
  try {
    const db = getDatabase();
    const [row] = await db.sql`SELECT payload FROM app_state WHERE owner_key = ${user.id}`;
    const inspection = row?.payload?.inspections?.find((i) => i.id === inspectionId);
    if (!inspection) return json({ error: "État des lieux introuvable" }, 404);
    const store = getStore({ name: "gestiloc-photos", consistency: "strong" });
    if (request.method === "POST") {
      verifyRequestOrigin(request);
      const mime = request.headers.get("content-type")?.split(";")[0]?.toLowerCase();
      if (!mimeTypes.has(mime)) return json({ error: "Format JPEG, PNG ou WebP requis" }, 415);
      const buffer = await request.arrayBuffer();
      if (!buffer.byteLength || buffer.byteLength > 3_000_000) return json({ error: "Photo limitée à 3 Mo" }, 413);
      if (!matches(new Uint8Array(buffer), mime)) return json({ error: "Fichier image invalide" }, 415);
      const id = randomUUID();
      await store.set(`${user.id}/${inspectionId}/${id}`, new Blob([buffer], { type: mime }));
      return json({ id, mime }, 201);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(photoId || "")) return json({ error: "Photo invalide" }, 400);
    const photo = inspection.photos?.find((p) => p.id === photoId);
    if (!photo) return json({ error: "Photo introuvable" }, 404);
    const key = `${user.id}/${inspectionId}/${photo.id}`;
    if (request.method === "DELETE") {
      verifyRequestOrigin(request);
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
