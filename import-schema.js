import {captureRentBases, initialRent, RENT_POLICY_LABEL} from "./rent-policy.js";
export const importSchemas = [
  {sheet:"Proprietes",kind:"properties",label:"Propriétés",columns:["Code propriété","Nom","Type","Quartier","Adresse","Référence cadastrale","Couleur"],required:["Code propriété","Nom","Type","Quartier"]},
  {sheet:"Logements",kind:"units",label:"Logements",columns:["Code logement","Code propriété","Nom","Type","Loyer FCFA","Charges FCFA","Statut","Localisation","Description"],required:["Code logement","Code propriété","Nom","Type","Loyer FCFA","Statut"]},
  {sheet:"Locataires",kind:"tenants",label:"Locataires",columns:["Code locataire","Code logement","Nom","Téléphone","Email","Date entrée","Fin bail","Dépôt FCFA","Jour échéance","Pièce identité","Adresse","Conditions bail"],required:["Code locataire","Code logement","Nom","Téléphone","Date entrée","Fin bail"]},
  {sheet:"Echeances",kind:"invoices",label:"Échéances de loyer",columns:["Code échéance","Code locataire","Mois","Montant dû FCFA","Date échéance","Statut attendu"],required:["Code échéance","Code locataire","Mois","Montant dû FCFA","Date échéance"]},
  {sheet:"Paiements",kind:"payments",label:"Paiements reçus",columns:["Code paiement","Code locataire","Mois","Montant reçu FCFA","Date réception","Mode","Référence","Notes"],required:["Code paiement","Code locataire","Mois","Montant reçu FCFA","Date réception","Mode"]}
];
export const importLists = {
  "Proprietes:Type":["Studio","Appartement","Immeuble","Villa","Maison","Local commercial","Autre"],
  "Proprietes:Couleur":["Vert","Bleu","Violet","Orange","Rose","Ardoise"],
  "Logements:Type":["Studio","Appartement","Villa","Boutique","Bureau","Autre"],
  "Logements:Statut":["Vacant","Occupé","En travaux"],
  "Echeances:Statut attendu":["Payé","Partiel","Impayé"],
  "Paiements:Mode":["Espèces","Virement bancaire","Airtel Money","Moov Money","Chèque","Autre"]
};
const norm = v => String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
const str = v => v == null ? "" : String(v).trim();
const code = record => record.importCode || record.id;
export function prepareImport(sheets,source,makeId=()=>crypto.randomUUID()) {
  const payload=structuredClone(source),errors=[],changes=[],statusChecks=[];
  captureRentBases(payload);
  const seenSheets=new Set();
  const fail = (where,message) => { throw Error(`${where} : ${message}`); };
  const choose=(value,list,where,optional=false)=>{
    if(optional&&!str(value))return "";
    const result=list.find(x=>norm(x)===norm(value));if(!result)fail(where,`choisir ${list.join(" / ")}`);return result;
  };
  const amount=(value,where,min=0,optional=false)=>{
    if(optional&&!str(value))return 0;
    const n=typeof value==="number"?value:Number(str(value).replace(/[\s\u00a0]/g,"").replace(",","."));
    if(!str(value)||!Number.isSafeInteger(n)||n<min)fail(where,`montant entier requis, au moins ${min}`);return n;
  };
  const date=(value,where)=>{
    const s=value instanceof Date?value.toISOString().slice(0,10):str(value);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)fail(where,"date requise au format AAAA-MM-JJ");return s;
  };
  const month=(value,where)=>{const s=str(value);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))fail(where,"mois requis au format AAAA-MM");return s;};
  const resolve=(kind,value,where)=>{const matches=payload[kind].filter(x=>code(x)===str(value)||x.id===str(value));if(matches.length!==1)fail(where,"code lié introuvable ou ambigu");return matches[0];};
  const tenantSheet=sheets.find(s=>norm(s.sheet)==="locataires");
  const tenantHeaders=(tenantSheet?.data?.[0]||[]).map(norm);
  const tenantLinks=(tenantSheet?.data||[]).slice(1).map(row=>({tenant:str(row[tenantHeaders.indexOf("code locataire")]),unit:str(row[tenantHeaders.indexOf("code logement")])}));
  for(const schema of importSchemas) {
    const candidates=sheets.filter(s=>norm(s.sheet)===norm(schema.sheet));
    if(!candidates.length)continue;
    if(candidates.length>1){errors.push(`${schema.sheet} : feuille en double`);continue;}
    seenSheets.add(schema.sheet);
    const rows=candidates[0].data;
    if(!rows?.length)continue;
    const headers=rows[0].map(norm),seen=new Set();
    const missing=schema.required.filter(c=>!headers.includes(norm(c)));
    if(missing.length){errors.push(`${schema.sheet} : colonnes manquantes : ${missing.join(", ")}`);continue;}
    if(headers.filter(Boolean).length!==new Set(headers.filter(Boolean)).size){errors.push(`${schema.sheet} : en-têtes en double`);continue;}
    if(rows.length>2001){errors.push(`${schema.sheet} : maximum 2 000 lignes par import`);continue;}
    for(let index=1;index<rows.length;index++) {
      const row=rows[index];if(row.every(v=>v===null||v===undefined||str(v)===""))continue;
      const at=`${schema.sheet}, ligne ${index+1}`;
      try {
        const get=name=>row[headers.indexOf(norm(name))];
        for(const col of schema.required)if(!str(get(col)))fail(at,`${col} obligatoire`);
        const external=str(get(schema.columns[0]));
        if(external.length>100||/[<>\n\r]/.test(external))fail(at,"code invalide (100 caractères maximum)");
        if(seen.has(external))fail(at,`code en double : ${external}`);seen.add(external);
        const matches=payload[schema.kind].filter(x=>code(x)===external||x.id===external);
        if(matches.length>1)fail(at,"code existant ambigu");
        const existing=matches[0],record=existing?{...existing}:{id:`${schema.kind.slice(0,3)}_${makeId()}`};
        record.importCode=external;
        if(schema.kind==="properties")Object.assign(record,{name:str(get("Nom")),type:choose(get("Type"),importLists["Proprietes:Type"],at),district:str(get("Quartier")),address:str(get("Adresse")),cadastral:str(get("Référence cadastrale")),color:({Vert:"#176a61",Bleu:"#346aab",Violet:"#8061a4",Orange:"#b96b21",Rose:"#aa4e75",Ardoise:"#526675"})[choose(get("Couleur"),importLists["Proprietes:Couleur"],at,true)]||existing?.color||"#176a61"});
        if(schema.kind==="units"){
          const p=resolve("properties",get("Code propriété"),at);if(p.archived)fail(at,"propriété archivée");
          const status=choose(get("Statut"),importLists["Logements:Statut"],at);
          const currentTenant=payload.tenants.find(t=>t.id===existing?.tenantId);
          const assignedAgain=currentTenant&&tenantLinks.some(link=>(link.tenant===code(currentTenant)||link.tenant===currentTenant.id)&&(link.unit===external||link.unit===record.id));
          if(existing?.tenantId&&status!=="Occupé"&&!assignedAgain)fail(at,"un logement avec un locataire actif doit rester Occupé");
          if(existing&&existing.propertyId!==p.id&&payload.tenants.some(t=>t.unitId===existing.id))fail(at,"modifiez la propriété depuis la fiche pour préserver l’historique");
          Object.assign(record,{propertyId:p.id,name:str(get("Nom")),type:choose(get("Type"),importLists["Logements:Type"],at),rent:amount(get("Loyer FCFA"),at,1),charges:amount(get("Charges FCFA"),at,0,true),status:assignedAgain?"occupied":({Vacant:"vacant","Occupé":"occupied","En travaux":"works"})[status],tenantId:existing?.tenantId||null,locationDetail:str(get("Localisation")),description:str(get("Description"))});
        }
        if(schema.kind==="tenants"){
          const u=resolve("units",get("Code logement"),at);
          if(existing?.end)fail(at,"dossier clôturé : modification depuis la fiche uniquement");
          if(existing&&existing.unitId!==u.id)fail(at,"changement de logement : utilisez la fiche locataire");
          if(u.tenantId&&u.tenantId!==record.id)fail(at,"logement déjà affecté à un autre locataire");
          if(payload.properties.find(p=>p.id===u.propertyId)?.archived)fail(at,"propriété archivée");
          const start=date(get("Date entrée"),at),end=date(get("Fin bail"),at),due=amount(get("Jour échéance")||1,at,1);
          if(end<start)fail(at,"fin du bail antérieure à l’entrée");if(due>31)fail(at,"jour d’échéance entre 1 et 31");
          const email=str(get("Email"));if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(at,"email invalide");
          Object.assign(record,{unitId:u.id,name:str(get("Nom")),phone:str(get("Téléphone")),email,start,leaseEnd:end,deposit:amount(get("Dépôt FCFA"),at,0,true),dueDay:due,identityNumber:str(get("Pièce identité")),postalAddress:str(get("Adresse")),leaseNotes:str(get("Conditions bail"))});
          if(!existing){record.initialRent=initialRent(null,u);record.rentBaseSource="excel-unit";record.rentReview=RENT_POLICY_LABEL;}
          u.tenantId=record.id;u.status="occupied";
        }
        if(["payments","invoices"].includes(schema.kind)){
          const t=resolve("tenants",get("Code locataire"),at),period=month(get("Mois"),at);
          if(existing&&existing.tenantId!==t.id)fail(at,"ce code existe pour un autre locataire");
          Object.assign(record,{tenantId:t.id,unitId:t.unitId,month:period});
          if(schema.kind==="payments")Object.assign(record,{amount:amount(get("Montant reçu FCFA"),at,1),date:date(get("Date réception"),at),method:choose(get("Mode"),importLists["Paiements:Mode"],at),reference:str(get("Référence")),notes:str(get("Notes"))});
          else {
            if(payload.invoices.some(i=>i.id!==record.id&&i.tenantId===t.id&&i.month===period))fail(at,"échéance déjà présente pour ce locataire et ce mois. Réutilisez son code");
            const due=date(get("Date échéance"),at);
            Object.assign(record,{amount:amount(get("Montant dû FCFA"),at,1),dueDate:due,date:existing?.date||due,number:existing?.number||external});
            const expected=choose(get("Statut attendu"),importLists["Echeances:Statut attendu"],at,true);if(expected)statusChecks.push({id:record.id,expected,at});
          }
        }
        if(Object.values(record).some(v=>typeof v==="string"&&v.length>10000))fail(at,"texte trop long (10 000 caractères maximum)");
        if(existing)payload[schema.kind][payload[schema.kind].findIndex(x=>x.id===record.id)]=record;else payload[schema.kind].push(record);
        const changed=!existing||JSON.stringify(existing)!==JSON.stringify(record);
        changes.push({sheet:schema.label,code:external,label:record.name||record.number||`${record.month} · ${record.amount} FCFA`,action:existing?(changed?"Mettre à jour":"Identique"):"Ajouter"});
      }catch(error){errors.push(error.message);}
    }
  }
  if(!seenSheets.size)errors.push("Aucune feuille reconnue. Utilisez le modèle GestiLoc Dbz.");
  if(!changes.length&&!errors.length)errors.push("Le classeur est vide. Renseignez vos données sous les en-têtes.");
  for(const check of statusChecks){const inv=payload.invoices.find(x=>x.id===check.id);if(!inv)continue;const received=payload.payments.filter(x=>x.tenantId===inv.tenantId&&x.month===inv.month).reduce((n,x)=>n+x.amount,0);const actual=received>=inv.amount?"Payé":received>0?"Partiel":"Impayé";if(actual!==check.expected)errors.push(`${check.at} : statut ${check.expected} annoncé mais ${actual} calculé. Vérifiez les versements dans Paiements.`);}
  for(const schema of importSchemas)if(payload[schema.kind].length>10000)errors.push(`${schema.label} : la limite de 10 000 dossiers serait dépassée.`);
  if(new TextEncoder().encode(JSON.stringify(payload)).length>1_900_000)errors.push("Le volume total dépasse la capacité d’un enregistrement. Réduisez l’import.");
  return {payload,changes,errors};
}
