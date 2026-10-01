import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { deletionPlan } from "../../cascade.js";
const json = (v,status=200) => new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export default async request => {
  const user = await getUser();
  if (!user?.id) return json({error:"Connexion requise"},401);
  if (!Array.isArray(user.roles) || !user.roles.includes("admin")) return json({error:"Action réservée à l’administrateur"},403);
  if (request.method !== "POST") return json({error:"Méthode non autorisée"},405);
  try {
    verifyRequestOrigin(request);
    const body = await request.json();
    if (body.confirmation !== "SUPPRIMER" || !Number.isInteger(body.baseRev)) return json({error:"Confirmation requise"},400);
    const db = getDatabase();
    const [current] = await db.sql`SELECT payload, rev FROM app_state WHERE owner_key = ${user.id}`;
    if (!current || current.rev !== body.baseRev) return json({error:"Données modifiées. Actualisez avant de supprimer."},409);
    let plan;
    try { plan = deletionPlan(current.payload,body.kind,body.id); } catch(error) { return json({error:error.message},404); }
    const serialized = JSON.stringify(plan.payload);
    const [saved] = await db.sql`UPDATE app_state SET payload = ${serialized}::jsonb, rev = rev + 1, updated_at = NOW() WHERE owner_key = ${user.id} AND rev = ${body.baseRev} RETURNING rev`;
    if (!saved) return json({error:"Conflit. Actualisez avant de supprimer."},409);
    const store = getStore({name:"gestiloc-photos",consistency:"strong"});
    let failed = 0;
    for (const photo of plan.photos) {
      if (!/^[a-zA-Z0-9_-]{1,120}$/.test(photo.scope) || !/^[a-zA-Z0-9_-]{1,100}$/.test(photo.id)) continue;
      try { await store.delete(`${user.id}/${photo.scope}/${photo.id}`); }
      catch { failed++; console.error("Photo cleanup failed after deletion", user.id); }
    }
    return json({payload:plan.payload, rev:saved.rev, warning:failed?`${failed} fichier(s) devenu(s) inaccessible(s) nécessitent un nettoyage du stockage Netlify.`:null});
  } catch(error) {
    if (error?.status === 403) return json({error:"Origine non autorisée"},403);
    console.error("force-delete",error);
    return json({error:"Suppression impossible. Actualisez pour vérifier le résultat."},500);
  }
};
