// Pont « Console Cyntia » : Sheet (missions + EOD) + notifications Telegram vers Alex.
// La clé KEY est aussi dans index.html (page publique) : elle évite juste les appels accidentels.
// Secrets (token Telegram, id du Sheet) = ScriptProperties, posés par what=setup, jamais dans ce code.
//
// doGet  ?key=…&what=state           -> { missions:[…], eods:[…] }
// doPost { key, what, … } :
//   setup          { tg_token?, tg_chat? }         crée le Sheet si besoin, pose les secrets, installe l'alerte 21h15
//   mission_add    { title, details, link, deadline(YYYY-MM-DD), est_min, priority }
//   mission_update { id, fields:{…} }              ex. {status:'done', done_at, actual_min, note}
//   mission_delete { id }
//   eod_submit     { date, mood, energy, good, hard, lauric_done }   upsert par date + Telegram à Alex
//   note_add       { text }                        message d'Alex pour Cyntia (idée, consigne)
//   note_seen      { id }                          Cyntia a vu le message
//   note_delete    { id }
//   mission_block  { id, text }                    Cyntia bloque : marque la mission + Telegram immédiat à Alex
//   mission_unblock{ id }
//   eod_delete     { date }                        supprime l'EOD d'une date (nettoyage de tests)
//   tg_test        {}                              message de test
//   state          {}

// À exécuter une fois dans l'éditeur pour accorder les autorisations (Sheets, Drive, réseau, déclencheurs)
function autoriser() {
  const ss = book();
  tab(ss, MIS_TAB, MIS_HDR);
  tab(ss, EOD_TAB, EOD_HDR);
  UrlFetchApp.fetch('https://api.telegram.org/');
  ScriptApp.getProjectTriggers();
  MailApp.getRemainingDailyQuota();
  Logger.log('OK ' + ss.getUrl());
}

const KEY = 'cyntia-ce6892b5a42b55849eb4460d';
const P = PropertiesService.getScriptProperties();
const MIS_TAB = 'Missions';
const EOD_TAB = 'EOD';
const MIS_HDR = ['ID', 'Créée le', 'Titre', 'Détails', 'Lien', 'Deadline', 'Estimé (min)', 'Priorité', 'Statut', 'Faite le', 'Réel (min)', 'Note Cyntia', 'MAJ', 'Bloquée', 'Blocage'];
const MIS_KEYS = ['id', 'created', 'title', 'details', 'link', 'deadline', 'est_min', 'priority', 'status', 'done_at', 'actual_min', 'note', 'updated', 'blocked', 'block_text'];
const CYNTIA_EMAIL = 'cynthia.thomas.va@gmail.com';
const PAGE_URL = 'https://alexyoucompte99-lang.github.io/console-cyntia/';
const LAURIC_EOD = 'https://alexyoucompte99-lang.github.io/console-prospection-lauric/#eod';
// Missions récurrentes créées automatiquement le matin (days : 1 = lundi … 7 = dimanche)
const RECURRING = [
  { title: "Remplir l'EOD de Lauric", details: "Ouvre la console de Lauric, remplis l'EOD du jour, puis coche cette mission.", link: LAURIC_EOD, est_min: 10, priority: 'normale', days: [1, 2, 3, 4, 5] },
  { title: "Relever les nouvelles étiquettes Insta (48 h)", details: "Sur le téléphone (le drapeau et les étiquettes ne se voient pas sur ordinateur) : ouvre la messagerie pro Insta de Lauric, passe en revue les conversations des dernières 48 h et repère celles qui ont reçu une nouvelle étiquette ou un drapeau (posé par toi, Constant ou Lauric). Pour chacune, copie l'URL du profil et colle-la dans le champ « URL des personnes mises en étiquette » de l'EOD Lauric du jour (une URL par ligne). Ne remets pas une URL déjà envoyée un jour précédent. Si aucune nouvelle étiquette : mets 0 dans « Étiquette drapeau » et coche quand même la mission.", link: LAURIC_EOD, est_min: 10, priority: 'normale', days: [1, 2, 3, 4, 5] },
];
const EOD_HDR = ['Date', 'Humeur /5', 'Énergie /5', 'Ce qui a bien marché', 'Difficultés / besoins', 'EOD Lauric fait', 'Missions faites', 'Temps total (min)', 'Envoyé le'];
const EOD_KEYS = ['date', 'mood', 'energy', 'good', 'hard', 'lauric_done', 'missions_done', 'total_min', 'sent_at'];
const NOTES_TAB = 'Notes';
const NOTES_HDR = ['ID', 'Créée le', 'Message', 'Vu le'];
const NOTES_KEYS = ['id', 'created', 'text', 'seen_at'];
const TZ = 'Europe/Paris';

function doGet(e) {
  const q = (e && e.parameter) || {};
  if (q.key !== KEY) return out({ ok: true, pong: true, v: 1 });
  if (q.what === 'state') return out(state());
  return out({ ok: true, pong: true, v: 1 });
}

function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad json' }); }
  if (p.key !== KEY) return out({ ok: false, error: 'bad key' });
  try {
    if (p.what === 'setup') return out(setup(p));
    if (p.what === 'state') return out(state());
    if (p.what === 'mission_add') return out(missionAdd(p, true));
    if (p.what === 'mission_update') return out(missionUpdate(p));
    if (p.what === 'mission_delete') return out(missionDelete(p));
    if (p.what === 'eod_submit') return out(eodSubmit(p));
    if (p.what === 'eod_delete') return out(eodDelete(p));
    if (p.what === 'mission_block') return out(missionBlock(p));
    if (p.what === 'mission_unblock') return out(missionUnblock(p));
    if (p.what === 'note_add') return out(noteAdd(p));
    if (p.what === 'note_seen') return out(noteSeen(p));
    if (p.what === 'note_delete') return out(noteDelete(p));
    if (p.what === 'tg_test') return out({ ok: sendTg('🧭 Console Cyntia : test de notification OK') });
    if (p.what === 'mail_test') { MailApp.sendEmail({ to: String(p.to || CYNTIA_EMAIL), name: 'Console Cyntia', subject: 'Test console Cyntia', body: 'Le rappel mail fonctionne. ' + PAGE_URL }); return out({ ok: true, quota: MailApp.getRemainingDailyQuota() }); }
    return out({ ok: false, error: 'unknown what' });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- setup ----------
function setup(p) {
  if (p.tg_token) P.setProperty('TG_TOKEN', p.tg_token);
  if (p.tg_chat) P.setProperty('TG_CHAT', String(p.tg_chat));
  const ss = book();
  tab(ss, MIS_TAB, MIS_HDR);
  tab(ss, EOD_TAB, EOD_HDR);
  tab(ss, NOTES_TAB, NOTES_HDR);
  const def = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  installTriggers();
  createRecurring();
  scheduleToday();
  return { ok: true, sheet_url: ss.getUrl(), sheet_id: ss.getId(), tg: !!P.getProperty('TG_TOKEN'), triggers: ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()) };
}

function book() {
  let id = P.getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* recréé ci-dessous */ } }
  const ss = SpreadsheetApp.create('Console Cyntia (missions + EOD)');
  P.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function tab(ss, name, hdr) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < hdr.length) {
    // colonnes ajoutées après coup (ex. Bloquée / Blocage)
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold');
  }
  return sh;
}

// Déclencheurs : tout est recréé proprement (les anciens sont supprimés).
//  - createRecurring : tous les jours vers 6h -> missions récurrentes du jour
//  - scheduleToday   : tous les jours vers 15h -> pose 2 déclencheurs ponctuels précis : 16h55 mail à Cyntia, 17h30 alerte Alex
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('createRecurring').timeBased().everyDays(1).atHour(6).nearMinute(0).inTimezone(TZ).create();
  ScriptApp.newTrigger('scheduleToday').timeBased().everyDays(1).atHour(15).nearMinute(0).inTimezone(TZ).create();
}
function dowToday() { return Number(Utilities.formatDate(new Date(), TZ, 'u')); }
function tzOffsetMinutes(d) {
  const z = Utilities.formatDate(d, TZ, 'Z'); // ex. +0200
  return (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
}
function atToday(h, m) {
  const now = new Date();
  const y = Number(Utilities.formatDate(now, TZ, 'yyyy')), mo = Number(Utilities.formatDate(now, TZ, 'M')), d = Number(Utilities.formatDate(now, TZ, 'd'));
  return new Date(Date.UTC(y, mo - 1, d, h, m) - tzOffsetMinutes(now) * 60000);
}
function scheduleToday() {
  if (dowToday() > 5) return;
  ['remindCyntiaEod', 'alertMissingEod'].forEach(fn => ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === fn).forEach(t => ScriptApp.deleteTrigger(t)));
  const now = new Date();
  const t1 = atToday(16, 55), t2 = atToday(17, 30);
  if (t1 > now) ScriptApp.newTrigger('remindCyntiaEod').timeBased().at(t1).create();
  if (t2 > now) ScriptApp.newTrigger('alertMissingEod').timeBased().at(t2).create();
}
function createRecurring() {
  const dow = dowToday();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const ss = book();
  const existing = rows(tab(ss, MIS_TAB, MIS_HDR), MIS_KEYS);
  let n = 0;
  RECURRING.filter(r => r.days.includes(dow)).forEach(r => {
    if (existing.some(m => m.title === r.title && String(m.deadline).slice(0, 10) === today)) return;
    missionAdd({ title: r.title, details: r.details, link: r.link, deadline: today, est_min: r.est_min, priority: r.priority });
    n++;
  });
  return n;
}

// ---------- lecture ----------
function rows(sh, keys) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const v = sh.getRange(2, 1, last - 1, keys.length).getValues();
  return v.filter(r => r[0] !== '').map(r => {
    const o = {};
    keys.forEach((k, i) => { o[k] = cell(r[i]); });
    return o;
  });
}

function cell(x) {
  if (x instanceof Date) return Utilities.formatDate(x, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  return x;
}

function state() {
  const ss = book();
  return {
    ok: true,
    now: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"),
    missions: rows(tab(ss, MIS_TAB, MIS_HDR), MIS_KEYS),
    eods: rows(tab(ss, EOD_TAB, EOD_HDR), EOD_KEYS),
    notes: rows(tab(ss, NOTES_TAB, NOTES_HDR), NOTES_KEYS),
  };
}

// ---------- missions ----------
function stamp() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }

// mail : true quand la mission est ajoutée par Alex depuis la console (pas pour les récurrentes)
function missionAdd(p, mail) {
  const ss = book();
  const sh = tab(ss, MIS_TAB, MIS_HDR);
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = stamp();
  const row = [id, now, String(p.title || '').trim(), String(p.details || ''), String(p.link || ''),
    String(p.deadline || ''), Number(p.est_min) || '', String(p.priority || 'normale'), 'todo', '', '', '', now, '', ''];
  sh.appendRow(row);
  sh.getRange(sh.getLastRow(), 1, 1, row.length).setNumberFormat('@');
  if (mail) { try { mailNewMission(row); } catch (e) { Logger.log('mail mission : ' + e); } }
  return { ok: true, id };
}

// Mail à Cyntia dès qu'Alex ajoute une mission dans sa console
function mailNewMission(row) {
  const title = row[2], details = row[3], link = row[4], deadline = row[5], est = row[6], prio = row[7];
  let dl = 'aucune';
  if (deadline) dl = Utilities.formatDate(new Date(deadline + 'T12:00:00'), TZ, 'EEEE d MMMM');
  const estTxt = est ? (est >= 60 ? Math.floor(est / 60) + ' h' + (est % 60 ? ' ' + (est % 60) + ' min' : '') : est + ' min') : 'non précisé';
  let body = 'Hello Cyntia,\n\nUne nouvelle mission vient d\'être ajoutée dans ta console' + (prio === 'urgente' ? ' (urgente)' : '') + ' :\n\n'
    + '▶ ' + title + '\n'
    + '📅 Deadline : ' + dl + '\n'
    + '⏱ Temps prévu : ' + estTxt + '\n'
    + (link ? '🔗 Lien : ' + link + '\n' : '');
  if (details) body += '\n' + details + '\n';
  body += '\nTa console : ' + PAGE_URL + '\n\nAlex\n\n(message automatique de la console)';
  MailApp.sendEmail({ to: CYNTIA_EMAIL, name: 'Console Cyntia', subject: 'Nouvelle mission : ' + title, body: body });
}

function findRow(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function missionUpdate(p) {
  const ss = book();
  const sh = tab(ss, MIS_TAB, MIS_HDR);
  const r = findRow(sh, p.id);
  if (!r) return { ok: false, error: 'mission introuvable' };
  const f = p.fields || {};
  Object.keys(f).forEach(k => {
    const i = MIS_KEYS.indexOf(k);
    if (i > 0 && k !== 'created') sh.getRange(r, i + 1).setNumberFormat('@').setValue(f[k] === null ? '' : f[k]);
  });
  sh.getRange(r, MIS_KEYS.indexOf('updated') + 1).setNumberFormat('@').setValue(stamp());
  return { ok: true };
}

function missionDelete(p) {
  const ss = book();
  const sh = tab(ss, MIS_TAB, MIS_HDR);
  const r = findRow(sh, p.id);
  if (!r) return { ok: false, error: 'mission introuvable' };
  sh.deleteRow(r);
  return { ok: true };
}

// ---------- blocage ----------
function missionBlock(p) {
  const ss = book();
  const sh = tab(ss, MIS_TAB, MIS_HDR);
  const r = findRow(sh, p.id);
  if (!r) return { ok: false, error: 'mission introuvable' };
  const text = String(p.text || '').trim();
  if (!text) return { ok: false, error: 'explication vide' };
  sh.getRange(r, MIS_KEYS.indexOf('blocked') + 1).setNumberFormat('@').setValue('OUI');
  sh.getRange(r, MIS_KEYS.indexOf('block_text') + 1).setNumberFormat('@').setValue(text);
  sh.getRange(r, MIS_KEYS.indexOf('updated') + 1).setNumberFormat('@').setValue(stamp());
  const title = sh.getRange(r, MIS_KEYS.indexOf('title') + 1).getValue();
  const dl = sh.getRange(r, MIS_KEYS.indexOf('deadline') + 1).getValue();
  const tg = sendTg('🙋 Cyntia bloque sur « ' + title + ' »\n\n' + text + (dl ? '\n\nDeadline : ' + Utilities.formatDate(new Date(String(dl).slice(0, 10) + 'T12:00:00'), TZ, 'EEEE d MMMM') : '') + '\n\nRéponds-lui via « Message pour Cyntia » : ' + PAGE_URL + '?vue=alex');
  return { ok: true, tg };
}
function missionUnblock(p) {
  const sh = tab(book(), MIS_TAB, MIS_HDR);
  const r = findRow(sh, p.id);
  if (!r) return { ok: false, error: 'mission introuvable' };
  sh.getRange(r, MIS_KEYS.indexOf('blocked') + 1).setValue('');
  sh.getRange(r, MIS_KEYS.indexOf('block_text') + 1).setValue('');
  sh.getRange(r, MIS_KEYS.indexOf('updated') + 1).setNumberFormat('@').setValue(stamp());
  return { ok: true };
}

// ---------- notes d'Alex ----------
function noteAdd(p) {
  const sh = tab(book(), NOTES_TAB, NOTES_HDR);
  const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const row = [id, stamp(), String(p.text || '').trim(), ''];
  if (!row[2]) return { ok: false, error: 'message vide' };
  sh.appendRow(row);
  sh.getRange(sh.getLastRow(), 1, 1, row.length).setNumberFormat('@');
  return { ok: true, id };
}
function noteSeen(p) {
  const sh = tab(book(), NOTES_TAB, NOTES_HDR);
  const r = findRow(sh, p.id);
  if (!r) return { ok: false, error: 'note introuvable' };
  sh.getRange(r, 4).setNumberFormat('@').setValue(stamp());
  return { ok: true };
}
function noteDelete(p) {
  const sh = tab(book(), NOTES_TAB, NOTES_HDR);
  const r = findRow(sh, p.id);
  if (!r) return { ok: false, error: 'note introuvable' };
  sh.deleteRow(r);
  return { ok: true };
}

// ---------- EOD ----------
function eodSubmit(p) {
  const ss = book();
  const sh = tab(ss, EOD_TAB, EOD_HDR);
  const date = String(p.date || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'));
  const missions = rows(tab(ss, MIS_TAB, MIS_HDR), MIS_KEYS)
    .filter(m => m.status === 'done' && String(m.done_at || '').slice(0, 10) === date);
  const total = missions.reduce((s, m) => s + (Number(m.actual_min) || 0), 0);
  const est = missions.reduce((s, m) => s + (Number(m.est_min) || 0), 0);
  const row = [date, Number(p.mood) || '', Number(p.energy) || '', String(p.good || ''), String(p.hard || ''),
    p.lauric_done ? 'OUI' : 'NON', missions.length, total, stamp()];
  const last = sh.getLastRow();
  let r = 0;
  if (last >= 2) {
    const dates = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i][0];
      const s = d instanceof Date ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : String(d);
      if (s === date) { r = i + 2; break; }
    }
  }
  const isUpdate = r > 0;
  if (!r) r = last + 1;
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);

  const moods = ['', '😞', '😕', '😐', '🙂', '😄'];
  const dLabel = Utilities.formatDate(new Date(date + 'T12:00:00'), TZ, 'EEEE d MMMM');
  const lines = [];
  lines.push('🧭 Cyntia · EOD du ' + dLabel + (isUpdate ? ' (modifié)' : ''));
  lines.push('');
  lines.push('Humeur : ' + (row[1] || '?') + '/5 ' + (moods[row[1]] || ''));
  lines.push('Énergie : ' + (row[2] || '?') + '/5');
  lines.push('');
  lines.push('✅ ' + missions.length + ' mission' + (missions.length > 1 ? 's' : '') + ' faite' + (missions.length > 1 ? 's' : '') +
    ' · ' + fmtMin(total) + (est ? ' (estimé ' + fmtMin(est) + ')' : ''));
  missions.forEach(m => lines.push('• ' + m.title + (m.actual_min ? ' · ' + fmtMin(m.actual_min) : '')));
  if (p.good) { lines.push(''); lines.push('👍 Ce qui a bien marché :'); lines.push(String(p.good)); }
  if (p.hard) { lines.push(''); lines.push('⚠️ Difficultés / besoins :'); lines.push(String(p.hard)); }
  lines.push('');
  lines.push('EOD Lauric : ' + (p.lauric_done ? 'fait ✅' : 'pas fait ❌'));
  const todo = rows(tab(ss, MIS_TAB, MIS_HDR), MIS_KEYS).filter(m => m.status !== 'done');
  const late = todo.filter(m => m.deadline && String(m.deadline) < date);
  lines.push('📋 Reste ' + todo.length + ' mission' + (todo.length > 1 ? 's' : '') + (late.length ? ' dont ' + late.length + ' en retard' : ''));
  const tg = sendTg(lines.join('\n'));
  return { ok: true, updated: isUpdate, tg };
}

function eodDelete(p) {
  const sh = tab(book(), EOD_TAB, EOD_HDR);
  const last = sh.getLastRow();
  if (last < 2) return { ok: false, error: 'aucun EOD' };
  const dates = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i][0];
    const s = d instanceof Date ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : String(d);
    if (s === String(p.date)) { sh.deleteRow(i + 2); return { ok: true }; }
  }
  return { ok: false, error: 'date introuvable' };
}

function fmtMin(n) {
  n = Number(n) || 0;
  if (!n) return '0 min';
  const h = Math.floor(n / 60), m = n % 60;
  if (!h) return m + ' min';
  return h + 'h' + (m ? String(m).padStart(2, '0') : '');
}

function eodFilledToday() {
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  return rows(tab(book(), EOD_TAB, EOD_HDR), EOD_KEYS).some(e => String(e.date).slice(0, 10) === today);
}

// 16h55 (lundi -> vendredi) : mail de rappel à Cyntia si son EOD du jour n'est pas rempli
function remindCyntiaEod() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'remindCyntiaEod').forEach(t => ScriptApp.deleteTrigger(t));
  if (dowToday() > 5 || eodFilledToday()) return;
  const dateLabel = Utilities.formatDate(new Date(), TZ, 'EEEE d MMMM');
  MailApp.sendEmail({
    to: CYNTIA_EMAIL,
    name: 'Console Cyntia',
    subject: 'Ton EOD du jour avant 17h 🌙',
    body: 'Hello Cyntia,\n\nIl est presque 17h et ton EOD du ' + dateLabel + " n'est pas encore rempli.\n\nC'est ici, ça prend 1 minute :\n" + PAGE_URL + "#eod\n\nPense aussi à l'EOD de Lauric si ce n'est pas fait :\n" + LAURIC_EOD + '\n\nBonne fin de journée !\nAlex\n\n(message automatique de la console)',
  });
}

// 17h30 (lundi -> vendredi) : alerte Telegram à Alex si l'EOD du jour n'est pas rempli
function alertMissingEod() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'alertMissingEod').forEach(t => ScriptApp.deleteTrigger(t));
  const now = new Date();
  if (dowToday() > 5 || eodFilledToday()) return;
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const ss = book();
  const missions = rows(tab(ss, MIS_TAB, MIS_HDR), MIS_KEYS);
  const done = missions.filter(m => m.status === 'done' && String(m.done_at || '').slice(0, 10) === today).length;
  sendTg('🧭 Cyntia n\'a pas rempli son EOD du jour (' + Utilities.formatDate(now, TZ, 'EEEE d MMMM') + '), rappel mail envoyé à 16h55.\n' +
    (done ? done + ' mission' + (done > 1 ? 's' : '') + ' cochée' + (done > 1 ? 's' : '') + ' aujourd\'hui.' : 'Aucune mission cochée aujourd\'hui.'));
}

// ---------- Telegram ----------
function sendTg(text) {
  const token = P.getProperty('TG_TOKEN'), chat = P.getProperty('TG_CHAT');
  if (!token || !chat) return false;
  try {
    const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: chat, text: text, disable_web_page_preview: true }),
    });
    return r.getResponseCode() === 200;
  } catch (e) { return false; }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
