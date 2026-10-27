/* Fansi Store + Silai - Google Sheets backend (Apps Script Web App)
   Login: Script Properties me OWNER_PIN aur STAFF_PIN set karein (6+ digit).
   Server hi har record ka updatedAt (server time) lagata hai. */
const SPREADSHEET_ID = '1HZEAzlC-BTdwzvGIEhsvE_y4UOeC0Ec97TuzfpM-5WE';
const BASE = {
  Products: ['id','name','sku','category','quantity','purchasePrice','sellingPrice','updatedAt','deleted'],
  Sales: ['id','billNo','customerId','date','itemsJson','subtotal','discount','total','paid','paymentStatus','updatedAt','deleted'],
  Tailoring_Orders: ['id','orderNo','customerId','customerName','phone','measurementsJson','itemsJson','orderDate','deliveryDate','amount','paid','status','notes','updatedAt','deleted'],
  Customers: ['id','name','phone','address','openingBalance','updatedAt','deleted'],
  Payments: ['id','customerId','referenceId','date','amount','method','notes','updatedAt','deleted'],
  Expenses: ['id','date','category','description','amount','paidBy','updatedAt','deleted']
};
const SHEETS = {};
Object.keys(BASE).forEach(k => SHEETS[k] = BASE[k].concat(['extraJson']));
SHEETS.Stock_Moves = ['id','productId','delta','date','by'];
SHEETS.Sync_Log = ['id','recordType','recordId','action','timestamp','status'];
const TEXT_COLS = ['id','updatedAt','date','orderDate','deliveryDate','phone','customerId','referenceId','billNo','orderNo','sku','productId'];
const STAFF_BLOCKED = ['Expenses'];

function doGet() { return out_({ok:true, service:'Fansi Store API', message:'Running. POST only.'}); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const role = auth_(body.pin);
    if (!role) return out_({ok:false, error:'Galat PIN'});
    if (body.action === 'login') return out_({ok:true, role:role});
    if (body.action === 'pull') return out_(pull_(body, role));
    if (body.action === 'push') { lock.waitLock(25000); return out_(push_(body, role)); }
    return out_({ok:false, error:'Unknown action'});
  } catch (err) {
    return out_({ok:false, error:String(err.message || err)});
  } finally { if (lock.hasLock()) lock.releaseLock(); }
}

function auth_(pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails >= 10) throw new Error('Bahut galat PIN. 15 minute ruk kar try karein (ya editor me resetLock run karein).');
  const p = PropertiesService.getScriptProperties();
  const owner = String(p.getProperty('OWNER_PIN') || '').trim(), staff = String(p.getProperty('STAFF_PIN') || '').trim();
  if (!owner && !staff) throw new Error('Script Properties me OWNER_PIN / STAFF_PIN set nahi hain');
  pin = String(pin || '').trim();
  if (pin && pin === owner) return 'owner';
  if (pin && pin === staff) return 'staff';
  cache.put('fails', String(fails + 1), 900);
  return null;
}

// Editor me run karke Execution log dekhein: PIN set hai ya nahi (PIN khud nahi dikhata).
function checkPinSetup() {
  const p = PropertiesService.getScriptProperties();
  ['OWNER_PIN', 'STAFF_PIN'].forEach(k => {
    const v = p.getProperty(k);
    Logger.log(k + ': ' + (v === null ? 'SET NAHI HAI' : 'set hai, length ' + String(v).length + (String(v) !== String(v).trim() ? ' (spaces hain, ab auto-trim honge)' : '')));
  });
  Logger.log('Galat-PIN counter: ' + (CacheService.getScriptCache().get('fails') || 0));
}
function resetLock() { CacheService.getScriptCache().remove('fails'); Logger.log('Lock reset'); }

function formatText_(sheet, headers) {
  // Text format (phone, id, dates) taaki Sheets unhe number/date na bana de.
  headers.forEach((h, i) => { if (TEXT_COLS.indexOf(h) >= 0) sheet.getRange(1, i + 1, sheet.getMaxRows(), 1).setNumberFormat('@'); });
}

// Tab ensure karta hai: nahi hai to banata hai, khaali hai to headers likhta hai.
// Agar tab me data hai par row 1 header nahi hai to saaf error deta hai (data galat jagah na likhe).
function ensureSheet_(ss, name) {
  const headers = SHEETS[name];
  let sheet = ss.getSheetByName(name); if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    formatText_(sheet, headers);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]); sheet.setFrozenRows(1);
  } else if (String(sheet.getRange(1, 1, 1, 1).getDisplayValues()[0][0]) !== 'id') {
    throw new Error('"' + name + '" tab me header row nahi hai. Apps Script editor me repairSheets run karein.');
  }
  return sheet;
}

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.keys(SHEETS).forEach(name => {
    const headers = SHEETS[name];
    const sheet = ensureSheet_(ss, name);
    formatText_(sheet, headers);
    const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    if (existing.join('|') !== headers.join('|')) throw new Error('Header mismatch in "' + name + '". Row 1 check karein.');
  });
  return 'Setup complete';
}

// Purani/galat bani sheet ko theek karta hai: missing tabs banata hai, header row jodta hai,
// date cells ko text (yyyy-MM-dd) banata hai, aur same id ki duplicate rows hata kar sabse nayi rakhta hai.
function repairSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID), tz = ss.getSpreadsheetTimeZone(), log = [];
  Object.keys(SHEETS).forEach(name => {
    const headers = SHEETS[name];
    let sheet = ss.getSheetByName(name);
    if (!sheet) { sheet = ss.insertSheet(name); log.push(name + ': tab banaya'); }
    if (sheet.getLastRow() > 0 && String(sheet.getRange(1, 1, 1, 1).getDisplayValues()[0][0]) !== 'id') {
      sheet.insertRowBefore(1); log.push(name + ': header row jodi');
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]); sheet.setFrozenRows(1);
    }
    ensureSheet_(ss, name); formatText_(sheet, headers);
    const last = sheet.getLastRow(); if (last < 2) return;
    headers.forEach((h, i) => {   // date cells -> text
      if (['date', 'orderDate', 'deliveryDate'].indexOf(h) < 0) return;
      const rng = sheet.getRange(2, i + 1, last - 1, 1), vals = rng.getValues();
      rng.setValues(vals.map(r => [r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : r[0]]));
    });
    if (!BASE[name] || last < 3) return;   // duplicates sirf data tabs me
    const uCol = headers.indexOf('updatedAt'), rows = sheet.getRange(2, 1, last - 1, headers.length).getValues(), best = {};
    rows.forEach((r, i) => { const id = String(r[0]), t = Date.parse(r[uCol]) || 0; if (!best[id] || t >= best[id].t) best[id] = {t: t, i: i}; });
    const del = []; rows.forEach((r, i) => { if (best[String(r[0])].i !== i) del.push(i + 2); });
    del.sort((x, y) => y - x).forEach(rn => sheet.deleteRow(rn));
    if (del.length) log.push(name + ': ' + del.length + ' duplicate row hataye');
  });
  Logger.log(log.length ? log.join('\n') : 'Sab theek tha, kuch badlav nahi');
  return log;
}

function checkType_(type, role) {
  if (!SHEETS[type] || type === 'Sync_Log' || type === 'Stock_Moves') throw new Error('Unsupported type: ' + type);
  if (role !== 'owner' && STAFF_BLOCKED.indexOf(type) >= 0) throw new Error('Is data ki permission nahi hai');
}

function toRow_(headers, d) {
  return headers.map(h => {
    const v = d[h];
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(v) && TEXT_COLS.indexOf(h) < 0) return "'" + v;
    return v;
  });
}

function idIndex_(sheet) {
  const idx = {}, last = sheet.getLastRow();
  if (last >= 2) sheet.getRange(2, 1, last - 1, 1).getDisplayValues().forEach((r, i) => idx[r[0]] = i + 2);
  return idx;
}

function push_(body, role) {
  const now = new Date().toISOString(), results = {};
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const records = (Array.isArray(body.records) ? body.records : []).slice(0, 200);
  const moves = (Array.isArray(body.moves) ? body.moves : []).slice(0, 200);
  const byType = {};
  records.forEach(r => { const t = String(r && r.type); (byType[t] = byType[t] || []).push(r); });

  Object.keys(byType).forEach(type => {
    try { checkType_(type, role); }
    catch (err) { byType[type].forEach(r => results[r && r.id] = {ok:false, error:err.message}); return; }
    const headers = SHEETS[type];
    let sheet;
    try { sheet = ensureSheet_(ss, type); }
    catch (err) { byType[type].forEach(r => results[r && r.id] = {ok:false, error:err.message}); return; }
    const idx = idIndex_(sheet);
    byType[type].forEach(r => {
      try {
        if (!r.id || !r.data || String(r.data.id) !== String(r.id)) throw new Error('Bad record');
        const d = Object.assign({}, r.data, {updatedAt: now});
        if (d.deleted === true && role !== 'owner') throw new Error('Delete sirf owner kar sakta hai');
        const row = idx[r.id];
        if (row) {
          // Stock quantity sirf Stock_Moves se badalti hai (do phone ek saath sale karein to bhi sahi).
          if (type === 'Products') d.quantity = sheet.getRange(row, headers.indexOf('quantity') + 1).getValue();
          sheet.getRange(row, 1, 1, headers.length).setValues([toRow_(headers, d)]);
        } else { sheet.appendRow(toRow_(headers, d)); idx[r.id] = sheet.getLastRow(); }
        results[r.id] = {ok:true};
      } catch (err) { results[r.id] = {ok:false, error:String(err.message || err)}; }
    });
  });

  if (moves.length) {
    let mSheet, pSheet;
    try { mSheet = ensureSheet_(ss, 'Stock_Moves'); pSheet = ensureSheet_(ss, 'Products'); }
    catch (err) { moves.forEach(m => results[m && m.id] = {ok:false, error:err.message}); mSheet = null; }
    if (mSheet) {
    const seen = idIndex_(mSheet), pIdx = idIndex_(pSheet);
    const qCol = SHEETS.Products.indexOf('quantity') + 1, uCol = SHEETS.Products.indexOf('updatedAt') + 1;
    moves.forEach(m => {
      try {
        if (!m || !m.id) throw new Error('Bad move');
        if (seen[m.id]) { results[m.id] = {ok:true, duplicate:true}; return; }
        const row = pIdx[m.productId];
        if (!row) throw new Error('Product sheet me nahi mila');
        const cur = Number(pSheet.getRange(row, qCol).getValue()) || 0;
        pSheet.getRange(row, qCol).setValue(cur + Number(m.delta || 0));
        pSheet.getRange(row, uCol).setValue(now);
        mSheet.appendRow([m.id, m.productId, Number(m.delta || 0), m.date || now, role]);
        seen[m.id] = true; results[m.id] = {ok:true};
      } catch (err) { results[m.id] = {ok:false, error:String(err.message || err)}; }
    });
    }
  }
  try { ensureSheet_(ss, 'Sync_Log').appendRow([Utilities.getUuid(), 'push', records.length + '+' + moves.length, role, now, 'ok']); } catch (err) {}
  return {ok:true, results:results};
}

function pull_(p, role) {
  const type = String(p.type || ''); checkType_(type, role);
  const serverTime = new Date().toISOString();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID), sheet = ensureSheet_(ss, type);
  const last = sheet.getLastRow(); if (last < 2) return {ok:true, serverTime:serverTime, records:[]};
  const headers = SHEETS[type], since = p.since ? Date.parse(p.since) || 0 : 0;
  const rows = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  const tz = ss.getSpreadsheetTimeZone();
  const norm = (v, h) => v instanceof Date ? (['date', 'orderDate', 'deliveryDate'].indexOf(h) >= 0 ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString()) : v;
  const records = rows.map(row => { const d = {}; headers.forEach((h, i) => d[h] = norm(row[i], h)); return d; })
    .filter(d => (Date.parse(d.updatedAt) || 0) >= since);
  return {ok:true, serverTime:serverTime, records:records};
}

function out_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
