/**
 * Service worker : rend l'application utilisable hors ligne.
 *
 * Deux caches distincts :
 *  - APP  : la coquille (HTML, CSS, JS, icônes), pré-chargée à l'installation ;
 *  - OCR  : le moteur de reconnaissance (~4,5 Mo), téléchargé à la demande
 *           depuis l'écran Outils ou au premier usage, jamais imposé.
 */

const APP_CACHE = 'depenses-cb-app-v7';
const OCR_CACHE = 'depenses-cb-ocr-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/db.js',
  'js/parse.js',
  'js/categories.js',
  'js/ocr.js',
  'js/camera.js',
  'js/export.js',
  'js/bilan.js',
  'js/bank.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

const isEngine = url =>
  url.includes('/vendor/tesseract/') || url.includes('/vendor/lang/');

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(APP_CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== APP_CACHE && k !== OCR_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Moteur OCR : cache d'abord, et on garde ce qui a été téléchargé.
  if (isEngine(url.pathname)) {
    ev.respondWith(
      caches.open(OCR_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // Coquille : cache d'abord, rafraîchie en arrière-plan.
  ev.respondWith(
    caches.open(APP_CACHE).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => hit);
      return hit || net;
    })
  );
});
