/**
 * Lecture du ticket : préparation de l'image puis reconnaissance de texte
 * par Tesseract, entièrement en local (aucun appel réseau une fois le moteur
 * téléchargé).
 */

/**
 * Chemins absolus, calculés depuis l'emplacement de ce module.
 * Indispensable : Tesseract lance son worker depuis une URL blob, où un
 * chemin relatif n'a plus de base valable, et l'application peut être servie
 * depuis un sous-dossier (GitHub Pages) autant que depuis la racine.
 */
const BASE = new URL('../', import.meta.url).href;

const V = {
  lib:    BASE + 'vendor/tesseract/tesseract.min.js',
  worker: BASE + 'vendor/tesseract/worker.min.js',
  core:   BASE + 'vendor/tesseract/',
  lang:   BASE + 'vendor/lang',
};

export const OCR_CACHE = 'depenses-cb-ocr-v1';
export const ENGINE_FILES = [
  V.lib, V.worker,
  BASE + 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  BASE + 'vendor/lang/fra.traineddata',
];

/* ---------------- préparation de l'image ---------------- */

/** Décode en respectant l'orientation EXIF du téléphone. */
async function decode(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(blob);
  }
}

function drawScaled(bmp, maxDim) {
  const r = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * r));
  const h = Math.max(1, Math.round(bmp.height * r));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, w, h);
  return c;
}

/** Version compressée conservée comme justificatif. */
export async function compressForStorage(blob, maxDim = 1400, quality = 0.72) {
  const bmp = await decode(blob);
  const c = drawScaled(bmp, maxDim);
  bmp.close && bmp.close();
  return await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
}

/**
 * Prépare l'image pour l'OCR.
 * mode 'binary' : seuillage adaptatif (Bradley) — le meilleur sur papier thermique.
 * mode 'gray'   : niveaux de gris avec étirement de contraste — repli si le
 *                 seuillage a mangé le texte (ticket sombre, reflet, ombre).
 */
export async function prepareForOcr(blob, mode = 'binary') {
  const bmp = await decode(blob);
  const c = drawScaled(bmp, 2000);
  bmp.close && bmp.close();

  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const { data, width: w, height: h } = img;

  // niveaux de gris (luminance perçue)
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  if (mode === 'gray') {
    const sorted = Float32Array.from(gray).sort();
    const lo = sorted[Math.floor(sorted.length * 0.02)];
    const hi = sorted[Math.floor(sorted.length * 0.98)];
    const span = Math.max(1, hi - lo);
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
      const v = Math.max(0, Math.min(255, ((gray[p] - lo) / span) * 255));
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  } else {
    // image intégrale pour une moyenne locale en temps constant
    const sum = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let run = 0;
      for (let x = 0; x < w; x++) {
        run += gray[y * w + x];
        sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + run;
      }
    }
    const rad = Math.max(8, Math.round(w / 20));
    const T = 0.88;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - rad), y1 = Math.min(h - 1, y + rad);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - rad), x1 = Math.min(w - 1, x + rad);
        const area = (y1 - y0 + 1) * (x1 - x0 + 1);
        const s = sum[(y1 + 1) * (w + 1) + x1 + 1] - sum[y0 * (w + 1) + x1 + 1]
                - sum[(y1 + 1) * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
        const v = gray[y * w + x] * area > s * T ? 255 : 0;
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ---------------- moteur Tesseract ---------------- */

let _libLoaded = null;
let _worker = null;

function loadLib() {
  if (_libLoaded) return _libLoaded;
  _libLoaded = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement('script');
    s.src = V.lib;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('Moteur de lecture introuvable'));
    document.head.appendChild(s);
  });
  return _libLoaded;
}

async function getWorker(onProgress) {
  if (_worker) return _worker;
  const T = await loadLib();
  _worker = await T.createWorker('fra', 1, {
    workerPath: V.worker,
    corePath: V.core,
    langPath: V.lang,
    gzip: false,   // fichier de langue stocké décompressé : aucun risque de double décompression selon l'hébergeur
    logger: m => {
      if (!onProgress) return;
      const map = {
        'loading tesseract core': 'Chargement du moteur',
        'initializing tesseract': 'Initialisation',
        'loading language traineddata': 'Chargement du français',
        'initializing api': 'Préparation',
        'recognizing text': 'Lecture du ticket',
      };
      onProgress(map[m.status] || 'Traitement', m.progress || 0);
    },
  });
  await _worker.setParameters({
    tessedit_pageseg_mode: '6',       // bloc de texte uniforme : adapté à un ticket
    preserve_interword_spaces: '1',
  });
  return _worker;
}

/**
 * Reconnaît le texte d'une photo de ticket.
 * @returns {Promise<{text: string, confidence: number, mode: string}>}
 */
export async function readReceipt(blob, { mode = 'binary', onProgress } = {}) {
  const canvas = await prepareForOcr(blob, mode);
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  return { text: data.text || '', confidence: data.confidence || 0, mode };
}

export async function releaseWorker() {
  if (_worker) { try { await _worker.terminate(); } catch {} _worker = null; }
}

/* ---------------- disponibilité hors ligne ---------------- */

export async function isEngineCached() {
  if (!('caches' in window)) return false;
  try {
    const c = await caches.open(OCR_CACHE);
    const hits = await Promise.all(ENGINE_FILES.map(f => c.match(f)));
    return hits.every(Boolean);
  } catch { return false; }
}

export async function downloadEngine(onProgress) {
  const c = await caches.open(OCR_CACHE);
  for (let i = 0; i < ENGINE_FILES.length; i++) {
    onProgress && onProgress(i / ENGINE_FILES.length);
    const f = ENGINE_FILES[i];
    if (await c.match(f)) continue;
    const res = await fetch(f);
    if (!res.ok) throw new Error('Téléchargement impossible : ' + f);
    await c.put(f, res.clone());
  }
  onProgress && onProgress(1);
  return true;
}
