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
//   tg_test        {}                              message de test
//   state          {}

const KEY = 'cyntia-ce6892b5a42b55849eb4460d';
const P = PropertiesService.getScriptProperties();
const MIS_TAB = 'Missions';
const EOD_TAB = 'EOD';
const MIS_HDR = ['ID', 'Créée le', 'Titre', 'Détails', 'Lien', 'Deadline', 'Estimé (min)', 'Priorité', 'Statut', 'Faite le', 'Réel (min)', 'Note Cyntia', 'MAJ'];
const MIS_KEYS = ['id', 'created', 'title', 'details', 'link', 'deadline', 'est_min', 'priority', 'status', 'done_at', 'actual_min', 'note', 'updated'];
const EOD_HDR = ['Date', 'Humeur /5', 'Énergie /5', 'Ce qui a bien marché', 'Difficultés / besoins', 'EOD Lauric fait', 'Missions faites', 'Temps total (min)', 'Envoyé le'];
const EOD_KEYS = ['date', 'mood', 'energy', 'good', 'hard', 'lauric_done', 'missions_done', 'total_min', 'sent_at'];
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
    if (p.what === 'mission_add') return out(missionAdd(p));
    if (p.what === 'mission_update') return out(missionUpdate(p));
    if (p.what === 'mission_delete') return out(missionDelete(p));
    if (p.what === 'eod_submit') return out(eodSubmit(p));
    if (p.what === 'tg_test') return out({ ok: sendTg('🧭 Console Cyntia : test de notification OK') });
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
  const def = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  installAlert();
  return { ok: true, sheet_url: ss.getUrl(), sheet_id: ss.getId(), tg: !!P.getProperty('TG_TOKEN') };
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
  }
  return sh;
}

function installAlert() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'alertMissingEod');
  if (!has) ScriptApp.newTrigger('alertMissingEod').timeBased().everyDays(1).atHour(21).nearMinute(15).inTimezone(TZ).create();
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
  };
}

// ---------- missions ----------
function stamp() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }

function missionAdd(p) {
  const ss = book();
  const sh = tab(ss, MIS_TAB, MIS_HDR);
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = stamp();
  const row = [id, now, String(p.title || '').trim(), String(p.details || ''), String(p.link || ''),
    String(p.deadline || ''), Number(p.est_min) || '', String(p.priority || 'normale'), 'todo', '', '', '', now];
  sh.appendRow(row);
  sh.getRange(sh.getLastRow(), 1, 1, row.length).setNumberFormat('@');
  return { ok: true, id };
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

function fmtMin(n) {
  n = Number(n) || 0;
  if (!n) return '0 min';
  const h = Math.floor(n / 60), m = n % 60;
  if (!h) return m + ' min';
  return h + 'h' + (m ? String(m).padStart(2, '0') : '');
}

// Alerte quotidienne (21h15, lundi -> vendredi) si l'EOD du jour n'est pas rempli
function alertMissingEod() {
  const now = new Date();
  const dow = Number(Utilities.formatDate(now, TZ, 'u')); // 1 = lundi … 7 = dimanche
  if (dow > 5) return;
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const ss = book();
  const eods = rows(tab(ss, EOD_TAB, EOD_HDR), EOD_KEYS);
  if (eods.some(e => String(e.date).slice(0, 10) === today)) return;
  const missions = rows(tab(ss, MIS_TAB, MIS_HDR), MIS_KEYS);
  const done = missions.filter(m => m.status === 'done' && String(m.done_at || '').slice(0, 10) === today).length;
  sendTg('🧭 Cyntia n\'a pas encore rempli son EOD du jour (' + Utilities.formatDate(now, TZ, 'EEEE d MMMM') + ').\n' +
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

// À exécuter une fois dans l'éditeur pour accorder les autorisations (Sheets, Drive, réseau, déclencheurs)
function autoriser() {
  const ss = book();
  tab(ss, MIS_TAB, MIS_HDR);
  tab(ss, EOD_TAB, EOD_HDR);
  UrlFetchApp.fetch('https://api.telegram.org/');
  ScriptApp.getProjectTriggers();
  Logger.log('OK ' + ss.getUrl());
}
