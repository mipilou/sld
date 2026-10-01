// Modèles dérivés des documents remis par le propriétaire. Les données viennent des fiches du dossier.
export const inspectionSections = [
  {title:"État général et accès", items:["Porte d’entrée et bâti","Serrure / verrou","Poignée","Jeux de clés et badges","Murs","Plafond","Sol et plinthes","Prises électriques","Interrupteurs","Point lumineux / douille","Fenêtres, vitrages et volets","Propreté générale"]},
  {title:"Salon", items:["Porte et poignée","Murs et peinture","Plafond","Sol et plinthes","Fenêtres et vitrages","Volets / rideaux","Prises électriques","Interrupteurs","Points lumineux / douilles","Placards ou étagères","Ventilation / grille d’aération","Propreté générale"]},
  {title:"Cuisine", items:["Porte et poignée","Murs / faïence","Plafond","Sol et plinthes","Fenêtres et vitrages","Évier et robinetterie","Arrivée et évacuation d’eau","Plan de travail / crédence","Placards : portes et poignées","Placards : tablettes et charnières","Prises et interrupteurs","Points lumineux / douilles","Ventilation / grille d’aération","Propreté générale"]},
  {title:"Salle d’eau et W.C.", items:["Porte, verrou et poignée","Murs / faïence","Plafond","Sol","Douche / receveur","Robinetterie, flexible et pommeau","Joints d’étanchéité","Évacuation / siphon","Cuvette, abattant et chasse d’eau","Lavabo / vasque","Miroir / accessoires","Prises et interrupteurs","Point lumineux","Ventilation / grille d’aération","Propreté générale"]},
  {title:"Chambre", items:["Porte et poignée","Murs et peinture","Plafond","Sol et plinthes","Fenêtres et vitrages","Volets / rideaux","Prises électriques","Interrupteurs","Points lumineux / douilles","Étagères : fixation et état","Placard","Ventilation / grille d’aération","Propreté générale"]}
];
export const inspectionItems = inspectionSections.flatMap(section => section.items.map(item => ({section:section.title,item})));
export const roomTypes = ["Salon","Séjour","Cuisine","Chambre","Salle d’eau","WC séparé","Buanderie","Balcon","Terrasse","Autre"];
export const roomEquipment = {
  "Salon":["Placards","Étagères","Climatisation","Ventilateur","Luminaires"],
  "Séjour":["Placards","Étagères","Climatisation","Ventilateur","Luminaires"],
  "Cuisine":["Placards","Évier","Plan de travail","Hotte","Chauffe-eau","Cuisinière"],
  "Chambre":["Placards","Étagères","Climatisation","Ventilateur","Miroir"],
  "Salle d’eau":["Douche","Lavabo","Miroir","Chauffe-eau","Meuble de rangement"],
  "WC séparé":["WC","Lavabo","Miroir"],
  "Buanderie":["Arrivée d’eau","Évacuation","Étagères"],
  "Balcon":["Garde-corps","Éclairage"],
  "Terrasse":["Garde-corps","Éclairage"],
  "Autre":["Placards","Étagères","Climatisation","Ventilateur","Luminaires"]
};
export function roomSummary(rooms,notes="") {
  const list=(Array.isArray(rooms)?rooms:[]).filter(room=>room.type).map((room,index)=>{
    const label=room.label?.trim()||`${room.type} ${rooms.slice(0,index+1).filter(x=>x.type===room.type).length}`;
    const details=[...(room.equipment||[]),...(room.type==="Salle d’eau"&&room.toilet==="integrated"?["WC intégré"]:[]),room.extra?.trim()].filter(Boolean);
    return `${label}${details.length?` : ${details.join(", ")}`:""}`;
  });
  return [...list,notes?.trim()].filter(Boolean).join(" ; ");
}
export function inspectionItemsForUnit(unit) {
  if(!Array.isArray(unit?.rooms)||!unit.rooms.length)return inspectionItems;
  const common=inspectionSections[0].items.map(item=>({section:"État général et accès",item}));
  const counts={};
  for(const room of unit.rooms){
    if(!room?.type)continue;
    counts[room.type]=(counts[room.type]||0)+1;
    const section=room.label?.trim()||`${room.type} ${counts[room.type]}`;
    const template=room.type==="Cuisine"?inspectionSections[2]:room.type==="Salle d’eau"||room.type==="WC séparé"?inspectionSections[3]:room.type==="Chambre"?inspectionSections[4]:inspectionSections[1];
    const items=room.type==="WC séparé"?template.items.filter(x=>!/Douche|pommeau|receveur/.test(x)):template.items;
    for(const item of items)common.push({section,item});
    for(const equipment of room.equipment||[])if(!items.some(item=>item.toLowerCase().includes(equipment.toLowerCase())))common.push({section,item:`Équipement : ${equipment}`});
    if(room.type==="Salle d’eau"&&room.toilet==="integrated")common.push({section,item:"WC intégré"});
  }
  return common;
}
const esc = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const text = value => value === null || value === undefined || String(value).trim() === "" ? "À compléter" : esc(value);
const para = value => text(value).replace(/\n/g,"<br>");
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR") : "À compléter";
const amount = value => value !== null && value !== undefined && String(value).trim() !== "" ? new Intl.NumberFormat("fr-FR").format(Number(value) || 0) + " FCFA" : "À compléter";
const valid = value => value !== null && value !== undefined && String(value).trim() !== "";
const line = (label,value) => `<p><strong>${esc(label)} :</strong> ${text(value)}</p>`;

export { leaseHTML } from "./lease-model.js";

export function inspectionHTML({inspection,tenant,unit,property,settings,entry,photoUrl,safeSignature}) {
  const i=inspection,t=tenant||{},u=unit||{},p=property||{},s=settings||{};
  const exiting=i.type==="Sortie", baseline=entry&&entry.id!==i.id?entry:null;
  const grouped=new Map();
  for(const item of i.items||[]){const group=item.section||"Autres éléments";if(!grouped.has(group))grouped.set(group,[]);grouped.get(group).push(item);}
  const rows=[...grouped].map(([section,items])=>`<h3>${esc(section)}</h3><table class="inspection-table"><thead><tr><th>Élément</th>${exiting?"<th>Entrée</th>":""}<th>${exiting?"Sortie":"État"}</th><th>Observations / anomalies</th></tr></thead><tbody>${items.map(x=>{
    const previous=baseline?.items?.find(e=>e.section===x.section&&e.item===x.item);
    return `<tr><td>${esc(x.item)}</td>${exiting?`<td>${previous?text(previous.state):"Sans constat"}</td>`:""}<td>${text(x.state)}</td><td>${esc(x.note||"—")}${exiting&&previous?.note?`<br><small>Entrée : ${esc(previous.note)}</small>`:""}</td></tr>`;
  }).join("")}</tbody></table>`).join("");
  const photoMarkup=(i.photos||[]).map(photo=>`<figure><img class="photo" src="${photoUrl(i.id,photo.id)}" alt="Photo de constat"><figcaption>${esc(photo.caption||"")}</figcaption></figure>`).join("");
  const legacy=exiting?(baseline?.items||[]).filter(item=>!item.section||item.section==="Autres éléments"):[];
  return `<h3>Identification du logement</h3><p><strong>Bailleur :</strong> ${text(s.ownerName)} · <strong>Preneur :</strong> ${text(t.name)}<br>Adresse du bien : ${text([p.address||p.district,s.city].filter(Boolean).join(", "))}<br>Logement : ${text(u.name)} (${text(u.type)}) · Précisions : ${text(u.locationDetail)}<br>Date du constat : ${date(i.date)} · Heure : ${text(i.time)} · Début du bail : ${date(t.start)}${exiting?` · Fin de l’occupation : ${date(i.date)}`:""}</p>
  <h3>Description des lieux</h3><p>${para(u.description)}</p>
  ${exiting?`<p><strong>Comparaison :</strong> ${baseline?`constat d’entrée du ${date(baseline.date)}.`:"aucun constat d’entrée enregistré pour ce locataire."} Les écarts et les éventuelles réserves sont consignés ci-dessous.</p>`:"<p>Chaque élément est évalué séparément ; « Non applicable » signifie que l’élément est absent.</p>"}
  ${rows||"<p>Aucun élément renseigné.</p>"}
  ${legacy.length?`<h3>Autres observations consignées à l’entrée</h3><table><tr><th>Élément</th><th>État à l’entrée</th><th>Observation</th></tr>${legacy.map(x=>`<tr><td>${esc(x.item)}</td><td>${text(x.state)}</td><td>${esc(x.note||"—")}</td></tr>`).join("")}</table>`:""}
  <h3>Relevés et ${exiting?"restitution":"remise"} des accès</h3><table><tr><th>Élément</th>${exiting?"<th>À l’entrée</th>":""}<th>${exiting?"À la sortie":"À l’entrée"}</th></tr>
  ${[["Compteur d’électricité", "electricity"],["Compteur d’eau", "water"],["Nombre de clés", "keys"],["Badges / télécommandes", "badges"],["Détail des clés et équipements", "keyDetails"]].map(([label,key])=>`<tr><td>${esc(label)}</td>${exiting?`<td>${baseline?text(baseline[key]):"—"}</td>`:""}<td>${text(i[key])}</td></tr>`).join("")}</table>
  ${exiting?`<h3>Réserves et remise en état</h3><p>${para(i.reservations)}</p>`:""}<h3>Observations complémentaires</h3><p>${para(i.notes)}</p>
  <h3>Photographies annexées (${(i.photos||[]).length})</h3>${photoMarkup||"<p>Aucune photographie jointe.</p>"}
  <p>Le présent constat est établi en présence des parties. Fait à ${text(s.city)}, le ${date(i.date)}.</p>
  <div class="signatures"><div><strong>Signature du bailleur</strong><br>${text(s.ownerName)}<br>${safeSignature(i.signatures?.landlord)?`<img src="${safeSignature(i.signatures.landlord)}" alt="Signature du bailleur">`:"_______________________"}</div><div><strong>Signature du preneur</strong><br>${text(t.name)}<br>${safeSignature(i.signatures?.tenant)?`<img src="${safeSignature(i.signatures.tenant)}" alt="Signature du preneur">`:"_______________________"}</div></div><p>Statut : ${i.finalizedAt?`signé et finalisé le ${date(i.finalizedAt)}`:"brouillon"}.</p>`;
}
