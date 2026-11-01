// Radiospelare för lagens egna sändningar (HLS/AAC från NHL).
// Safari spelar HLS direkt; övriga webbläsare använder hls.js som laddas först vid behov.

let audio = null;
let hls = null;
let current = null; // { key, label, url }
let listeners = new Set();

const notify = () => listeners.forEach((fn) => fn(current, audio));
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const nowPlaying = () => current;
export const isPaused = () => !audio || audio.paused;

function el() {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'none';
    for (const ev of ['play', 'pause', 'playing', 'waiting', 'error']) audio.addEventListener(ev, notify);
  }
  return audio;
}

let hlsLoading = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  hlsLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/hls.light.min.js';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => { hlsLoading = null; reject(new Error('Kunde inte ladda spelaren')); };
    document.head.append(s);
  });
  return hlsLoading;
}

/** Anropas direkt i klicket: aktiverar ljudelementet så att uppspelning efter nätverksanrop tillåts (Safari). */
export function prime() {
  const a = el();
  if (!a.src) { a.muted = true; a.play().catch(() => {}); a.pause(); a.muted = false; }
}

export function stop() {
  if (hls) { hls.destroy(); hls = null; }
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  current = null;
  notify();
}

/** Starta en ström. Måste anropas från ett klick (webbläsarnas regler för ljud). */
export async function play(info) {
  const { key, url } = info;
  stop();
  const a = el();
  current = { ...info, loading: true };
  notify();
  try {
    if (a.canPlayType('application/vnd.apple.mpegurl')) {
      a.src = url;
    } else {
      const Hls = await loadHls();
      if (!Hls?.isSupported()) throw new Error('Webbläsaren kan inte spela strömmen');
      if (current?.key !== key) return; // användaren hann byta
      hls = new Hls({ lowLatencyMode: false, liveSyncDurationCount: 3 });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else { current = { ...current, error: 'Sändningen gick inte att spela' }; notify(); }
      });
      hls.loadSource(url);
      hls.attachMedia(a);
    }
    await a.play();
    current = { ...current, loading: false };
  } catch (err) {
    current = { ...current, loading: false, error: err.message || 'Sändningen gick inte att spela' };
  }
  notify();
}

export function toggle() {
  if (!audio || !current) return;
  if (audio.paused) {
    // Hoppa till livepunkten igen efter paus
    if (hls?.liveSyncPosition) audio.currentTime = hls.liveSyncPosition;
    audio.play().catch(() => {});
  } else audio.pause();
}
