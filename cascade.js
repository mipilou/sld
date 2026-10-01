export function deletionPlan(source, kind, key) {
  const allowed = ["properties", "units", "tenants", "inspections", "payments", "invoices", "maintenance"];
  if (!allowed.includes(kind) || !source[kind]?.some(x => x.id === key)) throw Error("Élément introuvable.");
  const payload = structuredClone(source);
  const removed = Object.fromEntries(allowed.map(k => [k, new Set()]));
  removed[kind].add(key);
  if (kind === "properties") for (const u of payload.units) if (u.propertyId === key) removed.units.add(u.id);
  for (const t of payload.tenants) if (removed.units.has(t.unitId)) removed.tenants.add(t.id);
  for (const k of ["inspections", "payments", "invoices", "maintenance"]) for (const x of payload[k]) {
    if (removed.units.has(x.unitId) || removed.tenants.has(x.tenantId)) removed[k].add(x.id);
  }
  const photos = [];
  for (const i of payload.inspections) if (removed.inspections.has(i.id)) for (const p of i.photos || []) photos.push({scope:i.id, id:p.id});
  for (const p of payload.properties) if (removed.properties.has(p.id) && p.photo) photos.push({scope:`property-${p.id}`, id:p.photo.id});
  const counts = Object.fromEntries(allowed.map(k => [k, removed[k].size]));
  for (const k of allowed) payload[k] = payload[k].filter(x => !removed[k].has(x.id));
  for (const u of payload.units) if (removed.tenants.has(u.tenantId)) { u.tenantId = null; u.status = "vacant"; }
  return {payload, counts, photos};
}
