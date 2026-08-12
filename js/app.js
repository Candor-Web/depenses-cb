/**
 * Dépenses CB — orchestration de l'interface.
 * Données strictement locales (IndexedDB) : rien ne part sur internet.
 */

import * as db from './db.js';
import { parseReceipt, iso } from './parse.js';
import { CATEGORIES, catLabel, catColor, guessCategory, learn, norm } from './categories.js';
import { readReceipt, compressForStorage, isEngineCached, downloadEngine } from './ocr.js';
import { eur, dateFR, num2, downloadCSV, download, makeZip, safeName,
         rowsReleve, rowsDetail, rowsArticles } from './export.js';
import { renderBilan, monthKey, monthLabel, sum } from './bilan.js';
import { decodeCSV, parseStatement, reconcile } from './bank.js';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let EXP = [];
let LEARNED = {};
let SETTINGS = { autoOcr: true, keepPhoto: true };
let current = null;               // dépense en cours d'édition
let thumbObserver = null;
const urlCache = new Map();

/* =========================================================
   Démarrage
   ========================================================= */

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist().catch(() => {}); });
  }

  LEARNED = (await db.getMeta('learned', {})) || {};
  SETTINGS = Object.assign(SETTINGS, (await db.getMeta('settings', {})) || {});
  $('#optAutoOcr').checked = SETTINGS.autoOcr;
  $('#optKeepPhoto').checked = SETTINGS.keepPhoto;

  buildCategoryChips();
  buildPaymentSegments();
  wire();
  await reload();
  refreshEngineState();
  refreshStorage();
}

async function reload() {
  EXP = await db.allExpenses();
  urlCache.forEach(u => URL.revokeObjectURL(u));
  urlCache.clear();
  renderHero();
  renderRecent();
  renderMonthSelectors();
  renderList();
  renderBilanView();
  renderMerchantList();
}

/* =========================================================
   Navigation
   ========================================================= */

const TITLES = { capture: 'Dépenses CB', liste: 'Mes dépenses', bilan: 'Bilan', outils: 'Outils' };

function show(view) {
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + view));
  $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === view));
  $('#topTitle').textContent = TITLES[view];
  window.scrollTo(0, 0);
}

/* =========================================================
   Écran d'accueil
   ========================================================= */

function renderHero() {
  const key = monthKey(iso(new Date()));
  const list = EXP.filter(e => monthKey(e.date) === key);
  const total = sum(list);
  $('#heroMonth').textContent = 'en ' + monthLabel(key).split(' ')[0];
  $('#heroTotal').textContent = eur(total);
  $('#heroSub').textContent = list.length
    ? `${list.length} ticket${list.length > 1 ? 's' : ''} · ${EXP.length} au total`
    : 'Aucun ticket ce mois-ci';
}

function renderRecent() {
  const el = $('#recentList');
  const list = EXP.slice(0, 5);
  el.innerHTML = list.length
    ? list.map(rowHTML).join('')
    : `<p class="empty">Photographiez votre premier ticket : l'application lit le montant, la date et le commerçant.</p>`;
  mountThumbs(el);
}

function rowHTML(e) {
  const flags = [];
  if (e.needsCheck) flags.push('à vérifier');
  if (e.matchedTxId) flags.push('pointé');
  return `
  <button class="exp" data-id="${e.id}">
    ${e.photoId
      ? `<img class="exp-thumb" data-photo="${e.photoId}" alt="" style="border-left:3px solid ${catColor(e.category)}">`
      : `<span class="exp-dot" style="background:${catColor(e.category)}"></span>`}
    <span class="exp-main">
      <span class="exp-merchant">${esc(e.merchant || '(sans nom)')}</span>
      <span class="exp-meta">${dateFR(e.date)} · ${esc(catLabel(e.category))}${e.note ? ' · ' + esc(e.note) : ''}</span>
      ${flags.length ? `<span class="exp-flags">${flags.join(' · ')}</span>` : ''}
    </span>
    <span class="exp-amount">${eur(e.amount)}</span>
  </button>`;
}

/** Charge les vignettes seulement quand elles arrivent à l'écran. */
function mountThumbs(root) {
  if (!thumbObserver) {
    thumbObserver = new IntersectionObserver(entries => {
      entries.forEach(async ent => {
        if (!ent.isIntersecting) return;
        const img = ent.target;
        thumbObserver.unobserve(img);
        const id = img.dataset.photo;
        if (urlCache.has(id)) { img.src = urlCache.get(id); return; }
        const blob = await db.getPhoto(id);
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        urlCache.set(id, url);
        img.src = url;
      });
    }, { rootMargin: '200px' });
  }
  root.querySelectorAll('img[data-photo]').forEach(i => thumbObserver.observe(i));
  root.querySelectorAll('.exp').forEach(b =>
    b.addEventListener('click', () => openEditor(EXP.find(x => x.id === b.dataset.id))));
}

/* =========================================================
   Liste
   ========================================================= */

function renderMonthSelectors() {
  const keys = [...new Set(EXP.map(e => monthKey(e.date)))].sort().reverse();
  const cur = monthKey(iso(new Date()));
  if (!keys.includes(cur)) keys.unshift(cur);

  const fm = $('#fMonth');
  const keep = fm.value;
  fm.innerHTML = `<option value="">Tous les mois</option>` +
    keys.map(k => `<option value="${k}">${monthLabel(k)}</option>`).join('');
  fm.value = keys.includes(keep) ? keep : '';

  const bm = $('#bMonth');
  const keepB = bm.value;
  bm.innerHTML = keys.map(k => `<option value="${k}">${monthLabel(k)}</option>`).join('');
  bm.value = keys.includes(keepB) ? keepB : keys[0];

  const fc = $('#fCat');
  const keepC = fc.value;
  fc.innerHTML = `<option value="">Toutes catégories</option>` +
    CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  fc.value = keepC;

  ['#expScope', '#zipScope'].forEach(sel => {
    const s = $(sel);
    const k = s.value;
    s.innerHTML = `<option value="">Toutes les dépenses</option>` +
      keys.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('');
    s.value = k;
  });
}

function filtered() {
  const q = norm($('#fSearch').value);
  const m = $('#fMonth').value;
  const c = $('#fCat').value;
  return EXP.filter(e =>
    (!m || monthKey(e.date) === m) &&
    (!c || e.category === c) &&
    (!q || norm(e.merchant).includes(q) || norm(e.note).includes(q)));
}

function renderList() {
  const list = filtered();
  const el = $('#expList');
  const total = sum(list);
  $('#listTotals').innerHTML = `<span>${list.length} dépense${list.length > 1 ? 's' : ''}</span><b>${eur(total)}</b>`;

  if (!list.length) { el.innerHTML = `<p class="empty">Aucune dépense ne correspond.</p>`; return; }

  let html = '', day = null;
  list.forEach(e => {
    if (e.date !== day) {
      day = e.date;
      const dayTotal = list.filter(x => x.date === day).reduce((a, x) => a + x.amount, 0);
      html += `<div class="day-head"><span>${dateFR(day)}</span><b>${eur(dayTotal)}</b></div>`;
    }
    html += rowHTML(e);
  });
  el.innerHTML = html;
  mountThumbs(el);
}

function renderBilanView() {
  const k = $('#bMonth').value || monthKey(iso(new Date()));
  renderBilan($('#bilanContent'), EXP, k);
}

function renderMerchantList() {
  const names = [...new Set(EXP.map(e => e.merchant).filter(Boolean))].sort();
  $('#merchantList').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
}

/* =========================================================
   Capture et lecture
   ========================================================= */

let queue = [];
let cancelled = false;

async function handleFiles(files) {
  queue = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!queue.length) return;
  cancelled = false;
  for (let i = 0; i < queue.length; i++) {
    if (cancelled) break;
    $('#ocrQueue').textContent = queue.length > 1 ? `Ticket ${i + 1} sur ${queue.length}` : '';
    await processOne(queue[i], i === queue.length - 1);
  }
  queue = [];
  hideOverlay();
}

function showOverlay(thumbUrl) {
  $('#ocrThumb').src = thumbUrl || '';
  $('#ocrBar').style.width = '0%';
  $('#ocrStatus').textContent = 'Préparation de l\'image…';
  $('#ocrOverlay').classList.remove('hidden');
}
const hideOverlay = () => $('#ocrOverlay').classList.add('hidden');

async function processOne(file, isLast) {
  const previewUrl = URL.createObjectURL(file);
  showOverlay(previewUrl);

  let photoId = null;
  let stored = null;
  try {
    if (SETTINGS.keepPhoto) {
      stored = await compressForStorage(file);
      photoId = db.uid();
      await db.putPhoto(photoId, stored);
    }
  } catch (err) {
    toast('Photo non enregistrée : ' + err.message);
  }

  let parsed = null, ocr = null;
  if (SETTINGS.autoOcr && !cancelled) {
    try {
      ocr = await readReceipt(stored || file, {
        onProgress: (label, p) => {
          $('#ocrStatus').textContent = label + '…';
          $('#ocrBar').style.width = Math.round(p * 100) + '%';
        },
      });
      if (ocr.text.replace(/\s/g, '').length < 12) {
        $('#ocrStatus').textContent = 'Texte peu lisible, nouvel essai…';
        const second = await readReceipt(stored || file, { mode: 'gray' });
        if (second.text.length > ocr.text.length) ocr = second;
      }
      parsed = parseReceipt(ocr.text);
    } catch (err) {
      toast('Lecture impossible : ' + (err.message || err));
    }
  }

  URL.revokeObjectURL(previewUrl);
  if (isLast) hideOverlay();

  const now = new Date();
  const e = {
    id: db.uid(),
    createdAt: Date.now(),
    date: parsed ? parsed.date.value : iso(now),
    merchant: parsed ? parsed.merchant.value : '',
    amount: parsed ? parsed.amount.value : null,
    category: 'divers',
    payment: 'CB',
    note: '',
    items: parsed ? parsed.items : [],
    vat: parsed ? parsed.vat : [],
    photoId,
    ocrText: ocr ? ocr.text : '',
    ocrMode: ocr ? ocr.mode : '',
    source: parsed ? 'ocr' : 'manuel',
    flags: parsed
      ? { amount: parsed.amount.confidence, date: parsed.date.confidence, merchant: parsed.merchant.confidence }
      : {},
    matchedTxId: null,
  };
  e.category = guessCategory(e.merchant, ocr ? ocr.text : '', LEARNED);

  if (queue.length > 1) {
    // traitement par lot : on enregistre et on vérifiera dans la liste
    e.needsCheck = !e.amount || e.flags.amount !== 'high';
    await db.putExpense(e);
    await reload();
  } else {
    openEditor(e, true);
  }
}

/* =========================================================
   Éditeur
   ========================================================= */

function buildCategoryChips() {
  $('#edCats').innerHTML = CATEGORIES.map(c =>
    `<button type="button" class="chip" data-cat="${c.id}"><i style="background:${c.color}"></i>${c.label}</button>`).join('');
  $$('#edCats .chip').forEach(b => b.addEventListener('click', () => {
    $$('#edCats .chip').forEach(x => x.classList.toggle('is-active', x === b));
  }));
}

function buildPaymentSegments() {
  const modes = ['CB', 'Espèces', 'Autre'];
  $('#edPay').innerHTML = modes.map(m => `<button type="button" class="chip" data-pay="${m}">${m}</button>`).join('');
  $$('#edPay .chip').forEach(b => b.addEventListener('click', () => {
    $$('#edPay .chip').forEach(x => x.classList.toggle('is-active', x === b));
  }));
}

const FLAG = { high: ['flag-ok', 'lu'], low: ['flag-check', 'à vérifier'] };

function setFlag(sel, conf) {
  const el = $(sel);
  el.className = 'flag';
  el.textContent = '';
  if (!conf || !FLAG[conf]) return;
  el.classList.add(FLAG[conf][0]);
  el.textContent = FLAG[conf][1];
}

async function openEditor(e, isNew = false) {
  if (!e) return;
  current = { ...e, isNew };

  $('#edTitle').textContent = isNew ? 'Nouvelle dépense' : 'Modifier';
  $('#edAmount').value = e.amount != null ? num2(e.amount) : '';
  $('#edMerchant').value = e.merchant || '';
  $('#edDate').value = e.date || iso(new Date());
  $('#edNote').value = e.note || '';

  $$('#edCats .chip').forEach(b => b.classList.toggle('is-active', b.dataset.cat === (e.category || 'divers')));
  $$('#edPay .chip').forEach(b => b.classList.toggle('is-active', b.dataset.pay === (e.payment || 'CB')));

  const f = e.flags || {};
  setFlag('#edAmountFlag', f.amount);
  setFlag('#edDateFlag', f.date);
  setFlag('#edMerchantFlag', f.merchant);

  // photo
  const wrap = $('#edPhotoWrap');
  if (e.photoId) {
    const blob = await db.getPhoto(e.photoId);
    if (blob) {
      const url = urlCache.get(e.photoId) || URL.createObjectURL(blob);
      urlCache.set(e.photoId, url);
      $('#edPhoto').src = url;
      wrap.classList.remove('hidden');
    } else wrap.classList.add('hidden');
  } else wrap.classList.add('hidden');

  // articles
  const items = e.items || [];
  $('#edItemsBox').classList.toggle('hidden', !items.length);
  $('#edItemsCount').textContent = items.length;
  $('#edItems').innerHTML = items.map(it =>
    `<div class="item-row"><span>${esc(it.label)}</span><span>${num2(it.price)} €</span></div>`).join('');

  // texte brut
  $('#edRawBox').classList.toggle('hidden', !e.ocrText);
  $('#edRaw').textContent = e.ocrText || '';
  $('#btnReOcr').classList.toggle('hidden', !e.photoId);

  $('#btnEdDelete').classList.toggle('hidden', isNew);
  $('#editor').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  if (isNew && (e.amount == null)) setTimeout(() => $('#edAmount').focus(), 150);
}

function closeEditor() {
  $('#editor').classList.add('hidden');
  document.body.style.overflow = '';
  current = null;
}

function parseAmountInput(v) {
  const t = String(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const n = parseFloat(t);
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

async function saveEditor() {
  if (!current) return;
  const amount = parseAmountInput($('#edAmount').value);
  if (amount == null || amount <= 0) { toast('Indiquez un montant'); $('#edAmount').focus(); return; }

  const wasNew = !!current.isNew;
  const merchant = $('#edMerchant').value.trim();
  const category = ($('#edCats .chip.is-active') || {}).dataset?.cat || 'divers';
  const payment = ($('#edPay .chip.is-active') || {}).dataset?.pay || 'CB';

  const e = {
    ...current,
    amount,
    merchant,
    date: $('#edDate').value || iso(new Date()),
    category,
    payment,
    note: $('#edNote').value.trim(),
    needsCheck: false,
  };
  delete e.isNew;

  if (merchant) { LEARNED = learn(LEARNED, merchant, category); await db.setMeta('learned', LEARNED); }
  await db.putExpense(e);
  closeEditor();
  await reload();
  toast(wasNew ? 'Dépense enregistrée' : 'Modification enregistrée');
}

async function deleteCurrent() {
  if (!current) return;
  if (!(await confirmBox('Supprimer cette dépense et sa photo ?'))) return;
  await db.delExpense(current.id);
  if (current.photoId) await db.delPhoto(current.photoId);
  closeEditor();
  await reload();
  toast('Dépense supprimée');
}

async function reOcr() {
  if (!current || !current.photoId) return;
  const blob = await db.getPhoto(current.photoId);
  if (!blob) return;
  const mode = current.ocrMode === 'binary' ? 'gray' : 'binary';
  showOverlay($('#edPhoto').src);
  try {
    const ocr = await readReceipt(blob, {
      mode,
      onProgress: (label, p) => {
        $('#ocrStatus').textContent = label + '…';
        $('#ocrBar').style.width = Math.round(p * 100) + '%';
      },
    });
    const parsed = parseReceipt(ocr.text);
    hideOverlay();
    const merged = {
      ...current,
      ocrText: ocr.text,
      ocrMode: mode,
      items: parsed.items.length ? parsed.items : current.items,
      vat: parsed.vat.length ? parsed.vat : current.vat,
      amount: parsed.amount.value != null ? parsed.amount.value : current.amount,
      date: parsed.date.value || current.date,
      merchant: parsed.merchant.value || current.merchant,
      flags: { amount: parsed.amount.confidence, date: parsed.date.confidence, merchant: parsed.merchant.confidence },
    };
    merged.category = guessCategory(merged.merchant, ocr.text, LEARNED);
    openEditor(merged, current.isNew);
    toast('Relecture terminée (mode ' + (mode === 'gray' ? 'contraste' : 'noir et blanc') + ')');
  } catch (err) {
    hideOverlay();
    toast('Relecture impossible : ' + (err.message || err));
  }
}

/* =========================================================
   Outils
   ========================================================= */

const scoped = key => (key ? EXP.filter(e => monthKey(e.date) === key) : EXP);
const stamp = key => (key || 'tout') + '_' + iso(new Date());

function exportCSV(kind) {
  const key = $('#expScope').value;
  const list = scoped(key).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return toast('Rien à exporter');
  const map = { releve: rowsReleve, detail: rowsDetail, articles: rowsArticles };
  const rows = map[kind](list);
  if (rows.length < 2) return toast('Aucun article détecté sur ces tickets');
  downloadCSV(rows, `depenses_${kind}_${stamp(key)}.csv`);
  toast(`${rows.length - 1} ligne${rows.length > 2 ? 's' : ''} exportée${rows.length > 2 ? 's' : ''}`);
}

async function exportZip() {
  const key = $('#zipScope').value;
  const list = scoped(key).filter(e => e.photoId);
  if (!list.length) return toast('Aucune photo à exporter');
  toast('Préparation de l\'archive…');
  const files = [];
  for (const e of list) {
    const blob = await db.getPhoto(e.photoId);
    if (!blob) continue;
    const buf = new Uint8Array(await blob.arrayBuffer());
    files.push({
      name: `${e.date}_${safeName(e.merchant)}_${num2(e.amount).replace(',', '-')}EUR.jpg`,
      data: buf,
      date: new Date(e.date),
    });
  }
  download(makeZip(files), `justificatifs_${stamp(key)}.zip`);
  toast(`${files.length} justificatif${files.length > 1 ? 's' : ''} exporté${files.length > 1 ? 's' : ''}`);
}

async function backup() {
  const photos = [];
  for (const e of EXP) {
    if (!e.photoId) continue;
    const blob = await db.getPhoto(e.photoId);
    if (blob) photos.push({ id: e.photoId, b64: await blobToB64(blob) });
  }
  const data = { version: 1, exportedAt: new Date().toISOString(), expenses: EXP, learned: LEARNED, settings: SETTINGS, photos };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `sauvegarde-depenses_${iso(new Date())}.json`);
  toast(`${EXP.length} dépenses et ${photos.length} photos sauvegardées`);
}

const blobToB64 = blob => new Promise(res => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.readAsDataURL(blob);
});

function b64ToBlob(b64, type = 'image/jpeg') {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type });
}

async function restore(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('Fichier illisible'); }
  if (!data || !Array.isArray(data.expenses)) return toast('Ce fichier n\'est pas une sauvegarde');
  if (!(await confirmBox(`Restaurer ${data.expenses.length} dépenses ? Les dépenses actuelles portant le même identifiant seront remplacées.`))) return;

  for (const p of data.photos || []) await db.putPhoto(p.id, b64ToBlob(p.b64));
  for (const e of data.expenses) await db.putExpense(e);
  if (data.learned) { LEARNED = data.learned; await db.setMeta('learned', LEARNED); }
  await reload();
  toast('Sauvegarde restaurée');
}

async function importBank(file) {
  const text = decodeCSV(await file.arrayBuffer());
  const { rows, skipped } = parseStatement(text);
  if (!rows.length) {
    $('#bankResult').innerHTML = `<p class="empty">Aucune opération reconnue dans ce fichier.</p>`;
    return;
  }
  await db.clearBank();
  for (const r of rows) await db.putBank(r);

  const res = reconcile(EXP, rows);
  for (const m of res.matched) {
    if (m.e.matchedTxId !== m.t.id) await db.putExpense({ ...m.e, matchedTxId: m.t.id });
  }
  await reload();

  const debits = rows.filter(r => r.amount < 0).length;
  const orphelines = res.lignesSansTicket.slice(0, 25);
  $('#bankResult').innerHTML = `
    <div class="pill pill-good">${res.matched.length} ticket${res.matched.length > 1 ? 's' : ''} pointé${res.matched.length > 1 ? 's' : ''}</div>
    <p class="tool-desc mt8">${rows.length} opérations lues (${debits} débits)${skipped ? `, ${skipped} lignes ignorées` : ''}.</p>
    ${res.expensesSansLigne.length ? `
      <div class="match-head">Tickets sans ligne bancaire (${res.expensesSansLigne.length})</div>
      ${res.expensesSansLigne.slice(0, 15).map(e =>
        `<div class="match-line"><span>${dateFR(e.date)} · ${esc(e.merchant || '—')}</span><b>${eur(e.amount)}</b></div>`).join('')}` : ''}
    ${orphelines.length ? `
      <div class="match-head">Débits sans ticket (${res.lignesSansTicket.length})</div>
      ${orphelines.map(t =>
        `<div class="match-line"><span>${dateFR(t.date)} · ${esc(t.label.slice(0, 40))}</span><b>${eur(Math.abs(t.amount))}</b></div>`).join('')}` : ''}
  `;
}

async function refreshEngineState() {
  const el = $('#engineState');
  const ok = await isEngineCached();
  el.className = 'pill ' + (ok ? 'pill-good' : 'pill-warn');
  el.textContent = ok ? 'Moteur disponible hors ligne' : 'Moteur pas encore téléchargé';
  $('#btnEngine').textContent = ok ? 'Vérifier / re-télécharger' : 'Télécharger le moteur (4,5 Mo)';
}

async function refreshStorage() {
  const est = await db.storageEstimate();
  if (!est || !est.usage) return;
  $('#storageInfo').textContent =
    `Espace utilisé : ${(est.usage / 1048576).toFixed(1)} Mo`;
}

/* =========================================================
   Utilitaires d'interface
   ========================================================= */

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

function confirmBox(text) {
  return new Promise(resolve => {
    $('#confirmText').textContent = text;
    $('#confirm').classList.remove('hidden');
    const done = v => {
      $('#confirm').classList.add('hidden');
      $('#confirmYes').removeEventListener('click', yes);
      $('#confirmNo').removeEventListener('click', no);
      resolve(v);
    };
    const yes = () => done(true), no = () => done(false);
    $('#confirmYes').addEventListener('click', yes);
    $('#confirmNo').addEventListener('click', no);
  });
}

/* =========================================================
   Câblage
   ========================================================= */

function wire() {
  $$('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.view)));

  $('#inpCamera').addEventListener('change', ev => { handleFiles(ev.target.files); ev.target.value = ''; });
  $('#inpGallery').addEventListener('change', ev => { handleFiles(ev.target.files); ev.target.value = ''; });
  $('#btnManual').addEventListener('click', () => openEditor({
    id: db.uid(), createdAt: Date.now(), date: iso(new Date()), merchant: '', amount: null,
    category: 'divers', payment: 'CB', note: '', items: [], vat: [], photoId: null,
    ocrText: '', source: 'manuel', flags: {}, matchedTxId: null,
  }, true));

  $('#btnOcrCancel').addEventListener('click', () => { cancelled = true; hideOverlay(); });

  $('#btnEdClose').addEventListener('click', closeEditor);
  $('#btnEdSave').addEventListener('click', saveEditor);
  $('#btnEdDelete').addEventListener('click', deleteCurrent);
  $('#btnReOcr').addEventListener('click', reOcr);
  $('#btnZoom').addEventListener('click', () => {
    $('#zoomImg').src = $('#edPhoto').src;
    $('#zoomOverlay').classList.remove('hidden');
  });
  $('#zoomOverlay').addEventListener('click', () => $('#zoomOverlay').classList.add('hidden'));

  ['#fSearch', '#fMonth', '#fCat'].forEach(s => $(s).addEventListener('input', renderList));
  $('#bMonth').addEventListener('change', renderBilanView);

  $('#btnExpSimple').addEventListener('click', () => exportCSV('releve'));
  $('#btnExpDetail').addEventListener('click', () => exportCSV('detail'));
  $('#btnExpArticles').addEventListener('click', () => exportCSV('articles'));
  $('#btnZip').addEventListener('click', exportZip);
  $('#btnBackup').addEventListener('click', backup);
  $('#inpRestore').addEventListener('change', ev => { if (ev.target.files[0]) restore(ev.target.files[0]); ev.target.value = ''; });
  $('#inpBank').addEventListener('change', ev => { if (ev.target.files[0]) importBank(ev.target.files[0]); ev.target.value = ''; });

  $('#btnEngine').addEventListener('click', async () => {
    const b = $('#btnEngine');
    b.disabled = true;
    b.textContent = 'Téléchargement…';
    try {
      await downloadEngine(p => { b.textContent = `Téléchargement… ${Math.round(p * 100)} %`; });
      toast('Moteur prêt : la lecture fonctionne hors ligne');
    } catch (err) {
      toast('Échec du téléchargement : ' + (err.message || err));
    }
    b.disabled = false;
    refreshEngineState();
  });

  $('#optAutoOcr').addEventListener('change', async ev => {
    SETTINGS.autoOcr = ev.target.checked;
    await db.setMeta('settings', SETTINGS);
  });
  $('#optKeepPhoto').addEventListener('change', async ev => {
    SETTINGS.keepPhoto = ev.target.checked;
    await db.setMeta('settings', SETTINGS);
  });

  $('#btnWipe').addEventListener('click', async () => {
    if (!(await confirmBox('Effacer toutes les dépenses, photos et réglages ? Cette action est définitive.'))) return;
    await db.wipeAll();
    LEARNED = {};
    await reload();
    toast('Tout a été effacé');
  });

  $('#btnHelp').addEventListener('click', () => toast(
    'Photographiez le ticket bien à plat, cadré serré. L\'app lit le montant, la date et le commerçant, à vous de vérifier.'));

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      if (!$('#zoomOverlay').classList.contains('hidden')) $('#zoomOverlay').classList.add('hidden');
      else if (!$('#editor').classList.contains('hidden')) closeEditor();
    }
  });
}

boot();
