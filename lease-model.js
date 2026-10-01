// Structure des 24 articles du contrat remis par le propriétaire.
// Les conditions juridiques restent à relire et à adapter avant toute signature.
const esc=value=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const value=input=>input===null||input===undefined||String(input).trim()===""?"À compléter":esc(input);
const para=input=>value(input).replace(/\n/g,"<br>");
const date=input=>/^\d{4}-\d{2}-\d{2}$/.test(input||"")?new Date(`${input}T12:00:00`).toLocaleDateString("fr-FR"):"À compléter";
const amount=input=>input!==null&&input!==undefined&&String(input).trim()!==""?new Intl.NumberFormat("fr-FR").format(Number(input)||0)+" FCFA":"À compléter";
const article=(n,title,body)=>`<section class="lease-article"><h3>ARTICLE ${n} : ${esc(title)}</h3>${body}</section>`;

export function leaseHTML({tenant:t,unit:u,property:p={},settings:s={},entry}) {
  const address=[p.address||p.district,s.city].filter(Boolean).join(", ");
  const required=[
    ["nom du bailleur",s.ownerName],["adresse du bailleur",s.address],
    ["nom du preneur",t.name],["adresse du bien",address],
    ["description du logement",u.description],["date de prise d’effet",t.start],
    ["date de fin",t.leaseEnd],["loyer mensuel",u.rent]
  ].filter(([,v])=>v===null||v===undefined||String(v).trim()==="").map(([name])=>name);
  const intro=`<div class="lease-intro"><p><strong>Entre les soussignés</strong></p>
    <p><strong>Le BAILLEUR :</strong> ${value(s.ownerName)}${s.company?` (${esc(s.company)})`:""}<br>Adresse / boîte postale : ${value(s.address)} · Téléphone : ${value(s.phone)} · Courriel : ${value(s.email)}</p>
    <p><strong>Le PRENEUR :</strong> ${value(t.name)}<br>Adresse / boîte postale : ${value(t.postalAddress)} · Téléphone : ${value(t.phone)} · Courriel : ${value(t.email)} · Pièce d’identité : ${value(t.identityNumber)}</p>
    <p>Il a été convenu ce qui suit :</p></div>`;
  const sections=[
    article(1,"OBJET",`<p>Le bailleur donne à bail au preneur, qui accepte, le logement <strong>${value(u.name)}</strong> de type ${value(u.type)}, faisant partie du bien ${value(p.name)} situé à ${value(address)}. Référence cadastrale ou parcelle : ${value(p.cadastral)}. Précisions d’accès : ${value(u.locationDetail)}.</p>`),
    article(2,"CONSISTANCE ET DÉSIGNATION",`<p>Les lieux loués comprennent : ${para(u.description)}.</p><p>Destination convenue : ${value(t.purpose)}. Toute modification de cette destination est soumise à l’accord écrit des parties et aux règles applicables.</p>`),
    article(3,"ÉTAT DES LIEUX",`<p>Les parties établissent un constat contradictoire à l’entrée et un autre à la sortie. Les relevés des compteurs, la remise des clés, les observations et les photographies identifiées peuvent être joints aux constats.</p><p>État d’entrée enregistré : ${entry?`le ${date(entry.date)} ; clés remises : ${value(entry.keys)} ; badges / télécommandes : ${value(entry.badges)}`:"à établir ou à joindre"}.</p>`),
    article(4,"TRAVAUX AVANT OCCUPATION",`<p>Travaux autorisés avant l’occupation et modalités convenues : ${para(t.preOccupancyWorks)}.</p>`),
    article(5,"RÈGLEMENT DE COPROPRIÉTÉ",`<p>Le preneur prend connaissance du règlement intérieur ou de copropriété et des équipements communs éventuellement annexés. Conditions particulières applicables : ${para(u.sharedEquipment)}.</p>`),
    article(6,"DURÉE",`<p>Le bail prend effet le <strong>${date(t.start)}</strong> et a pour échéance prévue le <strong>${date(t.leaseEnd)}</strong>. Les conditions de prolongation et de remise des clés sont précisées aux articles suivants.</p>`),
    article(7,"RENOUVELLEMENT",`<p>Modalité retenue par les parties : <strong>${value(t.renewalMode)}</strong>. Toute reconduction ou absence de reconduction s’applique dans le respect des règles en vigueur.</p>`),
    article(8,"RÉSILIATION NON MOTIVÉE",`<p>Préavis convenu : ${t.noticeMonths?`${value(t.noticeMonths)} mois`:"À compléter"}. Les parties se notifient leur décision selon les formes et délais applicables. Les clés et accès sont restitués à la fin de l’occupation.</p>`),
    article(9,"REPRISE POUR HABITER",`<p>Une éventuelle reprise par le bailleur pour occupation personnelle ou familiale est exercée uniquement dans les conditions, formes et délais permis par les textes applicables.</p>`),
    article(10,"REPRISE POUR CONSTRUIRE",`<p>Une éventuelle reprise motivée par une reconstruction ou des travaux nécessitant l’évacuation des lieux est notifiée et mise en œuvre dans les conditions prévues par les règles applicables.</p>`),
    article(11,"TRAVAUX D’AMÉLIORATION",`<p>Le bailleur informe le preneur des travaux d’amélioration envisagés. Leur calendrier, l’accès aux lieux et les conséquences éventuelles sur l’occupation sont convenus dans le respect des droits des parties.</p>`),
    article(12,"RÉSILIATION À L’AMIABLE",`<p>Les parties peuvent mettre fin au contrat d’un commun accord écrit, en précisant la date de départ, la remise des clés, l’état des lieux de sortie et le règlement des comptes.</p>`),
    article(13,"CESSION DES BIENS LOUÉS AVEC FIN DU BAIL",`<p>En cas de projet de vente ou de cession accompagné d’une demande de fin du bail, les parties appliquent les règles de notification, de préavis et les droits éventuels du preneur prévus par les textes applicables.</p>`),
    article(14,"CESSION DES BIENS LOUÉS SANS FIN DU BAIL",`<p>Si la propriété change de titulaire sans mettre fin à la location, le preneur est informé des coordonnées du nouveau bailleur et de la continuité ou des modifications autorisées du contrat.</p>`),
    article(15,"LOYER ET CAUTION",`<p>Loyer mensuel convenu : <strong>${amount(u.rent)}</strong>, payable le ${value(t.dueDay)} de chaque mois par ${value(t.leasePaymentMethod)}. Les parties distinguent le loyer, les charges et le dépôt de garantie détaillé à l’article 17.</p>`),
    article(16,"CHARGES LOCATIVES ET CHARGES DIVERSES",`<p>Charges mensuelles convenues : <strong>${amount(u.charges)}</strong>. Les abonnements, consommations d’eau, d’électricité et autres services sont réglés selon les contrats et justificatifs correspondants. Leur répartition détaillée peut être précisée dans les conditions particulières.</p>`),
    article(17,"DÉPÔT DE GARANTIE",`<p>Dépôt de garantie convenu à l’entrée : <strong>${amount(t.deposit)}</strong>. Sa restitution et les éventuelles retenues sont établies sur la base du constat de sortie, des comptes et des justificatifs, conformément aux règles applicables. Aucun autre dépôt n’est présumé par ce modèle.</p>`),
    article(18,"CESSION DU BAIL ET SOUS-LOCATION",`<p>Une cession du bail ou une sous-location nécessite un accord préalable écrit du bailleur et le respect des conditions applicables. Les modalités particulières sont consignées par écrit.</p>`),
    article(19,"OBLIGATIONS DES PARTIES",`<p><strong>Preneur :</strong> occuper paisiblement les lieux selon leur destination, entretenir les équipements confiés, signaler les incidents et restituer les lieux et accès à la sortie, sous réserve de l’usure normale et des responsabilités légalement applicables.</p><p><strong>Bailleur :</strong> délivrer le logement convenu, permettre sa jouissance paisible et prendre en charge les obligations qui lui incombent, notamment les réparations ne relevant pas de l’entretien locatif.</p>`),
    article(20,"AUGMENTATION DU LOYER",`<p>Modalité de révision retenue : ${value(t.rentReview)}. Toute modification du montant est soumise à l’accord des parties et aux règles en vigueur.</p>`),
    article(21,"RÉSILIATION MOTIVÉE",`<p>En cas d’inexécution d’une obligation, la partie concernée peut agir dans les formes et délais prévus par les textes applicables. Les motifs, les notifications et les possibilités de régularisation doivent être examinés avant toute résiliation.</p>`),
    article(22,"RÉSILIATION JUDICIAIRE",`<p>Tout différend non résolu à l’amiable peut être soumis à la juridiction compétente selon les règles de procédure applicables.</p>`),
    article(23,"FRAIS ET DROITS D’ENREGISTREMENT",`<p>Répartition convenue des frais et droits : ${value(t.feesResponsibility)}. Les formalités obligatoires sont accomplies dans les conditions applicables.</p>`),
    article(24,"ÉLECTION DE DOMICILE",`<p>Pour l’exécution du bail, les parties indiquent leurs coordonnées : bailleur à ${value(s.address)} ; preneur à ${value(t.postalAddress)}. Chaque changement d’adresse est notifié à l’autre partie.</p>`)
  ];
  return `${required.length?`<aside class="draft"><strong>Champs essentiels à compléter avant signature :</strong> ${esc(required.join(", "))}.</aside>`:""}
    <p class="document-note">Contrat préparé à partir du modèle remis par le propriétaire. Les dispositions et montants doivent être relus par les parties avant signature.</p>
    ${intro}${sections.join("")}
    <h3>CONDITIONS PARTICULIÈRES ET ANNEXES</h3><p>${para(t.leaseNotes)}</p><p>${para(s.leaseClauses)}</p><p>Annexes à joindre selon le dossier : état des lieux d’entrée, relevés, liste des accès et photographies.</p>
    <h3>COMPLÉMENTS MANUELS CONVENUS ENTRE LES PARTIES</h3><p>${t.leaseManual?para(t.leaseManual):"Éléments à compléter à la main avant signature :"}</p>
    ${Array.from({length:Math.min(12,Math.max(2,Number(t.manualLines)||5))},()=>'<div style="height:26px;border-bottom:1px dotted #899c9b;break-inside:avoid"></div>').join("")}
    <p>Fait à ${value(s.city)}, le ____________________, en ______ exemplaires.</p>
    <div class="signatures"><div><strong>LE BAILLEUR</strong><br>${value(s.ownerName)}<br><br>_______________________</div><div><strong>LE PRENEUR</strong><br>${value(t.name)}<br><br>_______________________</div></div>`;
}
