import { getUser, login, signup, logout, handleAuthCallback, requestPasswordRecovery, acceptInvite, updateUser, getSettings } from "@netlify/identity";

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
let dirty = false, currentFlush = null, syncTimer = null, authMode = "login", inviteToken = null, allowSignup = true;
const titles = {dashboard:"Vue d'ensemble",properties:"Propriétés",units:"Logements",tenants:"Locataires",leases:"Contrats de bail",payments:"Paiements",invoices:"Factures mensuelles",inspections:"États des lieux",maintenance:"Travaux",reports:"Rapports",settings:"Paramètres"};
const property = (key) => state.properties.find(x => x.id === key);
const unit = (key) => state.units.find(x => x.id === key);
const tenant = (key) => state.tenants.find(x => x.id === key);
const paid = (tenantId, month = monthKey()) => state.payments.filter(p => p.tenantId === tenantId && p.month === month).reduce((sum,p) => sum + Number(p.amount || 0),0);
const activeUnits = () => state.units.filter(x => x.status === "occupied" && x.tenantId);
const expected = () => activeUnits().reduce((sum,u) => sum + Number(u.rent || 0),0);
const collected = () => state.payments.filter(p => p.month === monthKey()).reduce((sum,p) => sum + Number(p.amount || 0),0);
const badge = (value) => `<span class="status ${/payé|occupé|terminé|signé|actif/i.test(value)?"good":/retard|impayé|urgent/i.test(value)?"bad":/partiel|travaux|cours|signalé|brouillon|à payer/i.test(value)?"warn":"info"}">${h(value)}</span>`;
const linked = (kind, key, label) => `<button class="link-button" type="button" data-open="${kind}" data-id="${h(key)}">${h(label || "—")}</button>`;
const shell = (title, subtitle, actions = "", body = "") => `<div class="hero"><div><h2>${h(title)}</h2><p>${h(subtitle)}</p></div><div class="actions">${actions}</div></div>${body}`;
const empty = (message) => `<div class="card empty-state"><strong>${h(message)}</strong><p>Utilisez le bouton ci-dessus pour commencer.</p></div>`;
const actions = (kind, key, allowDelete = true) => `<button class="btn small secondary" data-action="edit" data-kind="${kind}" data-id="${h(key)}">Modifier</button>${allowDelete?`<button class="btn small danger" data-action="delete" data-kind="${kind}" data-id="${h(key)}">Supprimer</button>`:""}`;

function toast(message) { const box = $("#toast"); box.textContent = message; box.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => box.hidden = true, 4000); }
function setSync(label, online = false) { $("#syncLabel").textContent = label; $(".sync-dot").classList.toggle("online",online); }
function persist() { dirty = true; setSync("Enregistrement…"); clearTimeout(syncTimer); syncTimer = setTimeout(flush,450); render(); }
async function api(method, body) { return fetch("/api/state", { method, credentials:"same-origin", headers:{ "content-type":"application/json" }, body:body ? JSON.stringify(body) : undefined }); }
async function loadState() {
  const response = await api("GET");
  if (response.status === 401) { await requireLogin(); return false; }
  if (!response.ok) throw Error("Base de données indisponible. Vérifiez la configuration Netlify.");
  const data = await response.json(); state = normalize(data.payload); rev = Number(data.rev || 0); dirty = false;
  setSync("Synchronisé",true); render();
  if (!state.settings.ownerName && user?.name) { state.settings.ownerName = user.name; persist(); }
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
  try { allowSignup = !(await getSettings()).disableSignup; setAuthMode("login"); } catch {}
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
    else { try { allowSignup = !(await getSettings()).disableSignup; } catch {} setAuthMode("login"); }
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

function navigate(view, key = null) { currentView = view; selected = key; render(); activateNav(); $("#sidebar").classList.remove("open"); window.scrollTo(0,0); }
function activateNav() { document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active",button.dataset.view === currentView)); }
function render() {
  $("#pageTitle").textContent = titles[currentView];
  const pages = { dashboard, properties, units, tenants, leases, payments, invoices, inspections, maintenance, reports, settings:settingsView };
  $("#app").innerHTML = selected ? detail(currentView,selected) : pages[currentView]();
  updateChip();
  $("#searchInput")?.addEventListener("input",event => { const term = event.target.value.toLowerCase(); document.querySelectorAll("[data-search]").forEach(row => row.hidden = !row.dataset.search.toLowerCase().includes(term)); });
  $("#settingsForm")?.addEventListener("submit",event => { event.preventDefault(); state.settings = { ...state.settings, ...Object.fromEntries(new FormData(event.target)) }; persist(); toast("Paramètres enregistrés"); });
  $("#importFile")?.addEventListener("change",importData);
  $("#photoFiles")?.addEventListener("change",uploadPhotos);
  $("#cameraFile")?.addEventListener("change",uploadPhotos);
}
function updateChip() { const name = state.settings.ownerName || user?.email?.split("@")[0] || "Compte"; $("#ownerChip").innerHTML = `<span>${h(name.split(/\s+/).map(w => w[0]).join("").slice(0,2).toUpperCase())}</span><div><strong>${h(name)}</strong><small>${h(user?.email || "")}</small></div>`; }
function table(headers, rows) { return `<div class="card table-card"><div class="toolbar"><div class="search"><span>⌕</span><input id="searchInput" aria-label="Rechercher" placeholder="Rechercher dans la liste"></div><span class="card-sub">${rows.length} élément(s)</span></div><div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${h(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr data-search="${h(r.search)}">${r.cells.map(x=>`<td>${x}</td>`).join("")}</tr>`).join("")||`<tr><td class="empty" colspan="${headers.length}">Aucune donnée pour le moment.</td></tr>`}</tbody></table></div></div>`; }
function dashboard() {
  const occupied = activeUnits(), due = expected(), received = collected();
  const late = occupied.map(u=>({u,t:tenant(u.tenantId),balance:Math.max(0,u.rent-paid(u.tenantId))})).filter(x=>x.balance>0);
  return shell("Votre patrimoine",`Situation au ${dateFr(today())}`,`<button class="btn primary" data-view="properties">+ Ajouter une propriété</button>`,`<div class="kpi-grid">
    <div class="kpi"><p>Logements occupés</p><strong>${occupied.length}/${state.units.length}</strong><small>${state.units.length?Math.round(occupied.length/state.units.length*100):0}% d'occupation</small></div>
    <div class="kpi"><p>Encaissements du mois</p><strong>${money(received)}</strong><small>Sur ${money(due)} attendus</small></div>
    <div class="kpi danger"><p>Reste à percevoir</p><strong>${money(Math.max(0,due-received))}</strong><small>${late.length} dossier(s) à suivre</small></div>
    <div class="kpi warning"><p>Travaux ouverts</p><strong>${state.maintenance.filter(m=>m.status!=="Terminé").length}</strong></div>
  </div><div class="grid-2"><div class="card"><h3>Locataires et loyers du mois</h3>${late.length?late.map(x=>`<div class="quick-row">${linked("tenants",x.t?.id,x.t?.name)}<span>${money(x.balance)} à percevoir</span></div>`).join(""):`<p class="muted">${occupied.length?"Aucun solde à percevoir.":"Ajoutez un logement et un locataire pour commencer."}</p>`}</div><div class="card"><h3>Actions rapides</h3><div class="quick-actions"><button class="btn secondary" data-action="tenant-add">+ Locataire</button><button class="btn secondary" data-action="payment-add">+ Paiement</button><button class="btn secondary" data-action="inspection-add">+ État des lieux</button></div></div></div>`);
}
function properties() { return shell("Propriétés","Vos biens immobiliers et leurs logements.",`<button class="btn primary" data-action="property-add">+ Propriété</button>`,state.properties.length?`<div class="property-grid">${state.properties.map(p=>{const list=state.units.filter(u=>u.propertyId===p.id),occ=list.filter(u=>u.status==="occupied");return `<article class="property-card"><div class="property-cover"><span>${h(p.type)}</span>${badge(`${occ.length}/${list.length} occupés`)}</div><div class="property-card-body"><h3>${linked("properties",p.id,p.name)}</h3><p>📍 ${h(p.address||p.district||state.settings.city)}</p><div class="property-stats"><div><strong>${list.length}</strong><span>Logements</span></div><div><strong>${occ.length}</strong><span>Occupés</span></div><div><strong>${list.length-occ.length}</strong><span>Non occupés</span></div></div><p class="card-amount">${money(occ.reduce((n,u)=>n+Number(u.rent),0))} / mois</p>${actions("properties",p.id)}</div></article>`}).join("")}</div>`:empty("Aucune propriété enregistrée")); }
function units() { return shell("Logements","Cliquez sur un nom pour ouvrir le dossier.",`<button class="btn primary" data-action="unit-add">+ Logement</button>`,table(["Logement","Propriété","Type","Loyer","Statut","Locataire",""],state.units.map(u=>({search:`${u.name} ${property(u.propertyId)?.name} ${tenant(u.tenantId)?.name}`,cells:[linked("units",u.id,u.name),linked("properties",u.propertyId,property(u.propertyId)?.name),h(u.type),money(u.rent),badge(u.status==="occupied"?"Occupé":u.status==="works"?"En travaux":"Vacant"),u.tenantId?linked("tenants",u.tenantId,tenant(u.tenantId)?.name):"—",actions("units",u.id)]})))); }
function tenants() { return shell("Locataires","Du bail d'entrée à la sortie du logement.",`<button class="btn primary" data-action="tenant-add">+ Locataire</button>`,table(["Locataire","Téléphone","Logement","Entrée","Sortie","Situation",""],state.tenants.map(t=>({search:`${t.name} ${t.phone} ${unit(t.unitId)?.name}`,cells:[linked("tenants",t.id,t.name),h(t.phone),linked("units",t.unitId,unit(t.unitId)?.name),dateFr(t.start),dateFr(t.end),badge(t.end?"Sorti":paid(t.id)>=Number(unit(t.unitId)?.rent||0)?"Payé":paid(t.id)>0?"Partiel":"À suivre"),actions("tenants",t.id,false)]})))); }
function leases() { return shell("Contrats de bail","Contrats préremplis à partir des dossiers locataires.","",table(["Locataire","Logement","Entrée","Fin prévue","Loyer","Contrat"],state.tenants.map(t=>({search:`${t.name} ${unit(t.unitId)?.name}`,cells:[linked("tenants",t.id,t.name),linked("units",t.unitId,unit(t.unitId)?.name),dateFr(t.start),dateFr(t.leaseEnd),money(unit(t.unitId)?.rent),`<button class="btn small secondary" data-action="lease-print" data-id="${h(t.id)}">Afficher / imprimer</button>`]})))); }
function payments() { return shell("Paiements","Historique des règlements avec leur mode et référence.",`<button class="btn primary" data-action="payment-add">+ Paiement</button>`,table(["Date","Locataire","Logement","Période","Montant","Mode / référence",""],[...state.payments].sort((a,b)=>b.date.localeCompare(a.date)).map(p=>({search:`${tenant(p.tenantId)?.name} ${p.method} ${p.reference||""}`,cells:[dateFr(p.date),linked("tenants",p.tenantId,tenant(p.tenantId)?.name),linked("units",p.unitId,unit(p.unitId)?.name),h(p.month),money(p.amount),`${h(p.method)}${p.reference?`<br><small>${h(p.reference)}</small>`:""}`,`<button class="btn small secondary" data-action="receipt-print" data-id="${h(p.id)}">Reçu</button>${actions("payments",p.id)}`]})))); }
function invoices() { return shell("Factures mensuelles","Émettez une facture par logement occupé et par mois.",`<button class="btn primary" data-action="invoice-run">Émettre ce mois</button>`,table(["N°","Locataire","Logement","Période","Montant","Statut",""],state.invoices.map(i=>({search:`${i.number} ${tenant(i.tenantId)?.name}`,cells:[h(i.number),linked("tenants",i.tenantId,tenant(i.tenantId)?.name),linked("units",i.unitId,unit(i.unitId)?.name),h(i.month),money(i.amount),badge(paid(i.tenantId,i.month)>=i.amount?"Payée":"À payer"),`<button class="btn small secondary" data-action="invoice-print" data-id="${h(i.id)}">Imprimer</button>`]})))); }
function inspections() { return shell("États des lieux","Constats d'entrée et de sortie avec photos et signatures.",`<button class="btn primary" data-action="inspection-add">+ État des lieux</button>`,table(["Date","Type","Locataire","Logement","Statut",""],state.inspections.map(i=>({search:`${tenant(i.tenantId)?.name} ${unit(i.unitId)?.name} ${i.type}`,cells:[dateFr(i.date),h(i.type),linked("tenants",i.tenantId,tenant(i.tenantId)?.name),linked("units",i.unitId,unit(i.unitId)?.name),badge(i.finalizedAt?"Signé":"Brouillon"),`<button class="btn small secondary" data-open="inspections" data-id="${h(i.id)}">Ouvrir</button>`]})))); }
function maintenance() { return shell("Travaux","Incidents, interventions et dépenses.",`<button class="btn primary" data-action="maintenance-add">+ Intervention</button>`,table(["Intervention","Logement","Priorité","Coût","Statut",""],state.maintenance.map(m=>({search:`${m.title} ${unit(m.unitId)?.name}`,cells:[h(m.title),linked("units",m.unitId,unit(m.unitId)?.name),badge(m.priority),money(m.cost),badge(m.status),actions("maintenance",m.id)]})))); }
function reports() { const due=expected(),got=collected(),cost=state.maintenance.filter(m=>m.date?.startsWith(monthKey())).reduce((n,m)=>n+Number(m.cost||0),0); return shell("Rapports",`Indicateurs du mois ${monthKey()}.`,`<button class="btn secondary" data-action="report-print">Imprimer</button>`,`<div class="report-grid"><div class="report-tile"><span>Taux de recouvrement</span><strong>${due?Math.round(got/due*100):0}%</strong></div><div class="report-tile"><span>Encaissements moins travaux</span><strong>${money(got-cost)}</strong></div><div class="report-tile"><span>Travaux du mois</span><strong>${money(cost)}</strong></div></div>${table(["Propriété","Logements","Occupés","Loyers attendus"],state.properties.map(p=>{const all=state.units.filter(u=>u.propertyId===p.id),occ=all.filter(u=>u.status==="occupied");return {search:p.name,cells:[linked("properties",p.id,p.name),String(all.length),String(occ.length),money(occ.reduce((n,u)=>n+Number(u.rent),0))]}}))}`); }
function settingsView() { const s=state.settings; return shell("Paramètres","Coordonnées du bailleur, documents et sauvegardes.","",`<div class="card"><form id="settingsForm">${fields([{name:"ownerName",label:"Nom du propriétaire",required:true},{name:"company",label:"Société ou gestionnaire"},{name:"phone",label:"Téléphone"},{name:"email",label:"E-mail de contact",type:"email"},{name:"address",label:"Adresse du bailleur",full:true},{name:"city",label:"Ville"},{name:"leaseClauses",label:"Clauses complémentaires du bail (à relire avant signature)",type:"textarea",full:true}],s)}<button class="btn primary" type="submit">Enregistrer</button></form></div><div class="card spaced"><h3>Compte et données</h3><p class="muted">Compte connecté : ${h(user?.email)}. Les données sont enregistrées dans votre espace Netlify.</p><div class="actions"><button class="btn secondary" data-action="export">Exporter JSON</button><label class="btn secondary file-label">Importer JSON<input type="file" id="importFile" accept="application/json" hidden></label><button class="btn secondary" data-action="logout">Se déconnecter</button></div></div><div class="card spaced"><h3>Installer sur téléphone</h3><p>Android : menu Chrome ou Edge → Installer l’application. iPhone : Safari → Partager → Sur l’écran d’accueil.</p></div>`); }

function detail(view,key) {
  if (view === "properties") return propertyDetail(property(key));
  if (view === "units") return unitDetail(unit(key));
  if (view === "tenants") return tenantDetail(tenant(key));
  if (view === "inspections") return inspectionDetail(state.inspections.find(i=>i.id===key));
  return ( {dashboard, properties, units, tenants, leases, payments, invoices, inspections, maintenance, reports, settings:settingsView}[view] )();
}
const back = (view) => `<button class="btn secondary" data-view="${view}">← Retour à la liste</button>`;
function propertyDetail(p) {
  if (!p) return empty("Propriété introuvable");
  const unitsHere=state.units.filter(u=>u.propertyId===p.id);
  return shell(p.name,`${p.address||p.district||""} · ${p.type}`,`${back("properties")}<button class="btn primary" data-action="unit-add" data-property="${h(p.id)}">+ Logement</button>`,`<div class="card"><h3>Fiche du bien</h3><p>${h(p.address||"Adresse non renseignée")}</p><p>Quartier : ${h(p.district||"—")}</p></div><div class="card spaced"><h3>Logements (${unitsHere.length})</h3>${unitsHere.length?unitsHere.map(u=>`<div class="quick-row">${linked("units",u.id,u.name)}<span>${money(u.rent)} · ${badge(u.status==="occupied"?"Occupé":u.status==="works"?"En travaux":"Vacant")}</span></div>`).join(""):`<p class="muted">Aucun logement dans ce bien.</p>`}</div>`);
}
function unitDetail(u) {
  if (!u) return empty("Logement introuvable");
  const t=tenant(u.tenantId), history=state.tenants.filter(x=>x.unitId===u.id);
  return shell(u.name,`${property(u.propertyId)?.name||"Propriété"} · ${money(u.rent)} / mois`,`${back("units")}<button class="btn secondary" data-action="edit" data-kind="units" data-id="${h(u.id)}">Modifier</button>`,`<div class="detail-grid"><div class="card"><h3>Logement</h3><p>Propriété : ${linked("properties",u.propertyId,property(u.propertyId)?.name)}</p><p>Type : ${h(u.type)}</p><p>Loyer : ${money(u.rent)} · Charges : ${money(u.charges)}</p><p>Statut : ${badge(u.status==="occupied"?"Occupé":u.status==="works"?"En travaux":"Vacant")}</p></div><div class="card"><h3>Occupation</h3>${t?`<p>Locataire actuel : ${linked("tenants",t.id,t.name)}</p><p>Entrée : ${dateFr(t.start)}</p>`:`<p class="muted">Aucun locataire actuel.</p><button class="btn primary" data-action="tenant-add" data-unit="${h(u.id)}">Ajouter un locataire</button>`}</div></div><div class="card spaced"><h3>Historique des occupants</h3>${history.length?history.map(x=>`<div class="quick-row">${linked("tenants",x.id,x.name)}<span>${dateFr(x.start)} → ${dateFr(x.end)}</span></div>`).join(""):`<p class="muted">Aucun occupant enregistré.</p>`}</div>`);
}
function tenantDetail(t) {
  if (!t) return empty("Locataire introuvable");
  const u=unit(t.unitId), p=property(u?.propertyId), paymentsHere=state.payments.filter(x=>x.tenantId===t.id).sort((a,b)=>b.date.localeCompare(a.date)), inspectionsHere=state.inspections.filter(x=>x.tenantId===t.id).sort((a,b)=>a.date.localeCompare(b.date));
  const entry=inspectionsHere.find(i=>i.type==="Entrée"), exit=inspectionsHere.find(i=>i.type==="Sortie");
  return shell(t.name,`${t.end?"Location clôturée":"Location en cours"} · ${u?.name||"Logement supprimé"}`,`${back("tenants")}<button class="btn secondary" data-action="edit" data-kind="tenants" data-id="${h(t.id)}">Modifier</button>`,`<div class="detail-grid"><div class="card"><h3>Coordonnées et bail</h3><p>Téléphone : <a href="tel:${h(t.phone)}">${h(t.phone)}</a></p><p>E-mail : ${t.email?`<a href="mailto:${h(t.email)}">${h(t.email)}</a>`:"—"}</p><p>Pièce d'identité : ${h(t.identityNumber||"—")}</p><p>Logement : ${linked("units",t.unitId,u?.name)}</p><p>Bien : ${linked("properties",p?.id,p?.name)}</p><p>Entrée : ${dateFr(t.start)} · Fin prévue : ${dateFr(t.leaseEnd)}</p><p>Loyer : ${money(u?.rent)} · Charges : ${money(u?.charges)} · Dépôt : ${money(t.deposit)}</p><p>Échéance : le ${h(t.dueDay||1)} de chaque mois</p><button class="btn primary" data-action="lease-print" data-id="${h(t.id)}">Contrat de bail prérempli</button></div><div class="card"><h3>Parcours du locataire</h3><ol class="journey"><li>${badge("Entrée")} ${dateFr(t.start)}</li><li>${entry?linked("inspections",entry.id,"État des lieux d'entrée"):!t.end?`<button class="link-button" data-action="inspection-add" data-tenant="${h(t.id)}" data-type="Entrée">Créer l'état des lieux d'entrée</button>`:"État d'entrée non enregistré"}</li><li>${paymentsHere.length} paiement(s) enregistrés</li><li>${exit?linked("inspections",exit.id,"État des lieux de sortie"):!t.end?`<button class="link-button" data-action="inspection-add" data-tenant="${h(t.id)}" data-type="Sortie">Créer l'état des lieux de sortie</button>`:"État de sortie non enregistré"}</li><li>${t.end?`Sortie le ${dateFr(t.end)}`:exit?.finalizedAt?`<button class="btn small danger" data-action="tenant-close" data-id="${h(t.id)}">Clôturer la location</button>`:"Sortie à réaliser"}</li></ol></div></div>
  <div class="detail-grid spaced"><div class="card"><div class="card-head"><h3>Paiements</h3>${t.end?"":`<button class="btn small primary" data-action="payment-add" data-tenant="${h(t.id)}">+ Paiement</button>`}</div>${paymentsHere.length?paymentsHere.map(x=>`<div class="quick-row"><span>${dateFr(x.date)} · ${h(x.month)} · ${h(x.method)}</span><strong>${money(x.amount)}</strong></div>`).join(""):`<p class="muted">Aucun paiement.</p>`}</div><div class="card"><h3>États des lieux</h3>${inspectionsHere.length?inspectionsHere.map(x=>`<div class="quick-row">${linked("inspections",x.id,`État de ${x.type.toLowerCase()}`)}<span>${dateFr(x.date)} · ${x.finalizedAt?"signé":"brouillon"}</span></div>`).join(""):`<p class="muted">Aucun état des lieux.</p>`}</div></div>`);
}
const photoUrl = (inspectionId,photoId) => `/api/photo?inspection=${encodeURIComponent(inspectionId)}&id=${encodeURIComponent(photoId)}`;
function inspectionDetail(i) {
  if (!i) return empty("État des lieux introuvable");
  const t=tenant(i.tenantId), u=unit(i.unitId), locked=!!i.finalizedAt;
  return shell(`État des lieux de ${i.type.toLowerCase()}`,`${dateFr(i.date)} · ${t?.name||"Locataire"}`,`${back("inspections")}<button class="btn primary" data-action="inspection-print" data-id="${h(i.id)}">Imprimer / PDF</button>`,`<div class="detail-grid"><div class="card"><h3>Dossier</h3><p>Locataire : ${linked("tenants",i.tenantId,t?.name)}</p><p>Logement : ${linked("units",i.unitId,u?.name)}</p><p>Date : ${dateFr(i.date)} · Clés : ${h(i.keys||"—")}</p><p>Statut : ${badge(locked?"Signé":"Brouillon")}</p><p>Observations : ${h(i.notes||"Aucune")}</p></div><div class="card"><h3>Signatures dans l'application</h3><div class="signature-grid"><div><strong>Bailleur</strong>${safeSignature(i.signatures?.landlord)?`<img src="${safeSignature(i.signatures.landlord)}" alt="Signature du bailleur">`:`<p class="muted">À signer</p>`}${locked?"":`<button class="btn small secondary" data-action="sign" data-role="landlord" data-id="${h(i.id)}">Signer</button>`}</div><div><strong>Locataire</strong>${safeSignature(i.signatures?.tenant)?`<img src="${safeSignature(i.signatures.tenant)}" alt="Signature du locataire">`:`<p class="muted">À signer</p>`}${locked?"":`<button class="btn small secondary" data-action="sign" data-role="tenant" data-id="${h(i.id)}">Signer</button>`}</div></div>${locked?`<p class="muted">Finalisé le ${dateFr(i.finalizedAt)}</p>`:`<button class="btn primary" data-action="inspection-finalize" data-id="${h(i.id)}">Finaliser après les deux signatures</button>`}</div></div>
  <div class="card spaced"><h3>Constat détaillé</h3><div class="table-wrap"><table><thead><tr><th>Élément</th><th>État</th><th>Observations</th></tr></thead><tbody>${(i.items||[]).map(x=>`<tr><td>${h(x.item)}</td><td>${badge(x.state)}</td><td>${h(x.note||"—")}</td></tr>`).join("")}</tbody></table></div></div>
  <div class="card spaced"><div class="card-head"><h3>Photos (${i.photos?.length||0})</h3>${locked?"":`<label class="btn small primary file-label">+ Prendre une photo<input id="cameraFile" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden></label><label class="btn small secondary file-label">+ Depuis le téléphone<input id="photoFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label>`}</div><div class="photo-grid">${(i.photos||[]).map(photo=>`<figure><a href="${photoUrl(i.id,photo.id)}" target="_blank" rel="noopener"><img loading="lazy" src="${photoUrl(i.id,photo.id)}" alt="${h(photo.caption||"Photo de l'état des lieux")}"></a><figcaption>${h(photo.caption||"Photo")}</figcaption>${locked?"":`<button class="btn small danger" data-action="photo-delete" data-id="${h(photo.id)}" data-inspection="${h(i.id)}">Retirer</button>`}</figure>`).join("")}</div>${!i.photos?.length?`<p class="muted">Aucune photo ajoutée.</p>`:""}</div>`);
}
function fields(list, values = {}) {
  return `<div class="form-grid">${list.map(f=>{const value=values[f.name]??f.value??"";return `<div class="field ${f.full?"full":""}"><label for="field_${f.name}">${h(f.label)}</label>${f.type==="select"?`<select id="field_${f.name}" name="${f.name}" ${f.required?"required":""}>${(f.options||[]).map(o=>`<option value="${h(o.value)}" ${String(value)===String(o.value)?"selected":""}>${h(o.label)}</option>`).join("")}</select>`:f.type==="textarea"?`<textarea id="field_${f.name}" name="${f.name}">${h(value)}</textarea>`:`<input id="field_${f.name}" name="${f.name}" type="${f.type||"text"}" value="${h(value)}" ${f.type==="number"?`min="${f.min??0}" step="1"`:""} ${f.required?"required":""}>`}</div>`}).join("")}</div>`;
}
const option = (arr, label) => arr.map(x=>({value:x.id,label:label(x)}));
const choices = (arr) => arr.map(x=>({value:x,label:x}));
function openModal(title, html, onSubmit) {
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
    {name:"name",label:"Nom de la propriété",required:true},{name:"district",label:"Quartier",required:true},
    {name:"address",label:"Adresse complète",full:true},{name:"type",label:"Type",type:"select",options:choices(["Immeuble","Villa","Maison","Local commercial","Autre"])}
  ],existing),data=>{ if(existing)Object.assign(existing,data);else state.properties.push({id:id("p"),...data});persist(); });
}
function addUnit(existing, propertyId) {
  if (!state.properties.length) return toast("Ajoutez d'abord une propriété.");
  openModal(existing?"Modifier le logement":"Ajouter un logement",fields([
    {name:"name",label:"Nom ou référence",required:true},{name:"propertyId",label:"Propriété",type:"select",options:option(state.properties,p=>p.name),required:true},
    {name:"type",label:"Type",type:"select",options:choices(["Studio","Appartement","Villa","Boutique","Bureau","Autre"])},
    {name:"rent",label:"Loyer mensuel (FCFA)",type:"number",min:1,required:true},{name:"charges",label:"Charges mensuelles (FCFA)",type:"number"},
    ...(existing?.tenantId?[]:[{name:"status",label:"Statut",type:"select",options:[{value:"vacant",label:"Vacant"},{value:"works",label:"En travaux"}]}])
  ],existing||{propertyId,status:"vacant"}),data=>{ const values={...data,rent:Number(data.rent),charges:Number(data.charges||0)}; if(existing)Object.assign(existing,values);else state.units.push({id:id("u"),tenantId:null,...values});persist(); });
}
function addTenant(existing, unitId) {
  const available=state.units.filter(u=>!u.tenantId || u.id===existing?.unitId);
  if (!available.length && !existing) return toast("Ajoutez d'abord un logement disponible.");
  openModal(existing?"Modifier le locataire":"Ajouter un locataire",fields([
    {name:"name",label:"Nom et prénom",required:true},{name:"phone",label:"Téléphone",required:true},
    {name:"email",label:"E-mail",type:"email"},{name:"identityNumber",label:"N° de pièce d'identité"},
    {name:"unitId",label:"Logement",type:"select",options:option(available,u=>`${u.name} · ${money(u.rent)}`),required:true},
    {name:"start",label:"Date d'entrée",type:"date",required:true},{name:"leaseEnd",label:"Fin prévue du bail",type:"date"},
    {name:"deposit",label:"Dépôt de garantie (FCFA)",type:"number"},{name:"dueDay",label:"Jour d'échéance du loyer",type:"number",min:1},
    {name:"purpose",label:"Usage",type:"select",options:choices(["Habitation","Professionnel","Commercial"])},
    {name:"leaseNotes",label:"Conditions particulières",type:"textarea",full:true}
  ],existing||{unitId,start:today(),dueDay:1,purpose:"Habitation"}),data=>{
    if(Number(data.dueDay)>31)throw Error("Le jour d'échéance doit être compris entre 1 et 31.");
    if(existing?.end && data.unitId!==existing.unitId)throw Error("Un dossier clôturé conserve son logement historique.");
    if(existing && existing.unitId!==data.unitId){const old=unit(existing.unitId);if(old?.tenantId===existing.id){old.tenantId=null;old.status="vacant";}}
    const record=existing||{id:id("t")};Object.assign(record,{...data,deposit:Number(data.deposit||0),dueDay:Number(data.dueDay||1)});
    if(!existing)state.tenants.push(record);
    if(!record.end){const assigned=unit(record.unitId);assigned.tenantId=record.id;assigned.status="occupied";}
    persist();
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
const checklist=["Porte, serrure et poignée","Murs et plafonds","Sols et plinthes","Fenêtres et vitrages","Électricité et prises","Éclairage","Cuisine","Plomberie et évacuations","Sanitaires","Clés remises","Propreté générale"];
function addInspection(tenantId, preferredType = "Entrée") {
  const active=state.tenants.filter(t=>!t.end);
  if(!active.length)return toast("Ajoutez d'abord un locataire actif.");
  const selectedTenant=tenantId||active[0].id;
  const html=fields([
    {name:"tenantId",label:"Locataire",type:"select",options:option(active,t=>`${t.name} · ${unit(t.unitId)?.name||""}`),required:true},
    {name:"type",label:"Type",type:"select",options:choices(["Entrée","Sortie"])},
    {name:"date",label:"Date du constat",type:"date",required:true},
    {name:"keys",label:"Nombre de clés",type:"number"},
    {name:"notes",label:"Observations générales",type:"textarea",full:true}
  ],{tenantId:selectedTenant,type:preferredType,date:today()})+`<h3>Constat pièce par pièce</h3><div class="inspection-checklist">${checklist.map((label,n)=>`<div class="inspection-line"><strong>${h(label)}</strong><select name="condition_${n}"><option>Bon</option><option>Moyen</option><option>Mauvais</option><option>Non applicable</option></select><input name="note_${n}" placeholder="Observation précise"></div>`).join("")}</div>`;
  openModal("Nouvel état des lieux",html,async data=>{
    const t=tenant(data.tenantId);if(!t)throw Error("Locataire introuvable.");
    const record={id:id("ins"),tenantId:t.id,unitId:t.unitId,type:data.type,date:data.date,keys:data.keys,notes:data.notes,
      items:checklist.map((item,n)=>({item,state:data[`condition_${n}`],note:data[`note_${n}`]})),photos:[],signatures:{landlord:null,tenant:null},finalizedAt:null};
    state.inspections.push(record);persist();navigate("inspections",record.id);
  });
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
function removeRecord(kind,key) {
  const record=state[kind]?.find(x=>x.id===key);if(!record)return;
  if(kind==="properties"&&state.units.some(u=>u.propertyId===key))return toast("Cette propriété contient des logements.");
  if(kind==="units"&&(state.tenants.some(t=>t.unitId===key)||state.inspections.some(i=>i.unitId===key)))return toast("Ce logement fait partie de l'historique d'un locataire.");
  if(kind==="tenants")return toast("Clôturez ce locataire pour conserver son historique.");
  if(!confirm("Supprimer définitivement cet élément ?"))return;
  state[kind]=state[kind].filter(x=>x.id!==key);selected=null;persist();
}
async function uploadPhotos(event) {
  const inspection=state.inspections.find(i=>i.id===selected);
  if(!inspection||inspection.finalizedAt)return;
  const files=[...event.target.files];if(!files.length)return;
  if(!await flush())return toast("Enregistrez d'abord l'état des lieux avant d'ajouter des photos.");
  for(const file of files){
    if(file.size>3_000_000 || !["image/jpeg","image/png","image/webp"].includes(file.type)){toast(`${file.name} : image JPEG, PNG ou WebP de 3 Mo maximum.`);continue;}
    try {
      const result=await fetch(`/api/photo?inspection=${encodeURIComponent(inspection.id)}`,{method:"POST",credentials:"same-origin",headers:{"content-type":file.type},body:file});
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
  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${h(title)}</title><style>body{font:14px/1.5 Arial,sans-serif;color:#173033;margin:36px;max-width:950px}header{border-bottom:3px solid #0f3d3e;margin-bottom:24px;padding-bottom:14px}h1{margin:0 0 4px}h2{margin-top:28px}table{border-collapse:collapse;width:100%;margin:18px 0}td,th{border:1px solid #b8c7c6;padding:8px;text-align:left;vertical-align:top}th{background:#eef3f2}img.photo{width:220px;height:165px;object-fit:contain;border:1px solid #ccc;margin:5px}figure{display:inline-block;vertical-align:top;margin:8px}figcaption{max-width:220px}.signatures{display:flex;gap:40px;margin-top:40px}.signatures>div{flex:1;text-align:center}.signatures img{width:240px;max-height:90px;object-fit:contain}button{padding:10px 16px;margin:20px 0}@media print{button{display:none}body{margin:16mm}h2,figure,tr{break-inside:avoid}}</style></head><body><header><h1>${h(owner)}</h1><div>${h(state.settings.address||"")} · ${h(state.settings.city||"")}</div><div>${h(state.settings.phone||"")} ${h(state.settings.email||"")}</div></header><h2>${h(title)}</h2>${body}<button onclick="window.print()">Imprimer ou enregistrer en PDF</button></body></html>`);
  win.document.close();
}
function printLease(key) {
  const t=tenant(key),u=unit(t?.unitId),p=property(u?.propertyId);if(!t||!u)return toast("Dossier du bail incomplet.");
  const s=state.settings;
  printDocument("Contrat de bail prérempli",`<p><strong>Bailleur :</strong> ${h(s.ownerName||"À compléter")} — ${h(s.address||"Adresse à compléter")} — ${h(s.phone||"Téléphone à compléter")}</p><p><strong>Locataire :</strong> ${h(t.name)} — ${h(t.phone)} — ${h(t.email||"")} — pièce d'identité : ${h(t.identityNumber||"à compléter")}</p>
  <h3>Bien loué</h3><p>${h(p?.name||"Propriété")} — ${h(p?.address||p?.district||"")}, ${h(s.city||"Libreville")}<br>Logement : ${h(u.name)} (${h(u.type)}) · Usage : ${h(t.purpose||"Habitation")}</p>
  <h3>Conditions financières</h3><table><tr><th>Loyer mensuel</th><td>${money(u.rent)}</td></tr><tr><th>Charges mensuelles</th><td>${money(u.charges)}</td></tr><tr><th>Dépôt de garantie</th><td>${money(t.deposit)}</td></tr><tr><th>Échéance</th><td>Le ${h(t.dueDay||1)} de chaque mois</td></tr></table>
  <p><strong>Prise d'effet :</strong> ${dateFr(t.start)} · <strong>Fin prévue :</strong> ${dateFr(t.leaseEnd)}.</p><h3>Conditions particulières</h3><p>${h(t.leaseNotes||"À compléter entre les parties.")}</p><h3>Clauses complémentaires du bailleur</h3><p>${h(s.leaseClauses||"À compléter et à relire avec le locataire.")}</p>
  <p>Les parties complètent les clauses, annexes et mentions nécessaires avant signature.</p><p>Fait à ${h(s.city||"Libreville")}, le ____________________ en ______ exemplaires.</p><div class="signatures"><div>Le bailleur<br><br>_______________________</div><div>Le locataire<br><br>_______________________</div></div>`);
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
  printDocument(`État des lieux de ${i.type.toLowerCase()}`,`<p>Date : ${dateFr(i.date)}<br>Locataire : ${h(t?.name||"—")}<br>Propriété : ${h(p?.name||"—")} · ${h(p?.address||p?.district||"")}<br>Logement : ${h(u?.name||"—")}<br>Clés : ${h(i.keys||"—")}</p>
  <table><thead><tr><th>Élément</th><th>État</th><th>Observations</th></tr></thead><tbody>${(i.items||[]).map(x=>`<tr><td>${h(x.item)}</td><td>${h(x.state)}</td><td>${h(x.note||"—")}</td></tr>`).join("")}</tbody></table><p><strong>Observations générales :</strong> ${h(i.notes||"Aucune")}</p>
  <h3>Photographies</h3>${(i.photos||[]).map(photo=>`<figure><img class="photo" src="${photoUrl(i.id,photo.id)}" alt="Photo"><figcaption>${h(photo.caption||"")}</figcaption></figure>`).join("")||"<p>Aucune photo jointe.</p>"}
  <div class="signatures"><div><strong>Bailleur</strong><br>${safeSignature(i.signatures?.landlord)?`<img src="${safeSignature(i.signatures.landlord)}" alt="Signature du bailleur">`:"_______________________"}</div><div><strong>Locataire</strong><br>${safeSignature(i.signatures?.tenant)?`<img src="${safeSignature(i.signatures.tenant)}" alt="Signature du locataire">`:"_______________________"}</div></div><p>Statut : ${i.finalizedAt?`signé et finalisé le ${dateFr(i.finalizedAt)}`:"brouillon"}.</p>`);
}
function blobAsDataUrl(blob) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error("Lecture d'image impossible"));reader.readAsDataURL(blob);}); }
async function exportData() {
  const backup=structuredClone(state);
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
    const photos=[];
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
    await flush();toast("Sauvegarde importée avec ses photos.");
  }catch(error){toast(error.message||"Fichier invalide.");}
}

$("#nav").addEventListener("click",event=>{const button=event.target.closest("[data-view]");if(button)navigate(button.dataset.view);});
document.addEventListener("click",async event=>{
  const nav=event.target.closest("[data-view]");if(nav&& !nav.closest("#nav")){navigate(nav.dataset.view);return;}
  const open=event.target.closest("[data-open]");if(open){navigate(open.dataset.open,open.dataset.id);return;}
  const button=event.target.closest("[data-action]");if(!button)return;
  const {action,kind,id:key,tenant:tenantId,unit:unitId,property:propertyId,type}=button.dataset;
  try {
    if(action==="property-add")addProperty();
    if(action==="unit-add")addUnit(null,propertyId);
    if(action==="tenant-add")addTenant(null,unitId);
    if(action==="payment-add")addPayment(null,tenantId);
    if(action==="maintenance-add")addMaintenance();
    if(action==="inspection-add")addInspection(tenantId,type);
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
    if(action==="logout"){
      if(dirty&&!await flush()&&!confirm("Certaines modifications ne sont pas enregistrées. Quitter quand même ?"))return;
      await logout();await requireLogin();
    }
  } catch(error){toast(error.message||"Action impossible.");}
});
document.querySelectorAll(".nav-parent").forEach(button=>button.onclick=()=>{const open=button.parentElement.classList.toggle("open");button.setAttribute("aria-expanded",String(open));});
$("#menuToggle").onclick=()=>$("#sidebar").classList.add("open");
$("#sidebarClose").onclick=()=>$("#sidebar").classList.remove("open");
$("#ownerChip").onclick=()=>navigate("settings");
$("#modalClose").onclick=$("#modalCancel").onclick=closeModal;
$("#modalBackdrop").onclick=event=>{if(event.target===event.currentTarget)closeModal();};
$("#syncBtn").onclick=async()=>{if(currentFlush)await currentFlush;if(dirty)await flush();else try{await loadState();toast("Données actualisées");}catch(error){toast(error.message);}};
let deferredInstall;
addEventListener("beforeinstallprompt",event=>{event.preventDefault();deferredInstall=event;$("#installBtn").hidden=false;});
$("#installBtn").onclick=async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("#installBtn").hidden=true;};
addEventListener("appinstalled",()=>$("#installBtn").hidden=true);
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
initialize();
