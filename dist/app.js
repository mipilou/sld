const FCFA = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 });
const now = new Date();
const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
const uid = (prefix="id") => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

const seed = {
  properties:[
    {id:"p1",name:"Résidence Angondjé",district:"Angondjé",type:"Immeuble",units:4},
    {id:"p2",name:"Villa Batterie IV",district:"Batterie IV",type:"Villa",units:1},
    {id:"p3",name:"Boutiques Louis",district:"Louis",type:"Local commercial",units:3}
  ],
  units:[
    {id:"u1",propertyId:"p1",name:"Studio A1",type:"Studio",rent:180000,status:"occupied",tenantId:"t1"},
    {id:"u2",propertyId:"p1",name:"Appartement A2",type:"Appartement",rent:350000,status:"occupied",tenantId:"t2"},
    {id:"u3",propertyId:"p1",name:"Studio B1",type:"Studio",rent:200000,status:"vacant",tenantId:null},
    {id:"u4",propertyId:"p1",name:"Appartement B2",type:"Appartement",rent:380000,status:"works",tenantId:null},
    {id:"u5",propertyId:"p2",name:"Villa principale",type:"Villa",rent:650000,status:"occupied",tenantId:"t3"},
    {id:"u6",propertyId:"p3",name:"Boutique 1",type:"Boutique",rent:250000,status:"occupied",tenantId:"t4"},
    {id:"u7",propertyId:"p3",name:"Boutique 2",type:"Boutique",rent:250000,status:"vacant",tenantId:null},
    {id:"u8",propertyId:"p3",name:"Boutique 3",type:"Boutique",rent:250000,status:"occupied",tenantId:"t5"}
  ],
  tenants:[
    {id:"t1",name:"Mélissa Nguema",phone:"+241 06 00 12 34",email:"melissa@example.com",unitId:"u1",start:"2026-02-01"},
    {id:"t2",name:"Junior Moussavou",phone:"+241 07 11 22 33",email:"junior@example.com",unitId:"u2",start:"2025-11-01"},
    {id:"t3",name:"Clarisse Obiang",phone:"+241 06 88 20 40",email:"clarisse@example.com",unitId:"u5",start:"2026-01-15"},
    {id:"t4",name:"Café Nkomo",phone:"+241 07 45 78 20",email:"contact@example.com",unitId:"u6",start:"2025-08-01"},
    {id:"t5",name:"Atelier Mbolo",phone:"+241 06 31 52 10",email:"atelier@example.com",unitId:"u8",start:"2026-04-01"}
  ],
  payments:[
    {id:"pay1",tenantId:"t1",unitId:"u1",month:monthKey,amount:180000,date:`${monthKey}-05`,method:"Airtel Money"},
    {id:"pay2",tenantId:"t2",unitId:"u2",month:monthKey,amount:200000,date:`${monthKey}-08`,method:"Virement"},
    {id:"pay3",tenantId:"t3",unitId:"u5",month:monthKey,amount:650000,date:`${monthKey}-03`,method:"Virement"},
    {id:"pay4",tenantId:"t4",unitId:"u6",month:monthKey,amount:250000,date:`${monthKey}-01`,method:"Moov Money"}
  ],
  invoices:[],
  maintenance:[
    {id:"m1",unitId:"u4",title:"Reprise peinture salon",category:"Peinture",priority:"Moyenne",status:"En cours",cost:175000,date:"2026-09-18"},
    {id:"m2",unitId:"u1",title:"Fuite sous évier",category:"Plomberie",priority:"Urgente",status:"Signalé",cost:0,date:"2026-09-20"},
    {id:"m3",unitId:"u6",title:"Remplacement serrure",category:"Serrurerie",priority:"Haute",status:"Terminé",cost:45000,date:"2026-09-12"}
  ],
  inspections:[]
};

const san=v=>typeof v==="string"?v.replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"):Array.isArray(v)?v.map(san):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,san(x)])):v;
const normalize=s=>{const o=san(s||{});for(const k of ["properties","units","tenants","payments","invoices","maintenance","inspections"])o[k]=Array.isArray(o[k])?o[k]:[];o.settings={ownerName:"Propriétaire",company:"",phone:"",city:"Libreville",...(o.settings||{})};return o};
const LS=localStorage;
const SESSION=sessionStorage;
LS.removeItem("gestiloc-code"); // Retire le code en clair éventuellement laissé par la version précédente.
// Keep local work and each cloud owner's cache separate on shared devices.
let activeStore="gestiloc-local";
if(LS.getItem("gestiloc-state")&&!LS.getItem(`${activeStore}-state`))LS.setItem(`${activeStore}-state`,LS.getItem("gestiloc-state"));
const storageKey=name=>`${activeStore}-${name}`;
const loadState=()=>normalize(JSON.parse(LS.getItem(storageKey("state"))||"null")||{});
let state=loadState();
let currentView = "dashboard";
let saveTimer;
let localRevision=0;

const $ = s => document.querySelector(s);
const app = $("#app");
const titles = {dashboard:"Vue d'ensemble",properties:"Propriétés",units:"Logements",tenants:"Locataires",payments:"Paiements",invoices:"Factures mensuelles",inspections:"États des lieux",maintenance:"Travaux et maintenance",reports:"Rapports",settings:"Paramètres"};
const property = id => state.properties.find(x=>x.id===id);
const unit = id => state.units.find(x=>x.id===id);
const tenant = id => state.tenants.find(x=>x.id===id);
const paid = (tenantId, month=monthKey) => state.payments.filter(p=>p.tenantId===tenantId&&p.month===month).reduce((s,p)=>s+Number(p.amount),0);
const expected = () => state.units.filter(u=>u.status==="occupied").reduce((s,u)=>s+Number(u.rent),0);
const collected = () => state.payments.filter(p=>p.month===monthKey).reduce((s,p)=>s+Number(p.amount),0);

const api=(method,body)=>fetch("/api/state",{method,headers:{"content-type":"application/json","x-access-code":SESSION.getItem("gestiloc-code")||""},body:body&&JSON.stringify(body)});
function persist(message="Modifications enregistrées"){
  localRevision++;
  LS.setItem(storageKey("state"),JSON.stringify(state));LS.setItem(storageKey("dirty"),"1");
  clearTimeout(saveTimer);if(SESSION.getItem("gestiloc-code"))saveTimer=setTimeout(()=>syncToCloud(false),700);
  if(message)toast(message);
}
async function syncFromCloud(){
  if(!SESSION.getItem("gestiloc-code"))return setSync(false);
  const store=activeStore;
  try{
    const r=await api("GET");
    if(store!==activeStore)return;
    if(r.status===401){SESSION.removeItem("gestiloc-code");activeStore="gestiloc-local";state=loadState();render();showLogin("Code d’accès invalide.");return setSync(false)}
    if(!r.ok)throw 0;
    const d=await r.json();
    if(d.payload&&LS.getItem(storageKey("dirty"))!=="1"){state=normalize(d.payload);LS.setItem(storageKey("state"),JSON.stringify(state));LS.setItem(storageKey("rev"),d.rev);render()}
    else return syncToCloud(false);
    setSync(true);
  }catch{setSync(false)}
}
async function syncToCloud(notify=true,force=false){
  if(!SESSION.getItem("gestiloc-code")){showLogin();return}
  const store=activeStore, sentRevision=localRevision;
  try{
    const r=await api("PUT",{payload:state,baseRev:force?undefined:Number(LS.getItem(storageKey("rev"))||0)});
    if(store!==activeStore)return;
    if(r.status===401){SESSION.removeItem("gestiloc-code");activeStore="gestiloc-local";state=loadState();render();showLogin("Code d’accès invalide.");throw 0}
    if(r.status===409){
      if(confirm("Une version plus récente existe sur le serveur.\nOK = écraser avec les données de cet appareil\nAnnuler = récupérer la version du serveur"))return syncToCloud(notify,true);
      LS.removeItem(storageKey("dirty"));return syncFromCloud();
    }
    if(!r.ok)throw 0;
    const d=await r.json();LS.setItem(storageKey("rev"),d.rev);
    if(sentRevision===localRevision)LS.removeItem(storageKey("dirty"));
    else {clearTimeout(saveTimer);saveTimer=setTimeout(()=>syncToCloud(false),700)}
    setSync(true);if(notify)toast("Données synchronisées");
  }catch{setSync(false);if(notify)toast("Données conservées localement")}
}
function setSync(ok){$("#syncLabel").textContent=ok?"Synchronisé":"Mode local";document.querySelector(".sync-dot").classList.toggle("online",ok)}
function toast(text){const t=$("#toast");t.textContent=text;t.hidden=false;setTimeout(()=>t.hidden=true,2600)}
function statusLabel(v){return ({occupied:"Occupé",vacant:"Vacant",works:"En travaux"})[v]||v}
function badge(v){const c=/payé|occupé|terminé/i.test(v)?"good":/retard|impayé|urgent/i.test(v)?"bad":/partiel|travaux|cours|signalé|à payer|brouillon/i.test(v)?"warn":"info";return `<span class="status ${c}">${v}</span>`}
function searchRows(value){document.querySelectorAll("[data-search]").forEach(r=>r.hidden=!r.dataset.search.toLowerCase().includes(value.toLowerCase()))}

function shell(title,subtitle,actions="",body=""){
  return `<div class="hero"><div><h2>${title}</h2><p>${subtitle}</p></div><div class="actions">${actions}</div></div>${body}`;
}
function dashboard(){
  const exp=expected(), col=collected(), arrears=Math.max(exp-col,0), occupied=state.units.filter(u=>u.status==="occupied").length, occupancy=state.units.length?Math.round(occupied/state.units.length*100):0;
  const mlist=[...Array(6)].map((_,i)=>{const d=new Date(now.getFullYear(),now.getMonth()-5+i,1);return{k:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,l:d.toLocaleDateString("fr-FR",{month:"short"})}});const months=mlist.map(m=>m.l);const vals=mlist.map(m=>exp?Math.min(100,Math.round(state.payments.filter(p=>p.month===m.k).reduce((s,p)=>s+Number(p.amount),0)/exp*100)):0);
  const overdue=state.units.filter(u=>u.status==="occupied").map(u=>({u,t:tenant(u.tenantId),due:u.rent-paid(u.tenantId)})).filter(x=>x.due>0);
  const hr=now.getHours();return shell(`${hr<12?"Bonjour":hr<18?"Bon après-midi":"Bonsoir"}, ${state.settings.ownerName}`,`Voici la situation de votre patrimoine à ${state.settings.city}.`,state.units.length?`<button class="btn secondary" data-action="invoice-run">Émettre les factures</button><button class="btn primary" data-action="payment-add">+ Enregistrer un paiement</button>`:`<button class="btn primary" data-view="properties">+ Ajouter votre première propriété</button>`,`
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-top"><span>Patrimoine</span><span class="kpi-icon">▦</span></div><p>Logements occupés</p><strong>${occupied}/${state.units.length}</strong><small>Taux d'occupation : ${occupancy}%</small></div>
      <div class="kpi"><div class="kpi-top"><span>Encaissements</span><span class="kpi-icon">₣</span></div><p>Loyers encaissés</p><strong>${FCFA.format(col)}</strong><small>Sur ${FCFA.format(exp)} attendus</small></div>
      <div class="kpi danger"><div class="kpi-top"><span>À recouvrer</span><span class="kpi-icon">!</span></div><p>Retards du mois</p><strong>${FCFA.format(arrears)}</strong><small>${overdue.length} locataire(s) concerné(s)</small></div>
      <div class="kpi warning"><div class="kpi-top"><span>Maintenance</span><span class="kpi-icon">⌁</span></div><p>Travaux actifs</p><strong>${state.maintenance.filter(m=>m.status!=="Terminé").length}</strong><small>${state.maintenance.filter(m=>m.priority==="Urgente").length} urgence(s)</small></div>
    </div>
    <div class="grid-2"><div class="card"><div class="card-head"><div><h3>Taux de recouvrement</h3><span class="card-sub">Six derniers mois</span></div><strong>${exp?Math.round(col/exp*100):0}%</strong></div><div class="bar-chart">${months.map((m,i)=>`<div class="bar-wrap"><div class="bar" style="height:${vals[i]}%"></div><span>${m}</span></div>`).join("")}</div></div>
    <div class="card"><div class="card-head"><div><h3>Alertes prioritaires</h3><span class="card-sub">Actions recommandées</span></div></div><div class="alerts">${overdue.slice(0,3).map(x=>`<div class="alert bad"><span class="alert-dot"></span><div><strong>${x.t?.name||"Locataire"}</strong><small>${x.u.name} · ${FCFA.format(x.due)} restant</small></div>${badge("Retard")}</div>`).join("")}${state.maintenance.filter(m=>m.status!=="Terminé").slice(0,2).map(m=>`<div class="alert"><span class="alert-dot"></span><div><strong>${m.title}</strong><small>${unit(m.unitId)?.name||"Logement"}</small></div>${badge(m.status)}</div>`).join("")}</div></div></div>`);
}

function properties(){return shell("Vos propriétés","Une vision consolidée de chaque bien.",`<button class="btn primary" data-action="property-add">+ Ajouter une propriété</button>`,`<div class="property-grid">${state.properties.map((p,i)=>{const us=state.units.filter(u=>u.propertyId===p.id),occ=us.filter(u=>u.status==="occupied").length,rev=us.filter(u=>u.status==="occupied").reduce((s,u)=>s+u.rent,0);return `<article class="property-card"><div class="property-cover"><span>${p.type}</span>${badge(`${occ}/${us.length} occupés`)}</div><div class="property-card-body"><h3>${p.name}</h3><p>📍 ${p.district}, Libreville</p><div class="property-stats"><div><strong>${us.length}</strong><span>Unités</span></div><div><strong>${occ}</strong><span>Occupées</span></div><div><strong>${Math.max(us.length-occ,0)}</strong><span>Libres</span></div></div><div class="progress"><span style="width:${us.length?occ/us.length*100:0}%"></span></div><p style="margin-top:12px"><strong>${FCFA.format(rev)}</strong> / mois</p><div class="card-actions">${actions("properties",p.id)}</div></div></article>`}).join("")}</div>`)}

function tablePage(kind){
  const configs={
    units:{title:"Logements",sub:"Occupation, loyers et rattachement aux locataires.",action:"unit-add",label:"Ajouter un logement",heads:["Logement","Propriété","Type","Loyer","Statut","Locataire"],ids:state.units.map(u=>u.id),rows:state.units.map(u=>[u.name,property(u.propertyId)?.name,u.type,FCFA.format(u.rent),badge(statusLabel(u.status)),tenant(u.tenantId)?.name||"—"])},
    tenants:{title:"Locataires",sub:"Coordonnées, logement et situation de paiement.",action:"tenant-add",label:"Ajouter un locataire",heads:["Locataire","Téléphone","Logement","Loyer","Payé ce mois","Situation"],ids:state.tenants.map(t=>t.id),rows:state.tenants.map(t=>{const u=unit(t.unitId),p=paid(t.id),due=Math.max((u?.rent||0)-p,0);return [t.name,t.phone,u?.name||"—",FCFA.format(u?.rent||0),FCFA.format(p),badge(due===0?"Payé":p>0?"Partiel":"En retard")]})},
    payments:{title:"Paiements",sub:"Historique des règlements et traçabilité.",action:"payment-add",label:"Enregistrer un paiement",heads:["Date","Locataire","Logement","Période","Montant","Mode"],ids:[...state.payments].reverse().map(p=>p.id),rows:[...state.payments].reverse().map(p=>[new Date(p.date).toLocaleDateString("fr-FR"),tenant(p.tenantId)?.name||"—",unit(p.unitId)?.name||"—",p.month,FCFA.format(p.amount),p.method])},
    maintenance:{title:"Travaux et maintenance",sub:"Incidents, priorités, coûts et avancement.",action:"maintenance-add",label:"Déclarer des travaux",heads:["Intervention","Logement","Catégorie","Priorité","Coût","Statut"],ids:state.maintenance.map(m=>m.id),rows:state.maintenance.map(m=>[m.title,unit(m.unitId)?.name||"—",m.category,m.priority,FCFA.format(m.cost),badge(m.status)])}
  };const c=configs[kind];
  return shell(c.title,c.sub,`<button class="btn primary" data-action="${c.action}">+ ${c.label}</button>`,`<div class="card table-card"><div class="toolbar"><div class="search"><span>⌕</span><input id="searchInput" placeholder="Rechercher..."></div><span class="card-sub">${c.rows.length} élément(s)</span></div><div class="table-wrap"><table><thead><tr>${c.heads.map(h=>`<th>${h}</th>`).join("")}<th></th></tr></thead><tbody>${c.rows.map((r,ri)=>`<tr data-search="${r.map(x=>String(x).replace(/<[^>]*>/g,"")).join(" ")}">${r.map((v,i)=>`<td>${i===0?`<div class="entity"><span class="entity-icon">${String(v).charAt(0)}</span><strong>${v}</strong></div>`:v}</td>`).join("")}<td class="row-actions">${actions(kind,c.ids[ri])}</td></tr>`).join("")||`<tr><td colspan="${c.heads.length+1}" class="empty">Aucune donnée</td></tr>`}</tbody></table></div></div>`)
}

function invoices(){return shell("Factures mensuelles","Générez les appels de loyer de tous les logements occupés.",`<button class="btn secondary" data-action="invoice-run">Émettre ce mois</button>`,`<div class="card table-card"><div class="toolbar"><strong>${state.invoices.length} facture(s)</strong><span class="card-sub">Période actuelle : ${monthKey}</span></div><div class="table-wrap"><table><thead><tr><th>N°</th><th>Locataire</th><th>Logement</th><th>Période</th><th>Montant</th><th>Statut</th><th></th></tr></thead><tbody>${state.invoices.map(i=>`<tr><td><strong>${i.number}</strong></td><td>${tenant(i.tenantId)?.name||"—"}</td><td>${unit(i.unitId)?.name||"—"}</td><td>${i.month}</td><td>${FCFA.format(i.amount)}</td><td>${badge(paid(i.tenantId,i.month)>=i.amount?"Payée":"À payer")}</td><td><button class="btn small secondary" data-action="invoice-print" data-id="${i.id}">Imprimer</button>${actions("invoices",i.id,false)}</td></tr>`).join("")||`<tr><td colspan="7" class="empty">Aucune facture. Cliquez sur « Émettre ce mois ».</td></tr>`}</tbody></table></div></div>`)}

const inspectionItems=["Porte, serrure et poignée","Murs et plafond","Sol et plinthes","Fenêtres et vitrages","Prises et interrupteurs","Points lumineux","Placards intégrés","Plomberie et évacuations","Sanitaires","Propreté générale"];
function inspections(){return shell("États des lieux","Créez, signez et imprimez les constats d'entrée ou de sortie.",`<button class="btn primary" data-action="inspection-add">+ Nouvel état des lieux</button>`,`<div class="card table-card"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Logement</th><th>Locataire</th><th>État</th><th></th></tr></thead><tbody>${state.inspections.map(i=>`<tr><td>${new Date(i.date).toLocaleDateString("fr-FR")}</td><td>${badge(i.type)}</td><td>${unit(i.unitId)?.name||"—"}</td><td>${tenant(i.tenantId)?.name||"—"}</td><td>${badge(i.signed?"Signé":"Brouillon")}</td><td><button class="btn small secondary" data-action="inspection-print" data-id="${i.id}">Imprimer</button>${actions("inspections",i.id,false)}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">Aucun état des lieux enregistré.</td></tr>`}</tbody></table></div></div>`)}

function reports(){const exp=expected(),col=collected(),cost=state.maintenance.reduce((s,m)=>s+Number(m.cost||0),0);return shell("Rapports et insights","Les indicateurs utiles pour décider rapidement.",`<button class="btn secondary" data-action="report-print">Imprimer le rapport</button>`,`<div class="report-grid"><div class="report-tile"><span>Taux de recouvrement</span><strong>${exp?Math.round(col/exp*100):0}%</strong><div class="progress"><span style="width:${exp?col/exp*100:0}%"></span></div></div><div class="report-tile"><span>Revenu net estimé</span><strong>${FCFA.format(col-cost)}</strong><small>Encaissements moins travaux</small></div><div class="report-tile"><span>Coût des travaux</span><strong>${FCFA.format(cost)}</strong><small>${state.maintenance.length} interventions</small></div></div><div class="card" style="margin-top:18px"><h3>Performance par propriété</h3><div class="table-wrap"><table><thead><tr><th>Propriété</th><th>Unités</th><th>Occupées</th><th>Revenus attendus</th><th>Taux d'occupation</th></tr></thead><tbody>${state.properties.map(p=>{const us=state.units.filter(u=>u.propertyId===p.id),occ=us.filter(u=>u.status==="occupied");return `<tr><td><strong>${p.name}</strong></td><td>${us.length}</td><td>${occ.length}</td><td>${FCFA.format(occ.reduce((s,u)=>s+u.rent,0))}</td><td>${us.length?Math.round(occ.length/us.length*100):0}%</td></tr>`}).join("")}</tbody></table></div></div>`)}

function render(){$("#pageTitle").textContent=titles[currentView];app.innerHTML=currentView==="dashboard"?dashboard():currentView==="properties"?properties():["units","tenants","payments","maintenance"].includes(currentView)?tablePage(currentView):currentView==="invoices"?invoices():currentView==="inspections"?inspections():currentView==="settings"?settingsView():reports();$("#searchInput")?.addEventListener("input",e=>searchRows(e.target.value));bindExtras()}

function fields(list,v={}){return `<div class="form-grid">${list.map(f=>{const val=v[f.name]??f.value??"";return `<div class="field ${f.full?"full":""}"><label>${f.label}</label>${f.type==="select"?`<select name="${f.name}" ${f.required?"required":""}>${f.options.map(o=>`<option value="${o.value}" ${String(o.value)===String(val)?"selected":""}>${o.label}</option>`).join("")}</select>`:f.type==="textarea"?`<textarea name="${f.name}">${val}</textarea>`:`<input name="${f.name}" type="${f.type||"text"}" value="${val}" ${f.type==="number"?`min="${f.min??0}" step="1"`:""} ${f.required?"required":""}>`}</div>`}).join("")}</div>`}
function openModal(title,html,onSubmit){$("#modalTitle").textContent=title;$("#modalBody").innerHTML=html;$("#modalBackdrop").hidden=false;$("#modalForm").onsubmit=e=>{e.preventDefault();onSubmit(san(Object.fromEntries(new FormData(e.target))));closeModal()}}
function closeModal(){$("#modalBackdrop").hidden=true;$("#modalForm").reset()}
const opts=(arr,label,v="id")=>arr.map(x=>({value:x[v],label:label(x)}));
const strs=a=>a.map(x=>({value:x,label:x}));
const actions=(kind,id,edit=true)=>`${kind==="payments"?`<button class="btn small secondary" data-action="receipt-print" data-id="${id}">Reçu</button>`:""}${edit?`<button class="btn small secondary" data-action="edit" data-kind="${kind}" data-id="${id}">Modifier</button>`:""}<button class="btn small danger" data-action="delete" data-kind="${kind}" data-id="${id}">Supprimer</button>`;
function save(coll,item,d,prefix){if(item)Object.assign(item,d);else state[coll].push({id:uid(prefix),...d});persist();render()}
function del(kind,id){const it=state[kind].find(x=>x.id===id);if(!it)return;
  if(kind==="properties"&&state.units.some(u=>u.propertyId===id))return toast("Supprimez d'abord les logements de cette propriété");
  if(kind==="units"&&it.tenantId)return toast("Ce logement a un locataire : retirez-le d'abord");
  if(!confirm("Supprimer définitivement cet élément ?"))return;
  if(kind==="tenants"){const u=unit(it.unitId);if(u&&u.tenantId===id){u.tenantId=null;u.status="vacant"}}
  state[kind]=state[kind].filter(x=>x.id!==id);persist("Élément supprimé");render()}
function addProperty(it){openModal(it?"Modifier la propriété":"Ajouter une propriété",fields([{name:"name",label:"Nom de la propriété",required:true},{name:"district",label:"Quartier",required:true},{name:"type",label:"Type",type:"select",options:strs(["Immeuble","Villa","Maison","Local commercial"])}],it),d=>save("properties",it,d,"p"))}
function addUnit(it){if(!state.properties.length)return toast("Ajoutez d'abord une propriété");openModal(it?"Modifier le logement":"Ajouter un logement",fields([{name:"name",label:"Nom / référence",required:true},{name:"propertyId",label:"Propriété",type:"select",options:opts(state.properties,x=>x.name)},{name:"type",label:"Type",type:"select",options:strs(["Studio","Appartement","Villa","Boutique","Bureau"])},{name:"rent",label:"Loyer mensuel FCFA",type:"number",min:1,required:true},...(it&&it.tenantId?[]:[{name:"status",label:"Statut",type:"select",options:[{value:"vacant",label:"Vacant"},{value:"works",label:"En travaux"}]}])],it),d=>save("units",it,{...d,rent:Number(d.rent),...(it?{}:{tenantId:null})},"u"))}
function addTenant(it){const av=state.units.filter(u=>!u.tenantId||(it&&u.id===it.unitId));if(!av.length)return toast("Aucun logement disponible : ajoutez un logement vacant");openModal(it?"Modifier le locataire":"Ajouter un locataire",fields([{name:"name",label:"Nom complet",required:true},{name:"phone",label:"Téléphone",required:true},{name:"email",label:"E-mail",type:"email"},{name:"unitId",label:"Logement",type:"select",options:opts(av,x=>`${x.name} · ${FCFA.format(x.rent)}`)},{name:"start",label:"Date d'entrée",type:"date",required:true}],it),d=>{
  if(it){const old=unit(it.unitId);if(old&&old.id!==d.unitId){old.tenantId=null;old.status="vacant"}Object.assign(it,d)}else state.tenants.push({id:uid("t"),...d});
  const t=it||state.tenants.at(-1),u=unit(d.unitId);if(u){u.tenantId=t.id;u.status="occupied"}persist();render()})}
function addPayment(it){if(!state.tenants.length)return toast("Ajoutez d'abord un locataire");openModal(it?"Modifier le paiement":"Enregistrer un paiement",fields([{name:"tenantId",label:"Locataire",type:"select",options:opts(state.tenants,t=>`${t.name} · ${unit(t.unitId)?.name||""}`)},{name:"month",label:"Période",type:"month",value:monthKey,required:true},{name:"amount",label:"Montant FCFA",type:"number",min:1,required:true},{name:"date",label:"Date",type:"date",value:new Date().toISOString().slice(0,10),required:true},{name:"method",label:"Mode de paiement",type:"select",options:strs(["Airtel Money","Moov Money","Virement","Espèces","Chèque"])}],it),d=>save("payments",it,{...d,unitId:tenant(d.tenantId).unitId,amount:Number(d.amount)},"pay"))}
function addMaintenance(it){if(!state.units.length)return toast("Ajoutez d'abord un logement");openModal(it?"Modifier les travaux":"Déclarer des travaux",fields([{name:"title",label:"Intervention",required:true,full:true},{name:"unitId",label:"Logement",type:"select",options:opts(state.units,u=>`${u.name} · ${property(u.propertyId)?.name}`)},{name:"category",label:"Catégorie",type:"select",options:strs(["Plomberie","Électricité","Peinture","Serrurerie","Climatisation","Autre"])},{name:"priority",label:"Priorité",type:"select",options:strs(["Faible","Moyenne","Haute","Urgente"])},{name:"cost",label:"Coût estimé FCFA",type:"number"},{name:"status",label:"Statut",type:"select",options:strs(["Signalé","Devis demandé","Planifié","En cours","Terminé"])}],it),d=>save("maintenance",it,{...d,cost:Number(d.cost||0),...(it?{}:{date:new Date().toISOString().slice(0,10)})},"m"))}
function issueInvoices(){let created=0;state.units.filter(u=>u.status==="occupied"&&u.tenantId).forEach(u=>{if(!state.invoices.some(i=>i.unitId===u.id&&i.month===monthKey)){state.invoices.push({id:uid("inv"),number:`FAC-${monthKey.replace("-","")}-${String(1+Math.max(0,...state.invoices.filter(x=>x.month===monthKey).map(x=>Number(x.number.split("-")[2])||0))).padStart(3,"0")}`,unitId:u.id,tenantId:u.tenantId,month:monthKey,amount:u.rent,date:new Date().toISOString().slice(0,10)});created++}});persist(`${created} facture(s) générée(s)`);currentView="invoices";activateNav();render()}
function addInspection(){const initial=inspectionItems.map(x=>({item:x,state:"Bon",note:""}));const html=fields([{name:"unitId",label:"Logement",type:"select",options:opts(state.units,u=>`${u.name} · ${property(u.propertyId)?.name}`)},{name:"type",label:"Type",type:"select",options:[{value:"Entrée",label:"État des lieux d'entrée"},{value:"Sortie",label:"État des lieux de sortie"}]},{name:"date",label:"Date",type:"date",value:new Date().toISOString().slice(0,10),required:true},{name:"keys",label:"Nombre de clés",type:"number"}])+`<div class="field full" style="margin-top:16px"><label>Observations générales</label><textarea name="notes"></textarea></div><label style="display:block;margin:16px 0 6px;font-weight:800">Éléments essentiels</label><div class="inspection-list">${initial.map((r,i)=>`<div class="inspection-row"><strong>${r.item}</strong><select name="state_${i}"><option>Bon</option><option>Moyen</option><option>Mauvais</option><option>N/A</option></select><input name="note_${i}" placeholder="Observation"></div>`).join("")}</div><label style="display:flex;gap:8px;margin-top:14px"><input type="checkbox" name="signed"> Signatures du bailleur et du locataire recueillies</label>`;openModal("Nouvel état des lieux",html,d=>{const u=unit(d.unitId);state.inspections.push({id:uid("ins"),unitId:d.unitId,tenantId:u?.tenantId,type:d.type,date:d.date,keys:d.keys,notes:d.notes,signed:d.signed==="on",items:inspectionItems.map((item,i)=>({item,state:d[`state_${i}`],note:d[`note_${i}`]}))});persist();render()})}

function printDocument(title,body){const w=window.open("","_blank");if(!w)return toast("Autorisez les fenêtres pop-up pour imprimer");w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:14px Arial;margin:36px;color:#173033}header{border-bottom:3px solid #0f3d3e;padding-bottom:15px;margin-bottom:24px}h1{margin:0}table{border-collapse:collapse;width:100%;margin:18px 0}th,td{border:1px solid #bbb;padding:9px;text-align:left}th{background:#eee}.total{font-size:20px;text-align:right}.sign{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:60px;text-align:center}@media print{button{display:none}}</style></head><body><header><h1>${state.settings.company||state.settings.ownerName}</h1><p>${state.settings.phone}</p><p><strong>${title}</strong></p></header>${body}<button onclick="print()">Imprimer</button></body></html>`);w.document.close()}
function printInvoice(id){const i=state.invoices.find(x=>x.id===id),t=tenant(i.tenantId),u=unit(i.unitId),p=property(u.propertyId);printDocument(`Facture ${i.number}`,`<p><strong>Date :</strong> ${new Date(i.date).toLocaleDateString("fr-FR")}</p><p><strong>Locataire :</strong> ${t.name}<br>${t.phone}</p><p><strong>Bien :</strong> ${p.name}, ${p.district}<br><strong>Logement :</strong> ${u.name}</p><table><tr><th>Désignation</th><th>Période</th><th>Montant</th></tr><tr><td>Loyer mensuel</td><td>${i.month}</td><td>${FCFA.format(i.amount)}</td></tr></table><p class="total"><strong>Total à payer : ${FCFA.format(i.amount)}</strong></p><p>Facture générée électroniquement par GestiLoc Libreville.</p>`)}
function printInspection(id){const i=state.inspections.find(x=>x.id===id),u=unit(i.unitId),t=tenant(i.tenantId),p=property(u.propertyId);printDocument(`État des lieux de ${i.type.toLowerCase()}`,`<p><strong>Date :</strong> ${new Date(i.date).toLocaleDateString("fr-FR")}<br><strong>Propriété :</strong> ${p?.name||""}<br><strong>Logement :</strong> ${u?.name||""}<br><strong>Locataire :</strong> ${t?.name||"Non attribué"}<br><strong>Clés remises :</strong> ${i.keys||"—"}</p><table><tr><th>Élément</th><th>État</th><th>Observations</th></tr>${i.items.map(x=>`<tr><td>${x.item}</td><td>${x.state}</td><td>${x.note||""}</td></tr>`).join("")}</table><p><strong>Observations générales :</strong> ${i.notes||"Aucune"}</p><div class="sign"><div>Signature du bailleur<br><br><br>________________</div><div>Signature du locataire<br><br><br>________________</div></div>`)}

function printReceipt(id){const p=state.payments.find(x=>x.id===id),t=tenant(p.tenantId),u=unit(p.unitId),pr=property(u?.propertyId);const settled=u&&paid(p.tenantId,p.month)>=u.rent;printDocument(`${settled?"Quittance de loyer":"Reçu de paiement"} ${p.month}`,`<p>Je soussigné(e) <strong>${state.settings.ownerName}</strong>, propriétaire, reconnais avoir reçu de <strong>${t?.name||"—"}</strong> la somme de <strong>${FCFA.format(p.amount)}</strong> au titre du loyer de la période <strong>${p.month}</strong>, logement <strong>${u?.name||"—"}</strong> (${pr?.name||""}).</p><p>Mode de paiement : ${p.method} · Date : ${new Date(p.date).toLocaleDateString("fr-FR")}</p>${settled?"":`<p>Ce reçu correspond à un versement partiel ; solde actuel : ${FCFA.format(Math.max((u?.rent||0)-paid(p.tenantId,p.month),0))}.</p>`}<div class="sign"><div>Le bailleur<br><br><br>________________</div><div></div></div>`)}
function activateNav(){document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===currentView))}
document.addEventListener("click",e=>{const v=e.target.closest("[data-view]");if(v){currentView=v.dataset.view;activateNav();render();$("#sidebar").classList.remove("open")}const a=e.target.closest("[data-action]");if(!a)return;({"property-add":addProperty,"unit-add":addUnit,"tenant-add":addTenant,"payment-add":addPayment,"maintenance-add":addMaintenance,"invoice-run":issueInvoices,"inspection-add":addInspection,"report-print":()=>window.print()}[a.dataset.action]||(()=>{}))();if(a.dataset.action==="invoice-print")printInvoice(a.dataset.id);if(a.dataset.action==="inspection-print")printInspection(a.dataset.id);
const {action:ac,kind,id}=a.dataset;
if(ac==="edit")({properties:addProperty,units:addUnit,tenants:addTenant,payments:addPayment,maintenance:addMaintenance})[kind]?.(state[kind].find(x=>x.id===id));
if(ac==="delete")del(kind,id);
if(ac==="receipt-print")printReceipt(id);
if(ac==="connect")showLogin();
if(ac==="export"){const l=document.createElement("a");l.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:"application/json"}));l.download=`gestiloc-${monthKey}.json`;l.click()}
if(ac==="load-demo"&&confirm("Remplacer les données de cet espace par une démonstration ?")){state=normalize({...structuredClone(seed),settings:state.settings});persist("Démonstration chargée");render()}
if(ac==="clear-data"&&confirm("Effacer définitivement toutes les données de cet espace ? Exportez-les d’abord si vous souhaitez les conserver.")){state=normalize({settings:state.settings});persist("Données effacées");render()}
if(ac==="logout"){clearTimeout(saveTimer);SESSION.removeItem("gestiloc-code");LS.removeItem("gestiloc-mode");location.reload()}
});
document.querySelectorAll(".nav-parent").forEach(b=>b.onclick=()=>b.parentElement.classList.toggle("open"));
$("#menuToggle").onclick=()=>$("#sidebar").classList.add("open");$("#sidebarClose").onclick=()=>$("#sidebar").classList.remove("open");$("#modalClose").onclick=$("#modalCancel").onclick=closeModal;$("#modalBackdrop").onclick=e=>{if(e.target===e.currentTarget)closeModal()};$("#syncBtn").onclick=()=>syncToCloud(true);
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
function settingsView(){return shell("Paramètres","Identité, sauvegarde et sécurité.","",`<div class="card" style="padding:22px"><form id="settingsForm">${fields([{name:"ownerName",label:"Nom du propriétaire",required:true},{name:"company",label:"Nom affiché sur les documents"},{name:"phone",label:"Téléphone"},{name:"city",label:"Ville"}],state.settings)}<p><button class="btn primary" type="submit" style="margin-top:14px">Enregistrer</button></p></form></div><div class="card" style="padding:22px;margin-top:18px"><h3>Données et accès</h3><p class="card-sub">Les données de démonstration remplacent les données de l’espace actif.</p><div class="actions"><button class="btn secondary" data-action="export">Exporter (JSON)</button><label class="btn secondary" style="cursor:pointer">Importer<input type="file" id="importFile" accept="application/json" hidden></label>${SESSION.getItem("gestiloc-code")?"":`<button class="btn secondary" data-action="connect">Se connecter à un espace</button>`}<button class="btn secondary" data-action="load-demo">Charger une démonstration</button><button class="btn danger" data-action="clear-data">Effacer toutes les données</button><button class="btn secondary" data-action="logout">Se déconnecter</button></div></div>`)}
function updateChip(){const n=state.settings.ownerName||"P";$("#ownerChip").innerHTML=`<span>${n.split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span><div><strong>${n}</strong><small>${state.settings.city}</small></div>`}
function bindExtras(){
  updateChip();
  $("#settingsForm")?.addEventListener("submit",e=>{e.preventDefault();state.settings={...state.settings,...san(Object.fromEntries(new FormData(e.target)))};persist();updateChip()});
  $("#importFile")?.addEventListener("change",async e=>{try{state=normalize(JSON.parse(await e.target.files[0].text()));persist("Données importées");render()}catch{toast("Fichier invalide")}});
}
function showLogin(error=""){$("#loginErr").textContent=error;$("#loginErr").hidden=!error;$("#login").hidden=false;$("#loginCode").focus()}
async function connect(code){
  clearTimeout(saveTimer);
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(code));
  activeStore=`gestiloc-${Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("")}`;
  SESSION.setItem("gestiloc-code",code);
  state=loadState();render();$("#login").hidden=true;
  await syncFromCloud();
}
$("#loginForm").onsubmit=async e=>{e.preventDefault();await connect($("#loginCode").value.trim())};
$("#loginLocal").onclick=()=>{LS.setItem("gestiloc-mode","local");$("#login").hidden=true};
let deferredInstall;
addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("#installBtn").hidden=false});
$("#installBtn").onclick=async()=>{deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("#installBtn").hidden=true};
addEventListener("appinstalled",()=>$("#installBtn").hidden=true);
render();
if(SESSION.getItem("gestiloc-code"))connect(SESSION.getItem("gestiloc-code"));
else if(LS.getItem("gestiloc-mode")!=="local")showLogin();
