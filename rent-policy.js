export const RENT_POLICY_LABEL = "Augmentation automatique de 5 % tous les 4 ans";
export const RENT_INCREASE_PERCENT = 5;
export const RENT_INCREASE_YEARS = 4;

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function anniversary(start, years) {
  if (!validDate(start) || !Number.isInteger(years) || years < 0) return null;
  const [y, m, d] = start.split("-").map(Number), year = y + years;
  if (year > 9999) return null;
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${String(year).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(Math.min(d,lastDay)).padStart(2,"0")}`;
}
export function completedYears(start, onDate) {
  if (!validDate(start) || !validDate(onDate) || onDate < start) return 0;
  const years = Number(onDate.slice(0,4)) - Number(start.slice(0,4));
  return years - (onDate < anniversary(start, years) ? 1 : 0);
}
export const hasRentBase = t => Number.isSafeInteger(Number(t?.initialRent)) && Number(t.initialRent) > 0;
export function initialRent(t, u) {
  if (hasRentBase(t)) return Number(t.initialRent);
  const value = Number(u?.rent);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
// Une base par location, figée une seule fois. Les factures et versements restent intacts.
export function captureRentBases(payload) {
  let changed = false;
  for (const t of payload.tenants || []) {
    if (hasRentBase(t)) continue;
    const u = (payload.units || []).find(x => x.id === t.unitId), amount = initialRent(t, u);
    if (amount === null) continue;
    t.initialRent = amount;
    t.rentBaseSource = "legacy-unit";
    changed = true;
  }
  return changed;
}
function increased(amount, periods) {
  let result = amount;
  for (let i = 0; i < periods; i++) {
    result = Math.round(result * 1.05);
    if (!Number.isSafeInteger(result)) throw Error("Le montant calculé dépasse la limite prise en charge.");
  }
  return result;
}
export function rentAtDate(t, u, onDate) {
  const base = initialRent(t, u);
  if (base === null) return null;
  const effective = t?.end && t.end < onDate ? t.end : onDate;
  return increased(base, Math.floor(completedYears(t?.start, effective) / RENT_INCREASE_YEARS));
}
export function rentSchedule(t, u, onDate) {
  const base = initialRent(t, u);
  if (base === null || !validDate(t?.start) || !validDate(onDate)) return null;
  const effective = t.end && t.end < onDate ? t.end : onDate;
  const years = completedYears(t.start, effective), periods = Math.floor(years / RENT_INCREASE_YEARS);
  const current = increased(base, periods);
  return {base, current, periods, years, nextDate:t.end?null:anniversary(t.start,(periods+1)*4), nextAmount:t.end?null:increased(base,periods+1), lastDate:periods?anniversary(t.start,periods*4):null};
}
export function monthlyRent(t, u, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) throw Error("Mois de loyer invalide.");
  const [year,m]=month.split("-").map(Number), days=new Date(Date.UTC(year,m,0)).getUTCDate();
  let total=0;
  const segments=[];
  for(let day=1;day<=days;day++) {
    const date=`${month}-${String(day).padStart(2,"0")}`, rate=rentAtDate(t,u,date);
    if(rate===null)throw Error("Renseignez le loyer initial de cette location.");
    total+=rate;
    const previous=segments.at(-1);
    if(previous?.rate===rate){previous.days++;previous.to=date;}
    else segments.push({from:date,to:date,rate,days:1});
  }
  return {amount:Math.round(total/days),days,segments,prorated:segments.length>1,base:initialRent(t,u),start:t?.start||null,policy:"five-percent-four-years-v1"};
}
export function rentDueForMonth(payload, t, u, month) {
  const invoice=(payload.invoices||[]).find(i=>i.tenantId===t?.id&&i.month===month);
  // Un montant déjà facturé est l'autorité pour son mois, y compris après une correction de la base.
  return invoice?Number(invoice.amount):monthlyRent(t,u,month).amount;
}
export function tenancyAnniversary(t, onDate) {
  if(t?.end||!validDate(t?.start)||!validDate(onDate)||onDate<t.start)return null;
  const years=Math.floor(completedYears(t.start,onDate)/2)*2;
  if(years<2)return null;
  return {years,date:anniversary(t.start,years),key:`tenancy-anniversary:${t.id}:${t.start}:${years}`};
}
