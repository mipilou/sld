import { getUser, login, signup, logout, handleAuthCallback, requestPasswordRecovery, acceptInvite, updateUser, getSettings } from "@netlify/identity";
import { inspectionItemsForUnit, roomTypes, roomEquipment, roomSummary, leaseHTML, inspectionHTML } from "./document-templates.js";

import { observationOptions, observationText } from "./inspection-observations.js";
import { deletionPlan } from "./cascade.js";
import { prepareImport, importSchemas } from "./import-schema.js";
import readExcelFile from "read-excel-file/browser";

const $ = (selector) => document.querySelector(selector);
const h = (value = "") => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const money = (value) => new Intl.NumberFormat("fr-FR", { style:"currency", currency:"XAF", maximumFractionDigits:0 }).format(Number(value) || 0);
const today = () => new Date().toLocaleDateString("sv-SE");
const monthKey = () => today().slice(0,7);
const dateFr = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR") : "—";
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const emptyState = () => ({ properties:[], units:[], tenants:[], payments:[], invoices:[], maintenance:[], inspections:[], settings:{ ownerName:"", company:"", phone:"", email:"", address:"", city:"Libreville", leaseClauses:"" } });
const normalize = (raw) => {
  const base = emptyState(), data = raw && typeof raw === "object" ? raw : {};
  for (const key of ["properties","units","tenants","payments","invoices","maintenance","inspections"]) base[key] = Array.isArray(data[key]) ? data[key] : [];
  base.settings = { ...base.settings, ...(data.settings && typeof data.settings === "object" ? data.settings : {}) };
  return base;
};
let state = emptyState(), rev = 0, currentView = "dashboard", selected = null, user = null;
let showArchived = false, currentFilter = "";
let dirty = false, currentFlush = null, syncTimer = null, authMode = "login", inviteToken = null, allowSignup = true;
const titles = {dashboard:"Vue d'ensemble",properties:"Propriétés",units:"Logements",tenants:"Locataires",leases:"Contrats de bail",payments:"Paiements",invoices:"Factures mensuelles",inspections:"États des lieux",maintenance:"Travaux",reports:"Rapports",settings:"Paramètres",imports:"Imports Excel"};
const property = (key) => state.properties.find(x => x.id === key);
const unit = (key) => state.units.find(x => x.id === key);
const tenant = (key) => state.tenants.find(x => x.id === key);
const paid = (tenantId, month = monthKey()) => state.payments.filter(p => p.tenantId === tenantId && p.month === month).reduce((sum,p) => sum + Number(p.amount || 0),0);
const activeUnits = () => state.units.filter(x => x.status === "occupied" && x.tenantId);
const isAdmin = () => Array.isArray(user?.roles) && user.roles.includes("admin");
const requireAdmin = () => { if (!isAdmin()) throw Error("Action réservée au compte administrateur."); };
const expected = () => activeUnits().reduce((sum,u) => sum + Number(u.rent || 0),0);
const collected = () => state.payments.filter(p => p.month === monthKey()).reduce((sum,p) => sum + Number(p.amount || 0),0);
function portfolioSnapshot() {
  const liveUnits=state.units.filter(u=>!property(u.propertyId)?.archived);
  const occupied=liveUnits.filter(u=>u.status==="occupied");
  const missingTenant=occupied.filter(u=>!u.tenantId);
  const month=monthKey(), todayDate=today(), limit=new Date(`${todayDate}T12:00:00`);
  limit.setDate(limit.getDate()+90);
  const endLimit=limit.toLocaleDateString("sv-SE");
  const due=occupied.map(u=>({u,t:tenant(u.tenantId)})).filter(x=>x.t&&x.t.start?.slice(0,7)<=month)
    .map(x=>({...x,rent:Number(state.invoices.find(i=>i.tenantId===x.t.id&&i.month===month)?.amount??x.u.rent??0),received:paid(x.t.id,month)}));
  const remaining=due.map(x=>({...x,balance:Math.max(0,x.rent-x.received)})).filter(x=>x.balance>0);
  const pastDue=state.invoices.filter(i=>i.month<month).map(i=>({...i,balance:Math.max(0,Number(i.amount||0)-paid(i.tenantId,i.month))})).filter(i=>i.balance>0);
  const leases=state.tenants.filter(t=>!t.end&&t.leaseEnd&&t.leaseEnd<=endLimit).sort((a,b)=>a.leaseEnd.localeCompare(b.leaseEnd));
  const missingEntry=state.tenants.filter(t=>!t.end&&!state.inspections.some(i=>i.tenantId===t.id&&i.type==="Entrée"&&i.finalizedAt));
  const monthPayments=state.payments.filter(p=>p.month===month);
  const byMethod=Object.entries(monthPayments.reduce((out,p)=>{const key=p.method||"Non renseigné";out[key]=(out[key]||0)+Number(p.amount||0);return out;},{})).sort((a,b)=>b[1]-a[1]);
  return {liveUnits,occupied,missingTenant,due,remaining,pastDue,leases,missingEntry,byMethod,received:monthPayments.reduce((n,p)=>n+Number(p.amount||0),0),expected:due.reduce((n,x)=>n+x.rent,0)};
}
const badge = (value) => `<span class="status ${/retard|impayé|urgent/i.test(value)?"bad":/payé|occupé|terminé|signé|actif/i.test(value)?"good":/partiel|travaux|cours|signalé|brouillon|à payer/i.test(value)?"warn":"info"}">${h(value)}</span>`;
const linked = (kind, key, label) => `<button class="link-button" type="button" data-open="${kind}" data-id="${h(key)}">${kind==="properties"?`<i class="property-dot" style="background:${propertyColor(property(key))}"></i>`:""}${h(label || "—")}</button>`;
const shell = (title, subtitle, actions = "", body = "") => `<div class="hero"><div><h2>${h(title)}</h2><p>${h(subtitle)}</p></div><div class="actions">${actions}</div></div>${body}`;
const empty = (message) => `<div class="card empty-state"><strong>${h(message)}</strong><p>Utilisez le bouton ci-dessus pour commencer.</p></div>`;
const actions = (kind, key, allowDelete = true) => isAdmin() ? `<button class="btn small secondary" data-action="edit" data-kind="${kind}" data-id="${h(key)}">Modifier</button>${allowDelete?`<button class="btn small danger" data-action="delete" data-kind="${kind}" data-id="${h(key)}">Supprimer</button>`:""}` : "";

function toast(message) { const box = $("#toast"); box.textContent = message; box.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => box.hidden = true, 4000); }
function setSync(label, online = false) { $("#syncLabel").textContent = label; $(".sync-dot").classList.toggle("online",online); }
function persist() { requireAdmin(); dirty = true; setSync("Enregistrement…"); clearTimeout(syncTimer); syncTimer = setTimeout(flush,450); render(); }
async function api(method, body) { return fetch("/api/state", { method, credentials:"same-origin", headers:{ "content-type":"application/json" }, body:body ? JSON.stringify(body) : undefined }); }
async function loadState() {
  const response = await api("GET");
  if (response.status === 401) { await requireLogin(); return false; }
  if (!response.ok) throw Error("Base de données indisponible. Vérifiez la configuration Netlify.");
  const data = await response.json(); state = normalize(data.payload); rev = Number(data.rev || 0); dirty = false;
  setSync("Synchronisé",true); render();
  if (isAdmin() && !state.settings.ownerName && user?.name) { state.settings.ownerName = user.name; persist(); }
  return true;
}
function flush() {
  if (currentFlush) return currentFlush;
  if (!dirty || !user) return Promise.resolve(!dirty);
  currentFlush = (async () => { let success = true;
  while (dirty) {
    dirty = false;
    const snapshot = structuredClone(state);
    try {
      const response = await api("PUT",{ payload:snapshot, baseRev:rev });
      if (response.status === 401) { await requireLogin(); success = false; break; }
      if (response.status === 409) {
        const latest = await api("GET"); const remote = await latest.json();
        if (confirm("Des modifications ont été enregistrées sur un autre appareil. OK pour conserver cette version et remplacer la version distante ; Annuler pour charger la version distante.")) {
          rev = Number(remote.rev); dirty = true; continue;
        }
        state = normalize(remote.payload); rev = Number(remote.rev); render(); toast("Version distante chargée"); success = false; break;
      }
      if (!response.ok) throw Error((await response.json().catch(()=>({}))).error || "Enregistrement impossible");
      rev = Number((await response.json()).rev);
      setSync(dirty ? "Enregistrement…" : "Synchronisé",!dirty);
    } catch (error) { dirty = true; setSync("Non enregistré"); toast(error.message || "Erreur de connexion"); success = false; break; }
  }
  return success && !dirty;
  })();
  return currentFlush.finally(() => { currentFlush = null; });
}

async function requireLogin() {
  user = null; state = emptyState(); rev = 0; dirty = false; clearTimeout(syncTimer);
  $("#appShell").hidden = true; $("#login").hidden = false; setAuthMode("login");
  allowSignup = false; setAuthMode("login");
}
function setAuthMode(mode) {
  authMode = mode; const signupMode = mode === "signup", reset = mode === "recover", special = mode === "invite" || mode === "new-password";
  $("#loginIntro").textContent = signupMode ? "Créez votre espace sécurisé." : reset ? "Recevez un lien pour réinitialiser votre mot de passe." : mode === "invite" ? "Définissez votre mot de passe pour accepter l'invitation." : mode === "new-password" ? "Choisissez un nouveau mot de passe." : "Connectez-vous pour accéder à votre patrimoine.";
  $("#loginNameWrap").hidden = !signupMode;
  $("#loginEmailWrap").hidden = special;
  $("#loginEmail").required = !special;
  $("#loginPasswordWrap").hidden = reset;
  $("#loginPassword").required = !reset;
  $("#loginPassword").autocomplete = signupMode || special ? "new-password" : "current-password";
  $("#loginSubmit").textContent = signupMode ? "Créer mon compte" : reset ? "Envoyer le lien" : special ? "Enregistrer le mot de passe" : "Se connecter";
  $("#signupBtn").hidden = mode !== "login" || !allowSignup; $("#recoverBtn").hidden = mode !== "login"; $("#backLoginBtn").hidden = mode === "login";
  $("#loginErr").hidden = true;
}
async function enterApp(nextUser) {
  if (!Array.isArray(nextUser?.roles) || !nextUser.roles.includes("admin")) {
    await logout(); await requireLogin();
    $("#loginErr").textContent = "Compte sans accès administrateur. Attribuez le rôle admin à cette adresse dans Netlify Identity, puis reconnectez-vous.";
    $("#loginErr").hidden = false;
    return;
  }
  user = nextUser; $("#login").hidden = true; $("#appShell").hidden = false;
  $("#ownerChip").title = user.email || "Compte";
  try { await loadState(); } catch (error) { setSync("Indisponible"); toast(error.message); }
}
async function initialize() {
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === "invite") { inviteToken = callback.token; setAuthMode("invite"); return; }
    if (callback?.type === "recovery") { setAuthMode("new-password"); return; }
    const current = callback?.user || await getUser();
    if (current) await enterApp(current);
    else { allowSignup = false; setAuthMode("login"); }
  } catch (error) { setAuthMode("login"); $("#loginErr").textContent = error.message || "Connexion impossible"; $("#loginErr").hidden = false; }
}
$("#loginForm").addEventListener("submit",async (event) => {
  event.preventDefault(); const button = $("#loginSubmit"); button.disabled = true;
  try {
    const email = $("#loginEmail").value.trim(), password = $("#loginPassword").value;
    if (authMode === "recover") { await requestPasswordRecovery(email); toast("Un lien de récupération a été envoyé si ce compte existe."); setAuthMode("login"); return; }
    if (authMode === "invite") { await enterApp(await acceptInvite(inviteToken,password)); inviteToken = null; return; }
    if (authMode === "new-password") { await updateUser({password}); await enterApp(await getUser()); return; }
    if (authMode === "signup") {
      const registered = await signup(email,password,{full_name:$("#loginName").value.trim()});
      if (registered.confirmedAt) await enterApp(registered);
      else { toast("Vérifiez votre e-mail pour confirmer le compte."); setAuthMode("login"); }
      return;
    }
    await enterApp(await login(email,password));
  } catch (error) { $("#loginErr").textContent = error.message || "Connexion impossible"; $("#loginErr").hidden = false; }
  finally { button.disabled = false; }
});
$("#signupBtn").onclick = () => setAuthMode("signup");
$("#recoverBtn").onclick = () => setAuthMode("recover");
$("#backLoginBtn").onclick = () => setAuthMode("login");

function navigate(view, key = null, filter = "") { currentView = view; selected = key; currentFilter = filter; $("#helpPanel").hidden=true; $("#helpBtn").setAttribute("aria-expanded","false"); $("#notificationsPanel").hidden=true; $("#notificationsBtn").setAttribute("aria-expanded","false"); render(); activateNav(); $("#sidebar").classList.remove("open"); window.scrollTo(0,0); }
function activateNav() { document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active",button.dataset.view === currentView)); }
function render() {
  $("#pageTitle").textContent = titles[currentView];
  const pages = { dashboard, properties, units, tenants, leases, payments, invoices, inspections, maintenance, reports, settings:settingsView,imports:importsView };
  $("#app").innerHTML = selected ? detail(currentView,selected) : pages[currentView]();
  if(currentFilter)$("#app").insertAdjacentHTML("afterbegin",`<div class="filter-banner">${h(filterLabels[currentFilter]||currentFilter)} <button class="link-button" data-view="${currentView}">Afficher tout</button></div>`);
  updateChip();
  renderNotifications();
  $("#searchInput")?.addEventListener("input",event => { const term = event.target.value.toLowerCase(); document.querySelectorAll("[data-search]").forEach(row => row.hidden = !row.dataset.search.toLowerCase().includes(term)); });
  $("#settingsForm")?.addEventListener("submit",event => { event.preventDefault(); state.settings = { ...state.settings, ...Object.fromEntries(new FormData(event.target)) }; persist(); toast("Paramètres enregistrés"); });
  $("#importFile")?.addEventListener("change",importData);
  $("#excelFile")?.addEventListener("change",previewExcelImport);
  $("#photoFiles")?.addEventListener("change",uploadPhotos);
  $("#cameraFile")?.addEventListener("change",uploadPhotos);
}
function updateChip() { const name = state.settings.ownerName || user?.email?.split("@")[0] || "Compte"; $("#ownerChip").innerHTML = `<span>${h(name.split(/\s+/).map(w => w[0]).join("").slice(0,2).toUpperCase())}</span><div><strong>${h(name)}</strong><small>${h(user?.email || "")}</small></div>`; }
function notifications() {
  const todayDate=today(), {due,pastDue,leases,missingEntry,missingTenant}=portfolioSnapshot(), alerts=[];
  const soon=new Date(`${todayDate}T12:00:00`);soon.setDate(soon.getDate()+7);
  const soonDate=soon.toLocaleDateString("sv-SE");
  const leaseSoon=new Date(`${todayDate}T12:00:00`);leaseSoon.setDate(leaseSoon.getDate()+30);
  const leaseSoonDate=leaseSoon.toLocaleDateString("sv-SE");
  for(const x of due){
    const balance=Math.max(0,x.rent-x.received);if(!balance)continue;
    const lastDay=new Date(Number(todayDate.slice(0,4)),Number(todayDate.slice(5,7)),0).getDate();
    const dueDate=state.invoices.find(i=>i.tenantId===x.t.id&&i.month===monthKey())?.dueDate||`${monthKey()}-${String(Math.min(Math.max(1,Number(x.t.dueDay)||1),lastDay)).padStart(2,"0")}`;
    if(dueDate<todayDate)alerts.push({kind:"Retard de paiement",message:`${x.t.name} · ${money(balance)} pour ${monthKey()} à percevoir`,view:"tenants",id:x.t.id});
    else if(dueDate<=soonDate)alerts.push({kind:"Loyer à venir",message:`${x.t.name} · échéance le ${dateFr(dueDate)} (${money(balance)})`,view:"tenants",id:x.t.id});
  }
  for(const invoice of pastDue)alerts.push({kind:"Loyer antérieur impayé",message:`${tenant(invoice.tenantId)?.name||"Locataire"} · ${invoice.month} · ${money(invoice.balance)} restant`,view:"tenants",id:invoice.tenantId});
  for(const u of missingTenant)alerts.push({kind:"Bail à créer",message:`${u.name} · logement indiqué occupé sans dossier locataire`,view:"units",id:u.id});
  for(const t of leases.filter(t=>t.leaseEnd<=leaseSoonDate))alerts.push({kind:t.leaseEnd<todayDate?"Bail arrivé à échéance":"Bail à échéance",message:`${t.name} · fin prévue le ${dateFr(t.leaseEnd)}`,view:"tenants",id:t.id});
  for(const t of missingEntry.filter(t=>t.start<=todayDate))alerts.push({kind:"Constat d’entrée à finaliser",message:`${t.name} · état d’entrée non signé`,view:"tenants",id:t.id});
  for(const i of state.inspections.filter(i=>i.type==="Sortie"&&!i.finalizedAt))alerts.push({kind:"Sortie à finaliser",message:`${tenant(i.tenantId)?.name||"Locataire"} · constat en brouillon`,view:"inspections",id:i.id});
  for(const m of state.maintenance.filter(m=>m.priority==="Urgente"&&m.status!=="Terminé"))alerts.push({kind:"Travaux urgents",message:`${m.title} · ${unit(m.unitId)?.name||"Logement"}`,view:"maintenance",id:m.id});
  return alerts.map(x=>({...x,key:JSON.stringify([x.kind,x.view,x.id||"",x.message])})).filter(x=>!(state.settings.readNotifications||[]).includes(x.key));
}
function renderNotifications() {
  const list=notifications();
  $("#notificationsCount").hidden=!list.length;
  $("#notificationsCount").textContent=list.length>99?"99+":String(list.length);
  $("#notificationsBtn").setAttribute("aria-label",`Notifications (${list.length})`);
  $("#notificationsPanel").innerHTML=`<h3>À suivre · ${list.length}</h3>${list.length?list.map(x=>`<button type="button" class="notification-row" data-notification="${h(x.key)}" data-open="${h(x.view)}" ${x.id?`data-id="${h(x.id)}"`:""}><strong>${h(x.kind)}</strong><span>${h(x.message)}</span></button>`).join(""):'<p class="muted">Aucun événement à signaler actuellement.</p>'}`;
}
function table(headers, rows) { return `<div class="card table-card"><div class="toolbar"><div class="search"><span>⌕</span><input id="searchInput" aria-label="Rechercher" placeholder="Rechercher dans la liste"></div><span class="card-sub">${rows.length} élément(s)</span></div><div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${h(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr data-search="${h(r.search)}">${r.cells.map(x=>`<td>${x}</td>`).join("")}</tr>`).join("")||`<tr><td class="empty" colspan="${headers.length}">Aucune donnée pour le moment.</td></tr>`}</tbody></table></div></div>`; }
function dashboard() {
  const {liveUnits,occupied,missingTenant,expected:due,received,remaining:late,leases,missingEntry}=portfolioSnapshot();
  return shell("Votre patrimoine",`Situation au ${dateFr(today())}`,`<button class="btn primary" data-view="properties">+ Ajouter une propriété</button>`,`<div class="kpi-grid">
    <button class="kpi" data-view="units" data-filter="occupied"><p>Logements occupés</p><strong>${occupied.length}/${liveUnits.length}</strong><small>${liveUnits.length?Math.round(occupied.length/liveUnits.length*100):0}% d'occupation</small></button>
    <button class="kpi" data-view="payments" data-filter="month"><p>Encaissements du mois</p><strong>${money(received)}</strong><small>Sur ${money(due)} attendus</small></button>
    <button class="kpi danger" data-view="tenants" data-filter="remaining"><p>Reste à percevoir</p><strong>${money(late.reduce((n,x)=>n+x.balance,0))}</strong><small>${late.length} dossier(s) à suivre</small></button>
    <button class="kpi warning" data-view="maintenance" data-filter="open"><p>Travaux ouverts</p><strong>${state.maintenance.filter(m=>m.status!=="Terminé").length}</strong></button>
  </div><div class="grid-2"><div class="card"><h3>Locataires et loyers du mois</h3>${late.length?late.map(x=>`<div class="quick-row">${linked("tenants",x.t?.id,x.t?.name)}<span>${money(x.balance)} à percevoir</span></div>`).join(""):`<p class="muted">${occupied.length?"Aucun solde à percevoir.":"Ajoutez un logement et un locataire pour commencer."}</p>`}</div><div class="card"><h3>Points à suivre</h3><div class="followup-links"><button data-view="leases" data-filter="expiring">${leases.length} bail(s) expiré(s) ou à échéance sous 90 jours <span>→</span></button><button data-view="units" data-filter="missingTenant">${missingTenant.length} logement(s) occupé(s) sans bail <span>→</span></button><button data-view="inspections" data-filter="missingEntry">${missingEntry.length} état(s) d’entrée non signé(s) <span>→</span></button><button data-view="inspections" data-filter="drafts">${state.inspections.filter(i=>!i.finalizedAt).length} constat(s) en brouillon <span>→</span></button></div><div class="quick-actions"><button class="btn secondary" data-view="reports">Ouvrir la vue globale</button><button class="btn secondary" data-action="payment-add">+ Paiement</button></div></div></div>`);
}
function properties() { const list=state.properties.filter(p=>!p.archived||showArchived);return shell("Propriétés","Vos biens immobiliers et leurs logements.",`<button class="btn primary" data-action="property-add">+ Propriété</button>${state.properties.some(p=>p.archived)?`<button class="btn secondary" data-action="property-archives">${showArchived?"Masquer les archives":"Voir les archives"}</button>`:""}`,list.length?`<div class="property-grid">${list.map(p=>{const units=state.units.filter(u=>u.propertyId===p.id),occ=units.filter(u=>u.status==="occupied");return `<article class="property-card" style="border-top:5px solid ${propertyColor(p)}"><div class="property-cover" style="background:${propertyColor(p)}">${p.photo?`<img src="${propertyPhotoUrl(p)}" alt="${h(p.name)}" loading="lazy">`:""}<span>${h(p.type)} ${p.archived?"· Archivé":""}</span>${badge(`${occ.length}/${units.length} occupés`)}</div><div class="property-card-body"><h3>${linked("properties",p.id,p.name)}</h3><p>📍 ${h(p.address||p.district||state.settings.city)}</p><div class="property-stats"><div><strong>${units.length}</strong><span>Logements</span></div><div><strong>${occ.length}</strong><span>Occupés</span></div><div><strong>${units.length-occ.length}</strong><span>Non occupés</span></div></div><p class="card-amount">${money(occ.reduce((n,u)=>n+Number(u.rent),0))} / mois</p>${actions("properties",p.id)}${p.archived?`<button class="btn small secondary" data-action="property-restore" data-id="${h(p.id)}">Restaurer</button>`:""}</div></article>`}).join("")}</div>`:empty("Aucune propriété enregistrée")); }
function units() { return shell("Logements","Cliquez sur un nom pour ouvrir le dossier.",`<button class="btn primary" data-action="unit-add">+ Logement</button>`,table(["Logement","Propriété","Type","Loyer","Statut","Locataire",""],filteredRecords("units").filter(u=>!property(u.propertyId)?.archived).map(u=>({search:`${u.name} ${property(u.propertyId)?.name} ${tenant(u.tenantId)?.name}`,cells:[linked("units",u.id,u.name),linked("properties",u.propertyId,property(u.propertyId)?.name),h(u.type),money(u.rent),badge(u.status==="occupied"?"Occupé":u.status==="works"?"En travaux":"Vacant"),u.tenantId?linked("tenants",u.tenantId,tenant(u.tenantId)?.name):"—",actions("units",u.id)]})))); }
function tenants() { return shell("Locataires","Du bail d'entrée à la sortie du logement.",`<button class="btn primary" data-action="tenant-add">+ Locataire</button>`,table(["Locataire","Téléphone","Logement","Entrée","Sortie","Situation",""],filteredRecords("tenants").map(t=>({search:`${t.name} ${t.phone} ${unit(t.unitId)?.name}`,cells:[linked("tenants",t.id,t.name),h(t.phone),linked("units",t.unitId,unit(t.unitId)?.name),dateFr(t.start),dateFr(t.end),badge(t.end?"Sorti":paid(t.id)>=Number(unit(t.unitId)?.rent||0)?"Payé":paid(t.id)>0?"Partiel":"À suivre"),actions("tenants",t.id,false)]})))); }
function leases() { return shell("Contrats de bail","Contrats préremplis à partir des dossiers locataires.","",table(["Locataire","Logement","Entrée","Fin prévue","Loyer","Contrat"],filteredRecords("tenants").map(t=>({search:`${t.name} ${unit(t.unitId)?.name}`,cells:[linked("tenants",t.id,t.name),linked("units",t.unitId,unit(t.unitId)?.name),dateFr(t.start),dateFr(t.leaseEnd),money(unit(t.unitId)?.rent),`<button class="btn small secondary" data-action="lease-print" data-id="${h(t.id)}">Afficher / imprimer</button><button class="btn small secondary" data-action="lease-complete" data-id="${h(t.id)}">Compléter le bail</button>`]})))); }
function payments() { return shell("Paiements","Historique des règlements avec leur mode et référence.",`<button class="btn primary" data-action="payment-add">+ Paiement</button>`,table(["Date","Locataire","Logement","Période","Montant","Mode / référence",""],[...filteredRecords("payments")].sort((a,b)=>b.date.localeCompare(a.date)).map(p=>({search:`${tenant(p.tenantId)?.name} ${p.method} ${p.reference||""}`,cells:[dateFr(p.date),linked("tenants",p.tenantId,tenant(p.tenantId)?.name),linked("units",p.unitId,unit(p.unitId)?.name),h(p.month),money(p.amount),`${h(p.method)}${p.reference?`<br><small>${h(p.reference)}</small>`:""}`,`<button class="btn small secondary" data-action="receipt-print" data-id="${h(p.id)}">Reçu</button>${actions("payments",p.id)}`]})))); }
function invoices() { return shell("Factures mensuelles","Émettez une facture par logement occupé et par mois.",`<button class="btn primary" data-action="invoice-run">Émettre ce mois</button>`,table(["N°","Locataire","Logement","Période","Montant","Statut",""],state.invoices.map(i=>({search:`${i.number} ${tenant(i.tenantId)?.name}`,cells:[h(i.number),linked("tenants",i.tenantId,tenant(i.tenantId)?.name),linked("units",i.unitId,unit(i.unitId)?.name),h(i.month),money(i.amount),badge(paid(i.tenantId,i.month)>=i.amount?"Payée":paid(i.tenantId,i.month)>0?"Partielle":`${i.month<monthKey()?"En retard":"À payer"}`),`<button class="btn small secondary" data-action="invoice-print" data-id="${h(i.id)}">Imprimer</button>${forceButton("invoices",i.id)}`]})))); }
function inspections() { if(currentFilter==="missingEntry")return missingEntryView(); return shell("États des lieux","Constats d'entrée et de sortie avec photos et signatures.",`<button class="btn primary" data-action="inspection-add" data-type="Entrée">+ Entrée</button><button class="btn secondary" data-action="inspection-add" data-type="Sortie">+ Sortie</button>`,table(["Date","Type","Locataire","Logement","Statut",""],filteredRecords("inspections").map(i=>({search:`${tenant(i.tenantId)?.name} ${unit(i.unitId)?.name} ${i.type}`,cells:[dateFr(i.date),h(i.type),linked("tenants",i.tenantId,tenant(i.tenantId)?.name),linked("units",i.unitId,unit(i.unitId)?.name),badge(i.finalizedAt?"Signé":"Brouillon"),`<button class="btn small secondary" data-open="inspections" data-id="${h(i.id)}">Ouvrir</button>`]})))); }
function maintenance() { return shell("Travaux","Incidents, interventions et dépenses.",`<button class="btn primary" data-action="maintenance-add">+ Intervention</button>`,table(["Intervention","Logement","Priorité","Coût","Statut",""],filteredRecords("maintenance").map(m=>({search:`${m.title} ${unit(m.unitId)?.name}`,cells:[linked("maintenance",m.id,m.title),linked("units",m.unitId,unit(m.unitId)?.name),badge(m.priority),money(m.cost),badge(m.status),actions("maintenance",m.id)]})))); }
function donut(title,parts,center,format=value=>String(value)) {
  const colors=["#176a61","#e9b949","#739ca8","#b76a5b","#8b77a0","#6d8a50"];
  const values=parts.map(([label,value])=>[label,Math.max(0,Number(value)||0)]),total=values.reduce((n,[,value])=>n+value,0);
  let start=0;const segments=values.map(([,value],index)=>({value,index})).filter(x=>x.value>0).map(({value,index})=>{const end=start+value/total*100;const slice=`${colors[index%colors.length]} ${start.toFixed(3)}% ${end.toFixed(3)}%`;start=end;return slice;});
  const background=total?`conic-gradient(${segments.join(",")})`:"#e9efee";
  return `<div class="card chart-card"><h3>${h(title)}</h3><div class="donut-layout"><div class="donut" role="img" aria-label="${h(title)} : ${h(values.map(([label,value])=>`${label} ${format(value)}`).join(", "))}" style="background:${background}"><span>${h(total?center:"Aucune donnée")}</span></div><div class="donut-legend">${values.map(([label,value],index)=>`<div><i style="background:${colors[index%colors.length]}"></i><span>${h(label)}</span><strong>${h(format(value))}</strong></div>`).join("")}</div></div></div>`;
}
function reports() {
  const snap=portfolioSnapshot(),cost=state.maintenance.filter(m=>m.date?.startsWith(monthKey())).reduce((n,m)=>n+Number(m.cost||0),0);
  const openWorks=state.maintenance.filter(m=>m.status!=="Terminé"), pending=state.inspections.filter(i=>!i.finalizedAt);
  const month=new Date(`${monthKey()}-01T12:00:00`);
  const history=Array.from({length:6},(_,index)=>{const d=new Date(month);d.setMonth(d.getMonth()-(5-index));const key=d.toLocaleDateString("sv-SE").slice(0,7);return {key,amount:state.payments.filter(p=>p.month===key).reduce((n,p)=>n+Number(p.amount||0),0)};});
  const max=Math.max(...history.map(x=>x.amount),1);
  return shell("Vue globale",`Données réelles au ${dateFr(today())} · loyers du mois ${monthKey()}.`,`<button class="btn secondary" data-action="report-print">Imprimer</button>`,
  `<div class="report-grid">
    <div class="report-tile"><span>Occupation</span><strong>${snap.occupied.length} / ${snap.liveUnits.length}</strong><span>${snap.liveUnits.length?Math.round(snap.occupied.length/snap.liveUnits.length*100):0}% occupés · ${snap.liveUnits.filter(u=>u.status==="vacant").length} vacants · ${snap.liveUnits.filter(u=>u.status==="works").length} en travaux · ${snap.missingTenant.length} bail(s) à créer</span></div>
    <div class="report-tile"><span>Loyers attendus / encaissés</span><strong>${money(snap.expected)}</strong><span>${money(snap.received)} encaissés ce mois</span></div>
    <div class="report-tile"><span>Reste à percevoir</span><strong>${money(snap.remaining.reduce((n,x)=>n+x.balance,0))}</strong><span>${snap.remaining.length} dossier(s) ce mois · ${money(snap.pastDue.reduce((n,x)=>n+x.balance,0))} d'anciennes factures impayées</span></div>
    <div class="report-tile"><span>Taux de recouvrement</span><strong>${snap.expected?Math.round(Math.min(snap.received/snap.expected,1)*100):0}%</strong><span>${snap.expected?"Encaissements / loyers attendus":"Aucun loyer attendu ce mois"}</span></div>
    <div class="report-tile"><span>Baux à échéance sous 90 jours</span><strong>${snap.leases.length}</strong><span>Y compris les échéances déjà dépassées</span></div>
    <div class="report-tile"><span>Suivi opérationnel</span><strong>${openWorks.length} travaux</strong><span>${pending.length} constat(s) brouillon · ${snap.missingEntry.length} entrée(s) non signée(s)</span></div>
  </div><div class="chart-grid spaced">${donut("Statut des logements",[["Occupés",snap.occupied.length],["Vacants",snap.liveUnits.filter(u=>u.status==="vacant").length],["En travaux",snap.liveUnits.filter(u=>u.status==="works").length]],`${snap.liveUnits.length} logements`)}
  ${donut("Modes d'encaissement du mois",snap.byMethod,"Paiements",money)}
  ${donut("États des lieux",[["Signés",state.inspections.length-pending.length],["Brouillons",pending.length]],`${state.inspections.length} constats`)}</div>
  <div class="grid-2 spaced"><div class="card"><h3>Encaissements des six derniers mois</h3><div class="bar-chart">${history.map(x=>`<div class="bar-wrap" title="${h(x.key)} : ${money(x.amount)}"><span>${money(x.amount)}</span><div class="bar" style="height:${Math.max(4,Math.round(x.amount/max*145))}px"></div><span>${h(x.key.slice(5))}</span></div>`).join("")}</div></div>
  <div class="card"><h3>Modes d'encaissement · mois courant</h3>${snap.byMethod.length?snap.byMethod.map(([method,amount])=>`<div class="quick-row"><span>${h(method)}</span><strong>${money(amount)}</strong></div>`).join(""):'<p class="muted">Aucun paiement enregistré ce mois.</p>'}<p class="muted">Travaux enregistrés ce mois : ${money(cost)}.</p></div></div>
  <div class="grid-2 spaced"><div class="card"><h3>Soldes à percevoir</h3>${snap.remaining.length?snap.remaining.map(x=>`<div class="quick-row">${linked("tenants",x.t.id,x.t.name)}<strong>${money(x.balance)} · ce mois</strong></div>`).join(""):'<p class="muted">Aucun solde connu ce mois.</p>'}${snap.pastDue.map(x=>`<div class="quick-row">${linked("tenants",x.tenantId,tenant(x.tenantId)?.name)}<strong>${money(x.balance)} · ${h(x.month)}</strong></div>`).join("")}</div>
  <div class="card"><h3>Échéances des baux</h3>${snap.leases.length?snap.leases.map(t=>`<div class="quick-row">${linked("tenants",t.id,t.name)}<span>${dateFr(t.leaseEnd)}</span></div>`).join(""):'<p class="muted">Aucune échéance connue sous 90 jours.</p>'}</div></div>
  <div class="grid-2 spaced"><div class="card"><h3>États d'entrée à signer</h3>${snap.missingEntry.length?snap.missingEntry.map(t=>`<div class="quick-row">${linked("tenants",t.id,t.name)}<span>${dateFr(t.start)}</span></div>`).join(""):'<p class="muted">Aucun dossier à signaler.</p>'}</div><div class="card"><h3>Travaux ouverts</h3>${openWorks.length?openWorks.map(m=>`<div class="quick-row"><span>${h(m.title)} · ${linked("units",m.unitId,unit(m.unitId)?.name)}</span>${badge(m.status)}</div>`).join(""):'<p class="muted">Aucun travail ouvert.</p>'}</div></div>
  <div class="card spaced"><h3>Situation par propriété</h3>${table(["Propriété","Logements","Occupés","Loyers théoriques mensuels"],state.properties.filter(p=>!p.archived).map(p=>{const all=snap.liveUnits.filter(u=>u.propertyId===p.id),occ=all.filter(u=>u.status==="occupied");return {search:p.name,cells:[linked("properties",p.id,p.name),String(all.length),String(occ.length),money(occ.reduce((n,u)=>n+Number(u.rent||0),0))]}}))}</div>`);
}
function settingsView() { const s=state.settings; return shell("Paramètres","Coordonnées du bailleur, documents et sauvegardes.","",`<div class="card"><form id="settingsForm">${fields([{name:"ownerName",label:"Nom du propriétaire",required:true},{name:"company",label:"Société ou gestionnaire"},{name:"phone",label:"Téléphone"},{name:"email",label:"E-mail de contact",type:"email"},{name:"address",label:"Adresse et boîte postale du bailleur",full:true},{name:"city",label:"Ville"},{name:"leaseClauses",label:"Clauses complémentaires du bail (à relire avant signature)",type:"textarea",full:true}],s)}<button class="btn primary" type="submit">Enregistrer</button></form></div><div class="card spaced"><h3>Compte et données</h3><p class="muted">Compte connecté : ${h(user?.email)} · Rôle : ${isAdmin()?"administrateur":"lecture seule"}. Chaque compte conserve son espace de données distinct dans Netlify.</p><div class="actions"><button class="btn secondary" data-action="export">Exporter JSON</button><label class="btn secondary file-label">Importer JSON<input type="file" id="importFile" accept="application/json" hidden></label><button class="btn secondary" data-action="logout">Se déconnecter</button></div></div><div class="card spaced"><h3>Installer sur téléphone</h3><p>Retrouvez GestiLoc Dbz depuis une icône sur l’écran d’accueil.</p><button class="btn primary" data-action="install">Installer l’application sur mon téléphone</button></div>`); }

function detail(view,key) {
  if (view === "maintenance") return maintenanceDetail(state.maintenance.find(x=>x.id===key));
  if (view === "properties") return propertyDetail(property(key));
  if (view === "units") return unitDetail(unit(key));
  if (view === "tenants") return tenantDetail(tenant(key));
  if (view === "inspections") return inspectionDetail(state.inspections.find(i=>i.id===key));
  return ( {dashboard, properties, units, tenants, leases, payments, invoices, inspections, maintenance, reports, settings:settingsView,imports:importsView}[view] )();
}
const back = (view) => `<button class="btn secondary" data-view="${view}">← Retour à la liste</button>`;
function propertyDetail(p) {
  if (!p) return empty("Propriété introuvable");
  const unitsHere=state.units.filter(u=>u.propertyId===p.id);
  return shell(p.name,`${p.address||p.district||""} · ${p.type}`,`${back("properties")}<button class="btn secondary" data-action="edit" data-kind="properties" data-id="${h(p.id)}">Modifier</button>${p.archived?`<button class="btn primary" data-action="property-restore" data-id="${h(p.id)}">Restaurer</button>${forceButton("properties",p.id)}`:`<button class="btn primary" data-action="unit-add" data-property="${h(p.id)}">+ Logement</button><button class="btn danger" data-action="delete" data-kind="properties" data-id="${h(p.id)}">Supprimer / archiver</button>`}`,`<div class="card property-profile" style="border-top:5px solid ${propertyColor(p)}">${p.photo?`<img class="property-profile-photo" src="${propertyPhotoUrl(p)}" alt="${h(p.name)}"><button class="btn small secondary" data-action="property-photo-delete" data-id="${h(p.id)}">Retirer la photo</button>`:""}<h3>Fiche du bien</h3><p>Code d’import : <code>${h(p.importCode||p.id)}</code></p><p>${h(p.address||"Adresse non renseignée")}</p><p>Quartier : ${h(p.district||"—")}</p><p>Parcelle / référence cadastrale : ${h(p.cadastral||"—")}</p></div><div class="card spaced"><h3>Logements (${unitsHere.length})</h3>${unitsHere.length?unitsHere.map(u=>`<div class="quick-row">${linked("units",u.id,u.name)}<span>${money(u.rent)} · ${badge(u.status==="occupied"?"Occupé":u.status==="works"?"En travaux":"Vacant")}</span></div>`).join(""):`<p class="muted">Aucun logement dans ce bien.</p>`}</div>`);
}
function unitDetail(u) {
  if (!u) return empty("Logement introuvable");
  const t=tenant(u.tenantId), history=state.tenants.filter(x=>x.unitId===u.id);
  return shell(u.name,`${property(u.propertyId)?.name||"Propriété"} · ${money(u.rent)} / mois`,`${back("units")}${forceButton("units",u.id)}<button class="btn secondary" data-action="edit" data-kind="units" data-id="${h(u.id)}">Modifier</button>`,`<div class="workflow"><span class="done">1 · Logement créé</span><span class="${t?"done":"current"}">2 · Locataire et bail</span><span class="${t?"current":""}">3 · État des lieux d'entrée</span></div><div class="detail-grid"><div class="card"><h3>Logement</h3><p>Propriété : ${linked("properties",u.propertyId,property(u.propertyId)?.name)}</p><p>Type : ${h(u.type)}</p><p>Loyer : ${money(u.rent)} · Charges : ${money(u.charges)}</p><p>Statut : ${badge(u.status==="occupied"?"Occupé":u.status==="works"?"En travaux":"Vacant")}</p><p><strong>Composition :</strong> ${h(u.description||"À renseigner")}</p></div><div class="card"><h3>${t?"Bail en cours":"Étape suivante · créer le bail"}</h3>${t?`<p>Locataire : ${linked("tenants",t.id,t.name)}</p><p>Entrée : ${dateFr(t.start)}</p><button class="btn primary" data-action="lease-print" data-id="${h(t.id)}">Voir le contrat prérempli</button>`:`<p class="muted">Saisissez l'identité du locataire et les dates. Le contrat reprendra automatiquement la description, l'adresse et le loyer de ce logement.</p><button class="btn primary" data-action="tenant-add" data-unit="${h(u.id)}">Continuer : locataire et bail →</button>`}</div></div><div class="card spaced"><h3>Historique des occupants</h3>${history.length?history.map(x=>`<div class="quick-row">${linked("tenants",x.id,x.name)}<span>${dateFr(x.start)} → ${dateFr(x.end)}</span></div>`).join(""):`<p class="muted">Aucun occupant enregistré.</p>`}</div>`);
}
function tenantDetail(t) {
  if (!t) return empty("Locataire introuvable");
  const u=unit(t.unitId), p=property(u?.propertyId), paymentsHere=state.payments.filter(x=>x.tenantId===t.id).sort((a,b)=>b.date.localeCompare(a.date)), inspectionsHere=state.inspections.filter(x=>x.tenantId===t.id).sort((a,b)=>a.date.localeCompare(b.date));
  const entry=inspectionsHere.find(i=>i.type==="Entrée"), exit=inspectionsHere.find(i=>i.type==="Sortie");
  return shell(t.name,`${t.end?"Location clôturée":"Location en cours"} · ${u?.name||"Logement supprimé"}`,`${back("tenants")}${forceButton("tenants",t.id)}<button class="btn secondary" data-action="edit" data-kind="tenants" data-id="${h(t.id)}">Modifier</button>`,`<div class="detail-grid"><div class="card"><h3>Coordonnées et bail</h3><p>Téléphone : <a href="tel:${h(t.phone)}">${h(t.phone)}</a></p><p>E-mail : ${t.email?`<a href="mailto:${h(t.email)}">${h(t.email)}</a>`:"—"}</p><p>Pièce d'identité : ${h(t.identityNumber||"—")}</p><p>Logement : ${linked("units",t.unitId,u?.name)}</p><p>Bien : ${linked("properties",p?.id,p?.name)}</p><p>Entrée : ${dateFr(t.start)} · Fin prévue : ${dateFr(t.leaseEnd)}</p><p>Loyer : ${money(u?.rent)} · Charges : ${money(u?.charges)} · Dépôt : ${money(t.deposit)}</p><p>Échéance : le ${h(t.dueDay||1)} de chaque mois</p><button class="btn primary" data-action="lease-print" data-id="${h(t.id)}">Contrat de bail prérempli</button><button class="btn secondary" data-action="lease-complete" data-id="${h(t.id)}">Compléter le bail</button></div><div class="card"><h3>Parcours du locataire</h3><ol class="journey"><li>${badge("Entrée")} ${dateFr(t.start)}</li><li>${entry?linked("inspections",entry.id,"État des lieux d'entrée"):!t.end?`<button class="link-button" data-action="inspection-add" data-tenant="${h(t.id)}" data-type="Entrée">Créer l'état des lieux d'entrée</button>`:"État d'entrée non enregistré"}</li><li>${paymentsHere.length} paiement(s) enregistrés</li><li>${exit?linked("inspections",exit.id,"État des lieux de sortie"):!t.end?`<button class="link-button" data-action="inspection-add" data-tenant="${h(t.id)}" data-type="Sortie">Créer l'état des lieux de sortie</button>`:"État de sortie non enregistré"}</li><li>${t.end?`Sortie le ${dateFr(t.end)}`:exit?.finalizedAt?`<button class="btn small danger" data-action="tenant-close" data-id="${h(t.id)}">Clôturer la location</button>`:"Sortie à réaliser"}</li></ol></div></div>
  <div class="detail-grid spaced"><div class="card"><div class="card-head"><h3>Paiements</h3>${t.end?"":`<button class="btn small primary" data-action="payment-add" data-tenant="${h(t.id)}">+ Paiement</button>`}</div>${paymentsHere.length?paymentsHere.map(x=>`<div class="quick-row"><span>${dateFr(x.date)} · ${h(x.month)} · ${h(x.method)}</span><strong>${money(x.amount)}</strong></div>`).join(""):`<p class="muted">Aucun paiement.</p>`}</div><div class="card"><h3>États des lieux</h3>${inspectionsHere.length?inspectionsHere.map(x=>`<div class="quick-row">${linked("inspections",x.id,`État de ${x.type.toLowerCase()}`)}<span>${dateFr(x.date)} · ${x.finalizedAt?"signé":"brouillon"}</span></div>`).join(""):`<p class="muted">Aucun état des lieux.</p>`}</div></div>`);
}
const photoUrl = (inspectionId,photoId) => `/api/photo?inspection=${encodeURIComponent(inspectionId)}&id=${encodeURIComponent(photoId)}`;
function inspectionDetail(i) {
  if (!i) return empty("État des lieux introuvable");
  const t=tenant(i.tenantId), u=unit(i.unitId), locked=!!i.finalizedAt;
  return shell(`État des lieux de ${i.type.toLowerCase()}`,`${dateFr(i.date)} · ${t?.name||"Locataire"}`,`${back("inspections")}${forceButton("inspections",i.id)}${locked?"":`<button class="btn secondary" data-action="inspection-edit" data-id="${h(i.id)}">Modifier le constat</button>`}<button class="btn primary" data-action="inspection-print" data-id="${h(i.id)}">Imprimer / PDF</button>`,`<div class="detail-grid"><div class="card"><h3>Dossier</h3><p>Locataire : ${linked("tenants",i.tenantId,t?.name)}</p><p>Logement : ${linked("units",i.unitId,u?.name)}</p><p>Date : ${dateFr(i.date)} · Heure : ${h(i.time||"—")}</p><p>Clés : ${h(i.keys??"—")} · Badges : ${h(i.badges??"—")}</p><p>Compteurs : électricité ${h(i.electricity||"—")} · eau ${h(i.water||"—")}</p><p>Statut : ${badge(locked?"Signé":"Brouillon")}</p><p>Observations : ${h(i.notes||"Aucune")}</p>${i.reservations?`<p>Réserves : ${h(i.reservations)}</p>`:""}</div><div class="card"><h3>Signatures dans l'application</h3><div class="signature-grid"><div><strong>Bailleur</strong>${safeSignature(i.signatures?.landlord)?`<img src="${safeSignature(i.signatures.landlord)}" alt="Signature du bailleur">`:`<p class="muted">À signer</p>`}${locked?"":`<button class="btn small secondary" data-action="sign" data-role="landlord" data-id="${h(i.id)}">Signer</button>`}</div><div><strong>Locataire</strong>${safeSignature(i.signatures?.tenant)?`<img src="${safeSignature(i.signatures.tenant)}" alt="Signature du locataire">`:`<p class="muted">À signer</p>`}${locked?`<p class="muted">Signature recueillie en présence du propriétaire.</p>`:`<button class="btn small secondary" data-action="sign" data-role="tenant" data-id="${h(i.id)}">Faire signer le locataire</button>`}</div></div>${locked?`<p class="muted">Finalisé le ${dateFr(i.finalizedAt)}</p>`:`<button class="btn primary" data-action="inspection-finalize" data-id="${h(i.id)}">Finaliser après les deux signatures</button>`}</div></div>
  <div class="card spaced"><h3>Constat détaillé ${i.type==="Sortie"?"(comparaison avec l'entrée)":""}</h3><div class="table-wrap"><table><thead><tr><th>Section / élément</th>${i.type==="Sortie"?"<th>Entrée</th>":""}<th>${i.type==="Sortie"?"Sortie":"État"}</th><th>Observations</th></tr></thead><tbody>${(i.items||[]).map(x=>{const previous=state.inspections.find(e=>e.tenantId===i.tenantId&&e.type==="Entrée")?.items?.find(e=>e.section===x.section&&e.item===x.item);return `<tr><td>${h(x.section||"Général")} · ${h(x.item)}</td>${i.type==="Sortie"?`<td>${h(previous?.state||"—")}</td>`:""}<td>${badge(x.state)}</td><td>${h(observationText(x)||"—")}</td></tr>`}).join("")}</tbody></table></div></div>
  <div class="card spaced"><div class="card-head"><h3>Photos (${i.photos?.length||0})</h3>${locked?"":`<label class="btn small primary file-label">+ Prendre une photo<input id="cameraFile" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden></label><label class="btn small secondary file-label">+ Depuis le téléphone<input id="photoFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label>`}</div><div class="photo-grid">${(i.photos||[]).map(photo=>`<figure><a href="${photoUrl(i.id,photo.id)}" target="_blank" rel="noopener"><img loading="lazy" src="${photoUrl(i.id,photo.id)}" alt="${h(photo.caption||"Photo de l'état des lieux")}"></a><figcaption>${h(photo.caption||"Photo")}</figcaption>${locked?"":`<button class="btn small danger" data-action="photo-delete" data-id="${h(photo.id)}" data-inspection="${h(i.id)}">Retirer</button>`}</figure>`).join("")}</div>${!i.photos?.length?`<p class="muted">Aucune photo ajoutée.</p>`:""}</div>`);
}
function fields(list, values = {}) {
  return `<div class="form-grid">${list.map(f=>{const value=values[f.name]??f.value??"";return `<div class="field ${f.full?"full":""}"><label for="field_${f.name}">${h(f.label)}</label>${f.type==="select"?`<select id="field_${f.name}" name="${f.name}" ${f.required?"required":""}>${(f.options||[]).map(o=>`<option value="${h(o.value)}" ${String(value)===String(o.value)?"selected":""}>${h(o.label)}</option>`).join("")}</select>`:f.type==="textarea"?`<textarea id="field_${f.name}" name="${f.name}">${h(value)}</textarea>`:`<input id="field_${f.name}" name="${f.name}" type="${f.type||"text"}" value="${h(value)}" ${f.type==="number"?`min="${f.min??0}" step="1"`:""} ${f.required?"required":""}>`}</div>`}).join("")}</div>`;
}
const option = (arr, label) => arr.map(x=>({value:x.id,label:label(x)}));
const choices = (arr) => arr.map(x=>({value:x,label:x}));
function openModal(title, html, onSubmit) {
  const mainSubmit=$("#modalForm").querySelector('[type="submit"]');mainSubmit.textContent="Enregistrer";mainSubmit.className="btn primary";mainSubmit.disabled=false;
  $("#modalTitle").textContent=title; $("#modalBody").innerHTML=html; $("#modalBackdrop").hidden=false;
  $("#modalForm").onsubmit=async event=>{ event.preventDefault(); const submit=event.target.querySelector('[type="submit"]'); submit.disabled=true;
    try { await onSubmit(Object.fromEntries(new FormData(event.target))); closeModal(); }
    catch(error) { toast(error.message||"Enregistrement impossible"); }
    finally { submit.disabled=false; }
  };
}
function closeModal() { $("#modalBackdrop").hidden=true; $("#modalForm").reset(); }
function addProperty(existing) {
  openModal(existing?"Modifier la propriété":"Ajouter une propriété",fields([
    {name:"color",label:"Couleur de la propriété",type:"select",options:propertyColors.map(([value,label])=>({value,label}))},{name:"name",label:"Nom de la propriété",required:true},{name:"district",label:"Quartier",required:true},
    {name:"address",label:"Adresse complète",full:true},{name:"cadastral",label:"Parcelle / référence cadastrale"},{name:"type",label:"Type",type:"select",options:choices(["Studio","Appartement","Immeuble","Villa","Maison","Local commercial","Autre"])}
  ],existing)+`<div class="field"><label for="propertyPhoto">Photo du bien (facultative)</label><input id="propertyPhoto" type="file" accept="image/jpeg,image/png,image/webp"><small>JPEG, PNG ou WebP. La photo sera adaptée pour le téléphone.</small></div>`,async data=>{ const file=$("#propertyPhoto").files[0];const record=existing||{id:id("p")};Object.assign(record,data);if(!existing)state.properties.push(record);persist();navigate("properties",record.id);if(file)await savePropertyPhoto(record.id,file); });
}
function equipmentChoices(type,chosen=[]) {
  return (roomEquipment[type]||[]).map(item=>`<label class="equipment-option"><input type="checkbox" value="${h(item)}" ${chosen.includes(item)?"checked":""}>${h(item)}</label>`).join("");
}
function roomEditor(room={}) {
  const type=room.type||"";
  return `<div class="room-editor"><div class="room-main"><select class="room-type" aria-label="Type de pièce" required><option value="">Choisir la pièce</option>${roomTypes.map(value=>`<option value="${h(value)}" ${value===type?"selected":""}>${h(value)}</option>`).join("")}</select><input class="room-label" aria-label="Nom de la pièce" placeholder="Nom facultatif : Chambre 2…" value="${h(room.label||"")}"><button type="button" class="btn small danger room-remove" aria-label="Retirer cette pièce">Retirer</button></div><div class="room-wc" ${type==="Salle d’eau"?"":"hidden"}><label>W.C. dans cette salle d’eau ?</label><select class="room-toilet"><option value="">À préciser</option><option value="integrated" ${room.toilet==="integrated"?"selected":""}>Oui, W.C. intégré</option><option value="none" ${room.toilet==="none"?"selected":""}>Non, W.C. séparé ou absent</option></select></div><div class="room-equipments"><strong>Équipements présents</strong><div class="equipment-choice">${equipmentChoices(type,room.equipment||[])}</div></div><input class="room-extra" aria-label="Autres équipements" placeholder="Autres équipements ou précision" value="${h(room.extra||"")}"></div>`;
}
function addUnit(existing, propertyId) {
  if (!existing && !state.properties.some(p=>!p.archived)) return toast("Ajoutez d'abord une propriété active.");
  const initial={...(existing||{propertyId,status:"vacant"}),descriptionNotes:existing?.descriptionNotes??(existing?.rooms?.length?"":existing?.description||"")};
  const html=fields([
    {name:"name",label:"Nom ou référence",required:true},{name:"propertyId",label:"Propriété",type:"select",options:option(state.properties.filter(p=>!p.archived||p.id===existing?.propertyId),p=>p.name),required:true},
    {name:"type",label:"Type",type:"select",options:choices(["Studio","Appartement","Villa","Boutique","Bureau","Autre"])},
    {name:"locationDetail",label:"Immeuble, étage, porte ou précision d'accès",full:true},
    {name:"sharedEquipment",label:"Équipements communs / règlement intérieur",type:"textarea",full:true},
    {name:"rent",label:"Loyer mensuel (FCFA)",type:"number",min:1,required:true},{name:"charges",label:"Charges mensuelles (FCFA)",type:"number"},
    ...(existing?.tenantId?[]:[{name:"status",label:"Statut du logement",type:"select",options:[{value:"vacant",label:"Vacant"},{value:"occupied",label:"Occupé — créer le dossier locataire"},{value:"works",label:"En travaux"}]}]),
    {name:"descriptionNotes",label:"Précisions complémentaires sur le logement",type:"textarea",full:true}
  ],initial)+`<section class="room-composition"><div class="card-head"><div><h3>Composition et équipements</h3><p class="muted">Ajoutez autant de pièces du même type que nécessaire. Cochez uniquement les équipements présents.</p></div><button type="button" class="btn secondary" id="roomAdd">+ Pièce</button></div><div id="roomEditors">${(existing?.rooms||[]).map(roomEditor).join("")}</div></section>`;
  openModal(existing?"Modifier le logement":"Ajouter un logement",html,data=>{
    const rooms=[...$("#roomEditors").querySelectorAll(".room-editor")].map(card=>({type:card.querySelector(".room-type").value,label:card.querySelector(".room-label").value.trim(),toilet:card.querySelector(".room-toilet").value,equipment:[...card.querySelectorAll(".equipment-choice input:checked")].map(x=>x.value),extra:card.querySelector(".room-extra").value.trim()}));
    if(rooms.some(room=>!room.type))throw Error("Choisissez un type pour chaque pièce ajoutée.");
    if(rooms.some(room=>room.type==="Salle d’eau"&&!room.toilet))throw Error("Précisez si les W.C. sont dans chaque salle d’eau.");
    const values={...data,rooms,description:roomSummary(rooms,data.descriptionNotes),rent:Number(data.rent),charges:Number(data.charges||0)};
    const record=existing||{id:id("u"),tenantId:null};if(existing)Object.assign(existing,values);else{Object.assign(record,values);state.units.push(record);}
    persist();navigate("units",record.id);
    if(!existing&&record.status==="occupied")setTimeout(()=>addTenant(null,record.id),0);
  });
  $("#roomAdd").onclick=()=>$("#roomEditors").insertAdjacentHTML("beforeend",roomEditor());
  $("#roomEditors").addEventListener("click",event=>{if(event.target.closest(".room-remove"))event.target.closest(".room-editor").remove();});
  $("#roomEditors").addEventListener("change",event=>{if(!event.target.matches(".room-type"))return;const card=event.target.closest(".room-editor");card.querySelector(".equipment-choice").innerHTML=equipmentChoices(event.target.value);card.querySelector(".room-wc").hidden=event.target.value!=="Salle d’eau";card.querySelector(".room-toilet").value="";});
}
function addTenant(existing, unitId) {
  const available=state.units.filter(u=>(!u.tenantId || u.id===existing?.unitId) && (!property(u.propertyId)?.archived || u.id===existing?.unitId));
  if (!available.length && !existing) return toast("Ajoutez d'abord un logement disponible.");
  openModal(existing?"Modifier le locataire":"Ajouter un locataire",fields([
    {name:"name",label:"Nom et prénom",required:true},{name:"phone",label:"Téléphone",required:true},
    {name:"email",label:"E-mail",type:"email"},{name:"identityNumber",label:"N° de pièce d'identité"},{name:"postalAddress",label:"Adresse et boîte postale",full:true},
    {name:"unitId",label:"Logement",type:"select",options:option(available,u=>`${u.name} · ${money(u.rent)}`),required:true},
    {name:"start",label:"Date d'entrée",type:"date",required:true},{name:"leaseEnd",label:"Fin prévue du bail",type:"date",required:true},
    {name:"deposit",label:"Dépôt de garantie (FCFA)",type:"number"},{name:"dueDay",label:"Jour d'échéance du loyer",type:"number",min:1},
    {name:"leasePaymentMethod",label:"Mode de règlement prévu",type:"select",options:[{value:"",label:"À convenir"},...choices(["Espèces","Virement bancaire","Airtel Money","Moov Money","Chèque","Autre"])]},
    {name:"purpose",label:"Usage",type:"select",options:choices(["Habitation","Professionnel","Commercial"])},
    {name:"renewalMode",label:"Renouvellement",type:"select",options:[{value:"",label:"À définir"},...choices(["Reconduction automatique d’un an","Renouvellement par accord écrit","Sans reconduction automatique"])]},
    {name:"noticeMonths",label:"Préavis convenu (mois)",type:"number",min:0},
    {name:"rentReview",label:"Révision du loyer",type:"select",options:[{value:"",label:"À préciser"},...choices(["Selon accord écrit des parties","Tous les deux ans sous réserve des règles applicables","Sans révision prévue"])]},
    {name:"feesResponsibility",label:"Frais d'enregistrement",type:"select",options:[{value:"",label:"À préciser"},...choices(["À la charge du preneur","À la charge du bailleur","Partagés entre les parties"])]},
    {name:"preOccupancyWorks",label:"Travaux avant occupation (si prévus)",type:"textarea",full:true},
    {name:"leaseNotes",label:"Conditions particulières",type:"textarea",full:true},
    {name:"leaseManual",label:"Compléments manuels du bail",type:"textarea",full:true},
    {name:"manualLines",label:"Lignes à laisser pour compléter à la main sur papier",type:"select",options:choices(["2","5","8","12"])}
  ],existing||{unitId,start:today(),dueDay:1,purpose:"Habitation",manualLines:"5"}),data=>{
    if(Number(data.dueDay)>31)throw Error("Le jour d'échéance doit être compris entre 1 et 31.");
    if(data.leaseEnd&&data.leaseEnd<data.start)throw Error("La fin du bail doit être après la date d'entrée.");
    if(existing?.end && data.unitId!==existing.unitId)throw Error("Un dossier clôturé conserve son logement historique.");
    if(existing && existing.unitId!==data.unitId){const old=unit(existing.unitId);if(old?.tenantId===existing.id){old.tenantId=null;old.status="vacant";}}
    const record=existing||{id:id("t")};Object.assign(record,{...data,deposit:Number(data.deposit||0),dueDay:Number(data.dueDay||1)});
    if(!existing)state.tenants.push(record);
    if(!record.end){const assigned=unit(record.unitId);assigned.tenantId=record.id;assigned.status="occupied";}
    persist();navigate("tenants",record.id);if(!existing)toast("Dossier créé : ouvrez le contrat de bail prérempli pour le relire.");
  });
}
function addPayment(existing, tenantId) {
  const options=state.tenants.filter(t=>!t.end || t.id===existing?.tenantId);
  if(!options.length)return toast("Ajoutez d'abord un locataire actif.");
  openModal(existing?"Modifier le paiement":"Enregistrer un paiement",fields([
    {name:"tenantId",label:"Locataire",type:"select",options:option(options,t=>`${t.name} · ${unit(t.unitId)?.name||""}`),required:true},
    {name:"month",label:"Mois de loyer",type:"month",required:true},{name:"amount",label:"Somme reçue (FCFA)",type:"number",min:1,required:true},
    {name:"date",label:"Date de réception",type:"date",required:true},
    {name:"method",label:"Mode d'encaissement",type:"select",options:choices(["Espèces","Virement bancaire","Airtel Money","Moov Money","Chèque","Autre"])},
    {name:"reference",label:"Référence de transaction / reçu"},{name:"notes",label:"Observations",type:"textarea",full:true}
  ],existing||{tenantId,month:monthKey(),date:today(),method:"Virement bancaire"}),data=>{
    const t=tenant(data.tenantId); if(!t)throw Error("Locataire introuvable.");
    const values={...data,amount:Number(data.amount),unitId:t.unitId};
    if(existing)Object.assign(existing,values);else state.payments.push({id:id("pay"),...values});
    persist();
  });
}
function addMaintenance(existing) {
  if(!state.units.length)return toast("Ajoutez d'abord un logement.");
  openModal(existing?"Modifier l'intervention":"Nouvelle intervention",fields([
    {name:"title",label:"Intervention",required:true,full:true},{name:"unitId",label:"Logement",type:"select",options:option(state.units,u=>u.name)},
    {name:"category",label:"Catégorie",type:"select",options:choices(["Plomberie","Électricité","Peinture","Serrurerie","Climatisation","Autre"])},
    {name:"priority",label:"Priorité",type:"select",options:choices(["Faible","Moyenne","Haute","Urgente"])},
    {name:"cost",label:"Coût (FCFA)",type:"number"},{name:"status",label:"Statut",type:"select",options:choices(["Signalé","Devis demandé","Planifié","En cours","Terminé"])},
    {name:"date",label:"Date",type:"date",required:true}
  ],existing||{date:today(),status:"Signalé"}),data=>{const values={...data,cost:Number(data.cost||0)};if(existing)Object.assign(existing,values);else state.maintenance.push({id:id("m"),...values});persist();});
}
function addInspection(tenantId, preferredType = "Entrée", existing = null) {
  const active=state.tenants.filter(t=>!t.end);
  if(!active.length && !existing)return toast("Ajoutez d'abord un locataire actif.");
  if(existing?.finalizedAt)return toast("Un état des lieux finalisé ne peut pas être modifié.");
  const selectedTenant=existing?.tenantId||tenantId||active[0].id;
  const selectedType=existing?.type||preferredType;
  const baseline=state.inspections.find(i=>i.tenantId===selectedTenant&&i.type==="Entrée");
  const inspected=existing?.items?.length ? existing.items : inspectionItemsForUnit(unit(tenant(selectedTenant)?.unitId));
  const html=fields([
    {name:"tenantId",label:"Locataire",type:"select",options:option(existing?[tenant(selectedTenant)]:active,t=>`${t.name} · ${unit(t.unitId)?.name||""}`),required:true},
    {name:"type",label:"Type",type:"select",options:choices([selectedType])},
    {name:"date",label:"Date du constat",type:"date",required:true},
    {name:"time",label:"Heure du constat",type:"time"},
    {name:"electricity",label:"Compteur électricité (index et unité)"},
    {name:"water",label:"Compteur eau (index et unité)"},
    {name:"keys",label:selectedType==="Sortie"?"Nombre de clés rendues":"Nombre de clés remises",type:"number"},
    {name:"badges",label:"Nombre de badges / télécommandes",type:"number"},
    {name:"keyDetails",label:"Détail des clés et équipements",type:"textarea",full:true},
    ...(selectedType==="Sortie"?[{name:"reservations",label:"Réserves, réparations et points à suivre",type:"textarea",full:true}]:[]),
    {name:"notes",label:"Observations générales",type:"textarea",full:true}
  ],existing||{tenantId:selectedTenant,type:selectedType,date:today()})+`<p class="muted">${selectedType==="Sortie"?(baseline?`Comparaison avec l'état d'entrée du ${dateFr(baseline.date)}. Saisissez l'état constaté à la sortie.`:"Aucun état d'entrée enregistré : saisissez les constats de sortie sans comparaison."):"Sélectionnez l'état constaté pour chaque élément. Aucun état n'est présumé bon."}</p><div class="inspection-checklist">${inspected.map((item,n)=>{const previous=baseline?.items?.find(x=>x.section===item.section&&x.item===item.item);return `${n===0||item.section!==inspected[n-1].section?`<h3 class="inspection-section">${h(item.section||"Autres éléments")}</h3>`:""}<div class="inspection-line"><strong>${h(item.item)}</strong>${selectedType==="Sortie"?`<small>Entrée : ${h(previous?.state||"sans constat")}</small>`:""}<select name="condition_${n}" required><option value="">Choisir l'état</option>${["Bon","Moyen","Mauvais","Non applicable"].map(v=>`<option value="${v}" ${existing?.items?.[n]?.state===v?"selected":""}>${v}</option>`).join("")}</select><label class="observation-field">Observation adaptée<select name="observation_${n}" aria-label="Observation pour ${h(item.item)}"><option value="">Choisir une observation (facultatif)</option>${[...new Set([...observationOptions(item.item),existing?.items?.[n]?.observation].filter(Boolean))].map(value=>`<option value="${h(value)}" ${existing?.items?.[n]?.observation===value?"selected":""}>${h(value)}</option>`).join("")}</select></label><label class="observation-field">Précisions libres<textarea name="note_${n}" placeholder="Emplacement, détail, dimensions…">${h(existing?.items?.[n]?.note||"")}</textarea></label></div>`}).join("")}</div><div class="inspection-photo-choice"><h3>Photos du constat</h3><p class="muted">Vous pouvez les ajouter maintenant. Elles seront envoyées après l'enregistrement du constat.</p><label class="btn secondary file-label">Prendre une photo<input id="inspectionCamera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden></label><label class="btn secondary file-label">Choisir plusieurs photos<input id="inspectionGallery" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label></div>`;
  openModal(existing?"Modifier l'état des lieux":"Nouvel état des lieux",html,async data=>{
    const t=tenant(data.tenantId);if(!t)throw Error("Locataire introuvable.");
    if(!existing&&state.inspections.some(i=>i.tenantId===t.id&&i.type===data.type))throw Error(`Un état des lieux de ${data.type.toLowerCase()} existe déjà pour ce locataire.`);
    if(inspected.some((_,n)=>!data[`condition_${n}`]))throw Error("Renseignez l'état de chaque élément.");
    if(existing?.signatures?.landlord||existing?.signatures?.tenant) {
      if(!confirm("Modifier ce constat annulera les signatures déjà recueillies. Continuer ?"))return;
    }
    const files=[...$("#inspectionCamera").files,...$("#inspectionGallery").files];
    const record=existing||{id:id("ins"),photos:[],signatures:{landlord:null,tenant:null},finalizedAt:null};
    Object.assign(record,{tenantId:t.id,unitId:t.unitId,type:data.type,date:data.date,time:data.time,electricity:data.electricity,water:data.water,keys:data.keys,badges:data.badges,keyDetails:data.keyDetails,reservations:data.reservations||"",notes:data.notes,
      items:inspected.map((item,n)=>({section:item.section||"Autres éléments",item:item.item,state:data[`condition_${n}`],observation:data[`observation_${n}`],note:data[`note_${n}`]}))});
    if(existing)record.signatures={landlord:null,tenant:null};else state.inspections.push(record);
    persist();navigate("inspections",record.id);
    if(files.length)await attachPhotos(record,files);
  });
  if(!existing)$("#field_tenantId").onchange=event=>{if(event.target.value!==selectedTenant)addInspection(event.target.value,selectedType);};
}

function closeTenant(key) {
  const t=tenant(key), exit=state.inspections.find(i=>i.tenantId===key&&i.type==="Sortie"&&i.finalizedAt);
  if(!t||t.end)return;
  if(!exit)return toast("Finalisez d'abord l'état des lieux de sortie avec les deux signatures.");
  if(!confirm(`Clôturer la location de ${t.name} ?`))return;
  t.end=exit.date;const u=unit(t.unitId);if(u?.tenantId===t.id){u.tenantId=null;u.status="vacant";}
  persist();
}
function issueInvoices() {
  let count=0;const month=monthKey();
  for(const u of activeUnits()){
    if(state.invoices.some(i=>i.unitId===u.id&&i.month===month))continue;
    const seq=state.invoices.filter(i=>i.month===month).length+1;
    state.invoices.push({id:id("inv"),number:`FAC-${month.replace("-","")}-${String(seq).padStart(3,"0")}`,tenantId:u.tenantId,unitId:u.id,month,amount:Number(u.rent),date:today()});count++;
  }
  if(count)persist();navigate("invoices");toast(`${count} facture(s) créée(s)`);
}
function removeRecord(kind,key) { forceDeleteDialog(kind,key); }
async function uploadPhotos(event) {
  const inspection=state.inspections.find(i=>i.id===selected);
  if(!inspection||inspection.finalizedAt)return;
  const files=[...event.target.files];if(!files.length)return;
  await attachPhotos(inspection,files);
}
async function attachPhotos(inspection,files) {
  if(!files.length)return;
  if(!await flush())return toast("Enregistrez d'abord l'état des lieux avant d'ajouter des photos.");
  for(const file of files){
    try {
      const image=await scaledPhoto(file);
      const result=await fetch(`/api/photo?inspection=${encodeURIComponent(inspection.id)}`,{method:"POST",credentials:"same-origin",headers:{"content-type":image.type},body:image});
      if(!result.ok)throw Error((await result.json()).error||"Envoi impossible");
      const photo=await result.json();
      const caption=prompt("Légende de la photo (pièce, élément, observation)",file.name)?.trim()||file.name;
      inspection.photos.push({id:photo.id,mime:photo.mime,caption});persist();
    }catch(error){toast(`${file.name} : ${error.message}`);}
  }
  await flush();
}
async function deletePhoto(inspectionId,photoId) {
  const inspection=state.inspections.find(i=>i.id===inspectionId);
  if(!inspection||inspection.finalizedAt||!confirm("Retirer cette photo ?"))return;
  const response=await fetch(`/api/photo?inspection=${encodeURIComponent(inspectionId)}&id=${encodeURIComponent(photoId)}`,{method:"DELETE",credentials:"same-origin"});
  if(!response.ok)return toast("Suppression de la photo impossible.");
  inspection.photos=inspection.photos.filter(p=>p.id!==photoId);persist();
}
function signInspection(inspectionId,role) {
  const inspection=state.inspections.find(i=>i.id===inspectionId);
  if(!inspection||inspection.finalizedAt)return;
  openModal(`Signature ${role==="landlord"?"du bailleur":"du locataire"}`,`<p>La personne signe directement dans le cadre ci-dessous.</p><canvas id="signatureCanvas" width="700" height="190" aria-label="Zone de signature"></canvas><button type="button" class="btn secondary" id="clearSignature">Effacer et recommencer</button>`,async()=>{
    if(!canvas.hasStroke)throw Error("Tracez une signature avant d'enregistrer.");
    inspection.signatures={...inspection.signatures,[role]:canvas.toDataURL("image/png")};persist();
  });
  const canvas=$("#signatureCanvas"),ctx=canvas.getContext("2d");
  ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle="#173033";ctx.lineWidth=3;ctx.lineCap="round";ctx.lineJoin="round";
  let drawing=false;
  const point=e=>{const rect=canvas.getBoundingClientRect();return {x:(e.clientX-rect.left)*canvas.width/rect.width,y:(e.clientY-rect.top)*canvas.height/rect.height}};
  canvas.addEventListener("pointerdown",e=>{e.preventDefault();canvas.setPointerCapture(e.pointerId);drawing=true;const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.01,p.y+.01);ctx.stroke();canvas.hasStroke=true;});
  canvas.addEventListener("pointermove",e=>{if(!drawing)return;e.preventDefault();const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke();});
  canvas.addEventListener("pointerup",()=>drawing=false);canvas.addEventListener("pointercancel",()=>drawing=false);
  $("#clearSignature").onclick=()=>{ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);canvas.hasStroke=false;};
}
function finalizeInspection(key) {
  const i=state.inspections.find(x=>x.id===key);if(!i||i.finalizedAt)return;
  if(!i.signatures?.landlord||!i.signatures?.tenant)return toast("Recueillez les signatures du bailleur et du locataire.");
  if(!confirm("Finaliser ce constat ? Les photos et signatures ne seront plus modifiables."))return;
  i.finalizedAt=today();persist();
}
const safeSignature=(value)=>typeof value==="string"&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)?value:"";
function printDocument(title,body) {
  const win=window.open("","_blank");if(!win)return toast("Autorisez la fenêtre d'impression dans votre navigateur.");
  const owner=state.settings.company||state.settings.ownerName||"Bailleur";
  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${h(title)}</title><style>body{font:13px/1.5 Arial,sans-serif;color:#173033;margin:30px auto;max-width:950px;padding:0 20px}header{border-bottom:3px solid #0f3d3e;margin-bottom:24px;padding-bottom:14px}h1{margin:0 0 4px}h2{margin-top:28px;font-size:22px}h3{margin:22px 0 8px;font-size:16px}p{margin:8px 0}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #b8c7c6;padding:7px;text-align:left;vertical-align:top}th{background:#eef3f2}.inspection-table{font-size:11px}.inspection-table td:first-child{width:30%}img.photo{width:220px;height:165px;object-fit:contain;border:1px solid #ccc;margin:5px}figure{display:inline-block;vertical-align:top;margin:8px}figcaption{max-width:220px}.signatures{display:flex;gap:40px;margin-top:40px}.signatures>div{flex:1;text-align:center}.signatures img{width:240px;max-height:90px;object-fit:contain}.draft{border:1px solid #b5781d;padding:10px;background:#fff8e8}button{padding:10px 16px;margin:20px 0}@page{size:A4;margin:16mm}@media print{button{display:none}body{margin:0;max-width:none;padding:0}h3,figure,tr{break-inside:avoid}thead{display:table-header-group}}</style></head><body><header><h1>${h(owner)}</h1><div>${h(state.settings.address||"")} · ${h(state.settings.city||"")}</div><div>${h(state.settings.phone||"")} ${h(state.settings.email||"")}</div></header><h2>${h(title)}</h2>${body}<button onclick="window.print()">Imprimer ou enregistrer en PDF</button></body></html>`);
  win.document.close();
}
function printLease(key) {
  const t=tenant(key),u=unit(t?.unitId),p=property(u?.propertyId);if(!t||!u)return toast("Dossier du bail incomplet.");
  const entry=state.inspections.find(i=>i.tenantId===t.id&&i.type==="Entrée");
  printDocument("Contrat de bail",leaseHTML({tenant:t,unit:u,property:p,settings:state.settings,entry}));
}
function printReceipt(key) {
  const payment=state.payments.find(p=>p.id===key);if(!payment)return;
  const t=tenant(payment.tenantId),u=unit(payment.unitId),balance=Math.max(0,Number(u?.rent||0)-paid(payment.tenantId,payment.month));
  printDocument(`Reçu de paiement · ${payment.month}`,`<p>Je soussigné(e) ${h(state.settings.ownerName||"le bailleur")}, reconnais avoir reçu de <strong>${h(t?.name||"—")}</strong> la somme de <strong>${money(payment.amount)}</strong> pour le logement ${h(u?.name||"—")} au titre du mois ${h(payment.month)}.</p><p>Règlement reçu le ${dateFr(payment.date)} par ${h(payment.method)}${payment.reference?` · Référence : ${h(payment.reference)}`:""}.</p><p>Solde connu pour ce mois à la date d'impression : ${money(balance)}. Ce document atteste ce versement.</p><p>${h(payment.notes||"")}</p><p>Signature du bailleur : _______________________</p>`);
}
function printInvoice(key) {
  const invoice=state.invoices.find(i=>i.id===key);if(!invoice)return;
  const t=tenant(invoice.tenantId),u=unit(invoice.unitId),p=property(u?.propertyId);
  printDocument(`Facture ${invoice.number}`,`<p>Date : ${dateFr(invoice.date)}<br>Locataire : ${h(t?.name||"—")}<br>Bien : ${h(p?.name||"—")} · ${h(u?.name||"—")}</p><table><tr><th>Désignation</th><th>Période</th><th>Montant</th></tr><tr><td>Loyer mensuel</td><td>${h(invoice.month)}</td><td>${money(invoice.amount)}</td></tr></table><h3>Total à payer : ${money(invoice.amount)}</h3>`);
}
function printInspection(key) {
  const i=state.inspections.find(x=>x.id===key);if(!i)return;
  const t=tenant(i.tenantId),u=unit(i.unitId),p=property(u?.propertyId);
  const entry=state.inspections.find(x=>x.tenantId===i.tenantId&&x.type==="Entrée");
  printDocument(`État des lieux de ${i.type.toLowerCase()}`,inspectionHTML({inspection:i,tenant:t,unit:u,property:p,settings:state.settings,entry,photoUrl,safeSignature}));
}
function blobAsDataUrl(blob) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error("Lecture d'image impossible"));reader.readAsDataURL(blob);}); }
async function exportData() {
  const backup=structuredClone(state);
  for(const p of backup.properties)if(p.photo){
    const response=await fetch(propertyPhotoUrl(p),{credentials:"same-origin"});
    if(!response.ok)throw Error("Une photo de propriété est inaccessible. Sauvegarde interrompue.");
    p.photo.dataUrl=await blobAsDataUrl(await response.blob());
  }
  for(const inspection of backup.inspections)for(const photo of inspection.photos||[]){
    const response=await fetch(photoUrl(inspection.id,photo.id),{credentials:"same-origin"});
    if(!response.ok)throw Error("Une photo est inaccessible. La sauvegarde n'a pas été créée.");
    photo.dataUrl=await blobAsDataUrl(await response.blob());
  }
  const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download=`gestiloc-sauvegarde-${today()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importData(event) {
  const file=event.target.files?.[0];if(!file)return;
  try { const parsed=JSON.parse(await file.text()); if(!Array.isArray(parsed.properties)||!Array.isArray(parsed.tenants))throw Error("Fichier incompatible.");
    if(!confirm("Remplacer toutes les données de ce compte par le contenu du fichier ?"))return;
    const photos=[],propertyPhotos=[],finalizations=[];
    for(const p of parsed.properties)if(p.photo){
      if(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo.dataUrl||"")||p.photo.dataUrl.length>4_100_000)throw Error("La photo de propriété manque dans cette sauvegarde.");
      propertyPhotos.push({id:p.id,dataUrl:p.photo.dataUrl});delete p.photo;
    }
    for(const inspection of parsed.inspections||[]){
      const refs=Array.isArray(inspection.photos)?inspection.photos:[];
      for(const photo of refs){
        if(!photo.dataUrl)throw Error("Cette sauvegarde contient des références de photos sans les images. Exportez de nouveau depuis l'application.");
        if(photo.dataUrl){
          if(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo.dataUrl)||photo.dataUrl.length>4_100_000)throw Error("Photo de sauvegarde invalide ou trop grande.");
          photos.push({inspectionId:inspection.id,photo});
        }
      }
      inspection.photos=[];
      if(inspection.finalizedAt){finalizations.push({id:inspection.id,date:inspection.finalizedAt});inspection.finalizedAt=null;}
    }
    state=normalize(parsed);persist();
    if(!await flush())throw Error("Données non enregistrées ; vérifiez la connexion et relancez l'import.");
    for(const item of photos){
      const blob=await (await fetch(item.photo.dataUrl)).blob();
      const response=await fetch(`/api/photo?inspection=${encodeURIComponent(item.inspectionId)}`,{method:"POST",credentials:"same-origin",headers:{"content-type":blob.type},body:blob});
      if(!response.ok)throw Error("Import des photos interrompu. Relancez l'import depuis la sauvegarde.");
      const saved=await response.json(),inspection=state.inspections.find(i=>i.id===item.inspectionId);
      inspection.photos.push({id:saved.id,mime:saved.mime,caption:item.photo.caption||"Photo"});persist();
    }
    await flush();
    for(const item of propertyPhotos)await savePropertyPhoto(item.id,await (await fetch(item.dataUrl)).blob());
    for(const item of finalizations){const i=state.inspections.find(x=>x.id===item.id);if(i)i.finalizedAt=item.date;}
    persist();if(!await flush())throw Error("Vérifiez la connexion pour finaliser la restauration.");
    toast("Sauvegarde importée avec ses photos.");
  }catch(error){toast(error.message||"Fichier invalide.");}
}
async function disconnect() {
  if(dirty&&!await flush()&&!confirm("Certaines modifications ne sont pas enregistrées. Quitter quand même ?"))return;
  await logout();await requireLogin();
}

$("#nav").addEventListener("click",event=>{const button=event.target.closest("[data-view]");if(button)navigate(button.dataset.view);});
document.addEventListener("click",async event=>{
  const nav=event.target.closest("[data-view]");if(nav&& !nav.closest("#nav")){navigate(nav.dataset.view,null,nav.dataset.filter||"");return;}
  const open=event.target.closest("[data-open]");if(open){if(open.dataset.notification){state.settings.readNotifications=[...(state.settings.readNotifications||[]),open.dataset.notification].slice(-1000);persist();}navigate(open.dataset.open,open.dataset.id);return;}
  const button=event.target.closest("[data-action]");if(!button)return;
  const {action,kind,id:key,tenant:tenantId,unit:unitId,property:propertyId,type}=button.dataset;
  try {
    if(!["lease-print","receipt-print","invoice-print","inspection-print","report-print","export","logout"].includes(action))requireAdmin();
    if(action==="property-add")addProperty();
    if(action==="force-delete")forceDeleteDialog(kind,key);
    if(action==="property-photo-delete")await removePropertyPhoto(key);
    if(action==="install")await installApp();
    if(action==="lease-complete")completeLease(key);
    if(action==="import-codes")downloadImportCodes();
    if(action==="archive"){const p=property(key);if(p&&!state.units.some(u=>u.propertyId===key&&u.status==="occupied")){p.archived=true;closeModal();persist();navigate("properties");}}
    if(action==="property-archives"){showArchived=!showArchived;render();}
    if(action==="property-restore"){const p=property(key);if(p){p.archived=false;persist();}}
    if(action==="unit-add")addUnit(null,propertyId);
    if(action==="tenant-add")addTenant(null,unitId);
    if(action==="payment-add")addPayment(null,tenantId);
    if(action==="maintenance-add")addMaintenance();
    if(action==="inspection-add")addInspection(tenantId,type);
    if(action==="inspection-edit")addInspection(null,null,state.inspections.find(i=>i.id===key));
    if(action==="edit")({properties:addProperty,units:addUnit,tenants:addTenant,payments:addPayment,maintenance:addMaintenance})[kind]?.(state[kind].find(x=>x.id===key));
    if(action==="delete")removeRecord(kind,key);
    if(action==="tenant-close")closeTenant(key);
    if(action==="invoice-run")issueInvoices();
    if(action==="lease-print")printLease(key);
    if(action==="receipt-print")printReceipt(key);
    if(action==="invoice-print")printInvoice(key);
    if(action==="inspection-print")printInspection(key);
    if(action==="sign")signInspection(key,button.dataset.role);
    if(action==="inspection-finalize")finalizeInspection(key);
    if(action==="photo-delete")await deletePhoto(button.dataset.inspection,key);
    if(action==="report-print")window.print();
    if(action==="export")await exportData();
    if(action==="logout")await disconnect();
  } catch(error){toast(error.message||"Action impossible.");}
});
document.querySelectorAll(".nav-parent").forEach(button=>button.onclick=()=>{const open=button.parentElement.classList.toggle("open");button.setAttribute("aria-expanded",String(open));});
$("#menuToggle").onclick=()=>$("#sidebar").classList.add("open");
$("#sidebarClose").onclick=()=>$("#sidebar").classList.remove("open");
$("#ownerChip").onclick=()=>navigate("settings");
$("#logoutBtn").onclick=()=>disconnect().catch(error=>toast(error.message||"Déconnexion impossible"));
$("#notificationsBtn").onclick=()=>{const panel=$("#notificationsPanel");panel.hidden=!panel.hidden;$("#notificationsBtn").setAttribute("aria-expanded",String(!panel.hidden));};
$("#modalClose").onclick=$("#modalCancel").onclick=closeModal;
$("#modalBackdrop").onclick=event=>{if(event.target===event.currentTarget)closeModal();};
$("#syncBtn").onclick=async()=>{if(currentFlush)await currentFlush;if(dirty)await flush();else try{await loadState();toast("Données actualisées");}catch(error){toast(error.message);}};
let deferredInstall;
addEventListener("beforeinstallprompt",event=>{event.preventDefault();deferredInstall=event;$("#installBtn").hidden=false;});
$("#installBtn").onclick=()=>installApp();
$("#helpBtn").onclick=()=>{const panel=$("#helpPanel");panel.hidden=!panel.hidden;$("#helpBtn").setAttribute("aria-expanded",String(!panel.hidden));};
addEventListener("appinstalled",()=>{deferredInstall=null;$("#installBtn").textContent="Installée ✓";});
const propertyColors=[["#176a61","Vert"],["#346aab","Bleu"],["#8061a4","Violet"],["#b96b21","Orange"],["#aa4e75","Rose"],["#526675","Ardoise"]];
const propertyColor=p=>/^#[0-9a-f]{6}$/i.test(p?.color||"")?p.color:propertyColors[Math.max(0,state.properties.findIndex(x=>x.id===p?.id))%propertyColors.length][0];
const propertyPhotoUrl=p=>`/api/photo?property=${encodeURIComponent(p.id)}&id=${encodeURIComponent(p.photo.id)}`;
const forceButton=(kind,key)=>isAdmin()?`<button class="btn danger small" data-action="force-delete" data-kind="${kind}" data-id="${h(key)}">Suppression administrateur</button>`:"";
const filterLabels={expiring:"Baux expirés ou à échéance sous 90 jours",missingTenant:"Logements occupés sans bail",missingEntry:"Entrées non signées",drafts:"Constats en brouillon",occupied:"Logements occupés",month:"Encaissements du mois",remaining:"Loyers du mois à percevoir",open:"Interventions ouvertes"};
function filteredRecords(kind){
  const snap=portfolioSnapshot();
  if(currentFilter==="expiring"&&kind==="tenants")return snap.leases;
  if(currentFilter==="missingTenant"&&kind==="units")return snap.missingTenant;
  if(currentFilter==="occupied"&&kind==="units")return snap.occupied;
  if(currentFilter==="remaining"&&kind==="tenants")return snap.remaining.map(x=>x.t);
  if(currentFilter==="drafts"&&kind==="inspections")return state.inspections.filter(x=>!x.finalizedAt);
  if(currentFilter==="month"&&kind==="payments")return state.payments.filter(x=>x.month===monthKey());
  if(currentFilter==="open"&&kind==="maintenance")return state.maintenance.filter(x=>x.status!=="Terminé");
  return state[kind];
}
function missingEntryView(){
  return shell("Entrées à finaliser","Ouvrez le constat existant ou créez celui du locataire.",back("inspections"),table(["Locataire","Logement","État d’entrée"],portfolioSnapshot().missingEntry.map(t=>{
    const i=state.inspections.find(x=>x.tenantId===t.id&&x.type==="Entrée");
    return {search:t.name,cells:[linked("tenants",t.id,t.name),linked("units",t.unitId,unit(t.unitId)?.name),i?linked("inspections",i.id,"Ouvrir le brouillon"): `<button class="btn primary small" data-action="inspection-add" data-tenant="${h(t.id)}" data-type="Entrée">Créer le constat</button>`]};
  })));
}
function maintenanceDetail(m){
  if(!m)return empty("Intervention introuvable");
  return shell(m.title,`${m.category} · ${dateFr(m.date)}`,`${back("maintenance")}${actions("maintenance",m.id)}`,`<div class="card"><p>Logement : ${linked("units",m.unitId,unit(m.unitId)?.name)}</p><p>Priorité : ${badge(m.priority)} · Statut : ${badge(m.status)}</p><p>Coût : ${money(m.cost)}</p></div>`);
}
function completeLease(key){
  const t=tenant(key);if(!t)return;
  openModal("Compléter le contrat de bail",`<p>Ces textes seront enregistrés dans le dossier et imprimés à la fin du bail.</p>`+fields([
    {name:"leaseNotes",label:"Conditions particulières",type:"textarea",full:true},
    {name:"leaseManual",label:"Éléments ajoutés manuellement",type:"textarea",full:true},
    {name:"manualLines",label:"Lignes pour des ajouts manuscrits sur papier",type:"select",options:choices(["2","5","8","12"])}
  ],{manualLines:"5",...t}),data=>{Object.assign(t,data);persist();toast("Compléments du bail enregistrés");});
}
function forceDeleteDialog(kind,key){
  requireAdmin();const record=state[kind]?.find(x=>x.id===key);if(!record)return;
  const plan=deletionPlan(state,kind,key),labels={properties:"propriété(s)",units:"logement(s)",tenants:"locataire(s)",payments:"paiement(s)",invoices:"facture(s)",inspections:"état(s) des lieux",maintenance:"intervention(s)"};
  openModal("Suppression définitive — administrateur",`<div class="delete-warning"><h3>${h(record.name||record.title||record.number||"Dossier sélectionné")}</h3><p>Cette suppression efface aussi les éléments rattachés ci-dessous, même si le logement est occupé ou le constat signé. Elle est irréversible.</p><ul>${Object.entries(plan.counts).filter(([,n])=>n).map(([k,n])=>`<li>${n} ${labels[k]}</li>`).join("")}<li>${plan.photos.length} photo(s)</li></ul></div><button type="button" class="btn secondary" data-action="export">Télécharger une sauvegarde avant suppression</button>${kind==="properties"&&!record.archived&&!state.units.some(u=>u.propertyId===key&&u.status==="occupied")?`<button type="button" class="btn secondary" data-action="archive" data-id="${h(key)}">Archiver en conservant l’historique</button>`:""}<div class="field spaced"><label for="deleteConfirm">Saisissez SUPPRIMER pour confirmer</label><input id="deleteConfirm" name="confirmation" required pattern="SUPPRIMER" autocomplete="off"></div>`,async data=>{
    if(data.confirmation!=="SUPPRIMER")throw Error("Saisissez exactement SUPPRIMER.");
    if(!await flush())throw Error("Synchronisez les données avant de supprimer.");
    const response=await fetch("/api/force-delete",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({kind,id:key,baseRev:rev,confirmation:data.confirmation})});
    const result=await response.json();if(!response.ok)throw Error(result.error||"Suppression impossible.");
    state=normalize(result.payload);rev=result.rev;dirty=false;setSync("Synchronisé",true);navigate(kind);toast(result.warning||"Suppression effectuée.");
  });
  const submit=$("#modalForm").querySelector('[type="submit"]');submit.textContent="Supprimer définitivement";submit.className="btn danger";
}
async function scaledPhoto(file){
  if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw Error("Choisissez une image JPEG, PNG ou WebP.");
  if(file.size<=3_000_000)return file;
  if(file.size>25_000_000)throw Error("Image limitée à 25 Mo avant adaptation.");
  const bitmap=await createImageBitmap(file),ratio=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement("canvas");canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);
  canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.82));
  if(!blob||blob.size>3_000_000)throw Error("Photo trop volumineuse. Choisissez une image plus petite.");return blob;
}
async function savePropertyPhoto(key,file){
  const image=await scaledPhoto(file);
  if(!await flush())throw Error("Enregistrez la propriété avant d’ajouter sa photo.");
  const response=await fetch(`/api/photo?property=${encodeURIComponent(key)}&rev=${rev}`,{method:"POST",credentials:"same-origin",headers:{"content-type":image.type},body:image});
  const data=await response.json();if(!response.ok)throw Error(data.error||"Photo non enregistrée.");
  state=normalize(data.payload);rev=data.rev;render();toast("Photo enregistrée");
}
async function removePropertyPhoto(key){
  const p=property(key);if(!p?.photo||!confirm("Retirer la photo de cette propriété ?"))return;
  if(!await flush())throw Error("Synchronisez avant de retirer la photo.");
  const response=await fetch(`${propertyPhotoUrl(p)}&rev=${rev}`,{method:"DELETE",credentials:"same-origin"});
  const data=await response.json();if(!response.ok)throw Error(data.error||"Suppression impossible.");
  state=normalize(data.payload);rev=data.rev;render();
}
function importsView(){
  return shell("Importer vos données Excel","Préparez vos données, contrôlez l’aperçu, puis validez.","",`<div class="workflow"><span class="done">1 · Modèle vierge</span><span>2 · Vos données</span><span>3 · Vérification et import</span></div><div class="grid-2"><div class="card"><h3>Préparer le fichier</h3><p>Le modèle contient cinq feuilles : propriétés, logements, locataires, échéances et paiements. Remplissez uniquement les feuilles utiles.</p><a class="btn primary" href="/imports/GestiLoc_Dbz_Modele_Import.xlsx" download>Télécharger les modèles Excel</a><p>Chaque ligne porte un code unique. Réutilisez ce code pour modifier la même fiche sans la créer une seconde fois.</p><button class="btn secondary" data-action="import-codes">Télécharger les codes des fiches existantes</button></div><div class="card"><h3>Choisir le classeur</h3><p>Les états Payé, Partiel et Impayé sont calculés à partir des montants dus et réellement reçus. Le statut attendu du modèle permet de vérifier vos totaux.</p><label class="btn primary file-label">Sélectionner le fichier Excel<input id="excelFile" type="file" accept=".xlsx" hidden></label><p class="muted">Format .xlsx · 5 Mo maximum · 2 000 lignes par feuille et par import. Aucun enregistrement avant votre validation.</p></div></div><div class="card spaced"><h3>Comment relier les données ?</h3><p>Recopiez le code de la propriété dans ses logements, puis le code du logement dans le locataire. Pour une échéance ou un paiement, utilisez le code du locataire.</p><p>Dates : AAAA-MM-JJ. Mois de loyer : AAAA-MM. Montants : nombres entiers en FCFA. Les photos se joignent directement aux fiches.</p><p>Pour une mise à jour, les colonnes du modèle remplacent leurs valeurs actuelles, y compris les cellules vides. Les constats, photos et signatures restent attachés aux dossiers.</p></div>`);
}
async function previewExcelImport(event){
  const file=event.target.files[0];event.target.value="";if(!file)return;
  try{
    if(!/\.xlsx$/i.test(file.name)||file.size>5_000_000)throw Error("Choisissez un fichier .xlsx de 5 Mo maximum.");
    toast("Lecture du classeur…");
    const sheets=await readExcelFile(file);
    if(!await flush())throw Error("Synchronisez les changements avant d’importer.");
    const previewRev=rev,result=prepareImport(sheets,state);
    const rows=result.changes;
    openModal("Vérifier l’import Excel",`<p>${rows.filter(x=>x.action==="Ajouter").length} ajout(s) · ${rows.filter(x=>x.action==="Mettre à jour").length} mise(s) à jour · ${rows.filter(x=>x.action==="Identique").length} identique(s).</p>${result.errors.length?`<div class="delete-warning"><strong>${result.errors.length} erreur(s) à corriger. Aucune donnée ne sera importée.</strong><ul>${result.errors.slice(0,50).map(error=>`<li>${h(error)}</li>`).join("")}</ul>${result.errors.length>50?"<p>Les 50 premières erreurs sont affichées.</p>":""}</div>`:"<p>Contrôlez les lignes ci-dessous avant de confirmer. Les fiches absentes du classeur seront conservées.</p>"}<div class="table-wrap import-preview"><table><thead><tr><th>Type</th><th>Code</th><th>Élément</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${h(r.sheet)}</td><td>${h(r.code)}</td><td>${h(r.label)}</td><td>${h(r.action)}</td></tr>`).join("")}</tbody></table></div>`,async()=>{
      if(result.errors.length)throw Error("Corrigez les erreurs avant l’import.");
      if(dirty||rev!==previewRev)throw Error("Les données ont changé. Fermez puis sélectionnez de nouveau le fichier.");
      const response=await api("PUT",{payload:result.payload,baseRev:previewRev});
      const saved=await response.json();
      if(!response.ok)throw Error(response.status===409?"Un autre appareil a modifié les données. Actualisez puis relancez l’import.":saved.error||"Import non enregistré.");
      state=normalize(result.payload);rev=saved.rev;dirty=false;setSync("Synchronisé",true);navigate("imports");toast("Import enregistré. Retrouvez les fiches dans leurs menus.");
    });
    const submit=$("#modalForm").querySelector('[type="submit"]');submit.textContent="Confirmer l’import";submit.disabled=!!result.errors.length;
  }catch(error){toast(error.message||"Lecture du fichier impossible.");}
}
function downloadImportCodes(){
  const csvCell=value=>`"${String(value??"").replace(/^[=+@-]/,"'$&").replace(/"/g,'""')}"`;
  const rows=[["Type","Code","Nom ou référence","Code lié"],...importSchemas.flatMap(s=>state[s.kind].map(r=>[s.label,r.importCode||r.id,r.name||r.number||r.month,r.propertyId?(property(r.propertyId)?.importCode||r.propertyId):r.tenantId?(tenant(r.tenantId)?.importCode||r.tenantId):r.unitId?(unit(r.unitId)?.importCode||r.unitId):""]))];
  const url=URL.createObjectURL(new Blob(["\ufeff"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n")],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download="GestiLoc_Dbz_Codes.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function installApp(){
  if(window.matchMedia?.("(display-mode: standalone)").matches||navigator.standalone)return toast("GestiLoc Dbz est déjà ouverte en application.");
  if(deferredInstall){const prompt=deferredInstall;deferredInstall=null;await prompt.prompt();const result=await prompt.userChoice;if(result.outcome==="accepted")toast("Installation demandée au téléphone.");return;}
  openModal("Installer GestiLoc Dbz sur le téléphone",`<div class="install-guide"><h3>iPhone ou iPad</h3><p>Ouvrez ce site dans Safari. Appuyez sur Partager, puis « Sur l’écran d’accueil » et « Ajouter ».</p><h3>Android</h3><p>Ouvrez ce site dans Chrome ou Edge. Dans le menu ⋮, choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».</p><p>Une icône GestiLoc Dbz ouvrira directement votre espace. Si la session a expiré, connectez-vous avec votre email et votre mot de passe.</p><p class="muted">Une connexion internet reste nécessaire pour enregistrer les données et consulter les photos privées.</p></div>`,()=>{});
  $("#modalForm").querySelector('[type="submit"]').textContent="J’ai compris";
}
const helpTopics=[
  ["Ajouter mon premier bien","Créez une propriété, puis ajoutez ses logements. Choisissez leur composition et leurs équipements.","properties","Ouvrir les propriétés"],
  ["Préparer un bail","Ouvrez le logement puis « Continuer : locataire et bail ». Le contrat reprend les données de vos fiches. « Compléter le bail » permet d’ajouter votre texte.","units","Choisir un logement"],
  ["Faire un état des lieux","Choisissez le locataire et le type de constat. Renseignez les états, observations et photos, puis recueillez les deux signatures.","inspections","Ouvrir les constats"],
  ["Enregistrer un loyer","Indiquez le mois, le montant reçu et le mode de paiement. Les soldes et les alertes se mettent à jour.","payments","Ouvrir les paiements"],
  ["Suivre mes échéances","Les notifications ouvrent le dossier concerné et disparaissent après consultation. Les Points à suivre restent disponibles sur l’accueil.","dashboard","Voir les points à suivre"],
  ["Importer depuis Excel","Téléchargez le modèle, renseignez vos données réelles, puis vérifiez l’aperçu avant de confirmer.","imports","Ouvrir les imports"],
  ["Installer sur mon téléphone","Ajoutez une icône à l’écran d’accueil pour retrouver rapidement l’application.","settings","Ouvrir l’installation"]
];
$("#helpPanel").innerHTML=`<h3>Comment puis-je vous aider ?</h3>${helpTopics.map(([title,text,view,label])=>`<details class="help-bubble"><summary>${h(title)}</summary><p>${h(text)}</p><button class="btn small primary" data-view="${view}">${h(label)} →</button></details>`).join("")}`;
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
initialize();
