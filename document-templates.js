// Modèles dérivés des documents remis par le propriétaire. Les données viennent des fiches du dossier.
export const inspectionSections = [
  {title:"État général et accès", items:["Porte d’entrée et bâti","Serrure / verrou","Poignée","Jeux de clés et badges","Murs","Plafond","Sol et plinthes","Prises électriques","Interrupteurs","Point lumineux / douille","Fenêtres, vitrages et volets","Propreté générale"]},
  {title:"Salon", items:["Porte et poignée","Murs et peinture","Plafond","Sol et plinthes","Fenêtres et vitrages","Volets / rideaux","Prises électriques","Interrupteurs","Points lumineux / douilles","Placards ou étagères","Ventilation / grille d’aération","Propreté générale"]},
  {title:"Cuisine", items:["Porte et poignée","Murs / faïence","Plafond","Sol et plinthes","Fenêtres et vitrages","Évier et robinetterie","Arrivée et évacuation d’eau","Plan de travail / crédence","Placards : portes et poignées","Placards : tablettes et charnières","Prises et interrupteurs","Points lumineux / douilles","Ventilation / grille d’aération","Propreté générale"]},
  {title:"Salle d’eau et W.C.", items:["Porte, verrou et poignée","Murs / faïence","Plafond","Sol","Douche / receveur","Robinetterie, flexible et pommeau","Joints d’étanchéité","Évacuation / siphon","Cuvette, abattant et chasse d’eau","Lavabo / vasque","Miroir / accessoires","Prises et interrupteurs","Point lumineux","Ventilation / grille d’aération","Propreté générale"]},
  {title:"Chambre", items:["Porte et poignée","Murs et peinture","Plafond","Sol et plinthes","Fenêtres et vitrages","Volets / rideaux","Prises électriques","Interrupteurs","Points lumineux / douilles","Étagères : fixation et état","Placard","Ventilation / grille d’aération","Propreté générale"]}
];
export const inspectionItems = inspectionSections.flatMap(section => section.items.map(item => ({section:section.title,item})));
const esc = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const text = value => value === null || value === undefined || String(value).trim() === "" ? "À compléter" : esc(value);
const para = value => text(value).replace(/\n/g,"<br>");
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR") : "À compléter";
const amount = value => value !== null && value !== undefined && String(value).trim() !== "" ? new Intl.NumberFormat("fr-FR").format(Number(value) || 0) + " FCFA" : "À compléter";
const valid = value => value !== null && value !== undefined && String(value).trim() !== "";
const line = (label,value) => `<p><strong>${esc(label)} :</strong> ${text(value)}</p>`;

export function leaseHTML({tenant,unit,property,settings,entry}) {
  const t=tenant,u=unit,p=property||{},s=settings||{};
  const address=[p.address||p.district,s.city].filter(Boolean).join(", ");
  const missing=[
    ["nom du bailleur",s.ownerName],["coordonnées du bailleur",s.address],["adresse du bien",address],
    ["composition du logement",u.description],["date de fin du bail",t.leaseEnd],["montant du loyer",u.rent]
  ].filter(([,value])=>!valid(value)).map(([label])=>label);
  return `${missing.length?`<aside class="draft"><strong>Document à compléter avant signature :</strong> ${esc(missing.join(", "))}.</aside>`:""}
  <h3>Entre les soussignés</h3>
  <p><strong>Bailleur :</strong> ${text(s.ownerName)}${s.company?` (${esc(s.company)})`:""}<br>Adresse / B.P. : ${text(s.address)} · Téléphone : ${text(s.phone)} · E-mail : ${text(s.email)}</p>
  <p><strong>Preneur :</strong> ${text(t.name)}<br>Adresse / B.P. : ${text(t.postalAddress)} · Téléphone : ${text(t.phone)} · E-mail : ${text(t.email)}<br>Pièce d’identité : ${text(t.identityNumber)}</p>
  <h3>Article 1 — Objet et localisation</h3>
  <p>Le bailleur donne à bail au preneur le logement <strong>${text(u.name)}</strong>, de type ${text(u.type)}, situé dans le bien ${text(p.name)} à ${text(address)}. Précisions d’accès : ${text(u.locationDetail)}. Référence cadastrale : ${text(p.cadastral)}.</p>
  <h3>Article 2 — Consistance et destination</h3><p>${para(u.description)}</p>${line("Usage convenu",t.purpose)}
  <h3>Article 3 — État des lieux et remise des accès</h3><p>Un état des lieux d’entrée est établi lors de la remise des accès. Un état des lieux de sortie est établi lors de leur restitution et comparé au constat d’entrée. Les photographies et observations peuvent être annexées aux constats.</p>
  ${entry?`<p>Constat d’entrée enregistré le ${date(entry.date)} · Clés remises : ${text(entry.keys)} · Badges / télécommandes : ${text(entry.badges)}.</p>`:"<p>État des lieux d’entrée : à réaliser ou à joindre.</p>"}
  <h3>Article 4 — Durée</h3><p>Prise d’effet : <strong>${date(t.start)}</strong> · Date de fin prévue : <strong>${date(t.leaseEnd)}</strong>. Les conditions de renouvellement et de préavis sont à convenir et à relire entre les parties.</p>
  <h3>Article 5 — Loyer et charges</h3><table><tr><th>Loyer mensuel</th><td>${amount(u.rent)}</td></tr><tr><th>Charges mensuelles convenues</th><td>${amount(u.charges)}</td></tr><tr><th>Échéance du paiement</th><td>Le ${text(t.dueDay)} de chaque mois</td></tr><tr><th>Modes de paiement convenus</th><td>${text(t.leasePaymentMethod)}</td></tr></table>
  <h3>Article 6 — Dépôt de garantie</h3><p>Dépôt convenu : <strong>${amount(t.deposit)}</strong>. Les modalités de restitution, ainsi que les retenues justifiées éventuelles, sont à préciser entre les parties.</p>
  <h3>Article 7 — Utilisation, entretien et charges directes</h3><p>Le preneur occupe les lieux selon la destination indiquée ci-dessus et prend soin des équipements remis. Les abonnements, consommations, réparations, travaux et modalités de visite sont à préciser dans les conditions particulières et annexes.</p>
  <h3>Article 8 — Conditions particulières</h3><p>${para(t.leaseNotes)}</p>
  <h3>Article 9 — Clauses complémentaires du bailleur</h3><p>${para(s.leaseClauses)}</p>
  <h3>Annexes</h3><p>État des lieux d’entrée, relevés, liste des clés et photographies, selon les pièces établies et remises aux parties.</p>
  <p>Les parties relisent et complètent les clauses applicables avant signature. Fait à ${text(s.city)}, le ____________________, en ______ exemplaires.</p>
  <div class="signatures"><div><strong>Le bailleur</strong><br>${text(s.ownerName)}<br><br>_______________________</div><div><strong>Le preneur</strong><br>${text(t.name)}<br><br>_______________________</div></div>`;
}

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
