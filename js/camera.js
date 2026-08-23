/**
 * Appareil photo intégré.
 *
 * Pourquoi ne pas utiliser l'appareil photo du téléphone : sur Android, ouvrir
 * l'application Appareil photo met la page en arrière-plan, et un téléphone
 * qui manque de mémoire la recharge au retour. La photo est alors perdue sans
 * le moindre message. En capturant dans la page, on ne quitte jamais
 * l'application.
 */

let stream = null;
let track = null;
let resolveShot = null;

const $ = s => document.querySelector(s);

const CONTRAINTES = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 2560 },
    height: { ideal: 1920 },
  },
};

/**
 * Ouvre l'appareil photo et rend la main quand la photo est prise.
 * @returns {Promise<Blob|null>} la photo, ou null si l'utilisateur annule.
 */
export async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Appareil photo non disponible dans ce navigateur');
  }

  stream = await navigator.mediaDevices.getUserMedia(CONTRAINTES);
  track = stream.getVideoTracks()[0];

  const video = $('#camVideo');
  video.srcObject = stream;
  await video.play().catch(() => {});

  // lampe : proposée seulement si le capteur la gère
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  $('#camTorch').classList.toggle('hidden', !caps.torch);
  $('#camTorch').classList.remove('is-on');

  const r = track.getSettings ? track.getSettings() : {};
  $('#camInfo').textContent = r.width && r.height ? `${r.width} × ${r.height}` : '';

  $('#camOverlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  return new Promise(res => { resolveShot = res; });
}

export function closeCamera(blob = null) {
  $('#camOverlay').classList.add('hidden');
  document.body.style.overflow = '';
  const v = $('#camVideo');
  v.pause();
  v.srcObject = null;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; track = null;
  if (resolveShot) { const r = resolveShot; resolveShot = null; r(blob); }
}

/** Déclenche la prise de vue, en pleine résolution quand le téléphone le permet. */
export async function shoot() {
  if (!track) return closeCamera(null);

  let blob = null;
  // 1. vraie photo du capteur, meilleure définition pour la lecture du texte
  if (window.ImageCapture) {
    try {
      const ic = new ImageCapture(track);
      blob = await ic.takePhoto();
    } catch { blob = null; }
  }
  // 2. repli : image du flux vidéo
  if (!blob) {
    const v = $('#camVideo');
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  }
  closeCamera(blob);
}

export async function toggleTorch() {
  if (!track) return;
  const btn = $('#camTorch');
  const on = !btn.classList.contains('is-on');
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    btn.classList.toggle('is-on', on);
  } catch { /* certains téléphones refusent, on ignore */ }
}

export const cameraSupportee = () =>
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);
