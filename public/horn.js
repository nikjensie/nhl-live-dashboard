// Målhorn i arenastil, syntetiserat med Web Audio – ingen ljudfil behövs.
// Ett djupt, brummande ackord av sågtandsvågor genom distortion och lågpassfilter.

let ctx = null;

function context() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Måste anropas från ett klick/tryck – webbläsare låser ljud tills användaren interagerat. */
export async function unlock() {
  const c = context();
  if (!c) return false;
  if (c.state !== 'running') {
    try { await c.resume(); } catch {}
  }
  return c.state === 'running';
}

export const isUnlocked = () => !!ctx && ctx.state === 'running';

function distortionCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

/**
 * Spela hornet. duration i sekunder (standard 3,2 s), volume 0–1.
 * Returnerar false om ljudet är låst eller saknas.
 */
export function playHorn({ duration = 3.2, volume = 0.55 } = {}) {
  const c = ctx;
  if (!c || c.state !== 'running') return false;
  const t0 = c.currentTime + 0.02;
  const end = t0 + duration;

  const master = c.createGain();
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(volume, t0 + 0.09);   // snabb men inte klickig attack
  master.gain.setValueAtTime(volume, end - 0.45);
  master.gain.exponentialRampToValueAtTime(0.0001, end);          // mjuk avklingning

  const lowpass = c.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(900, t0);
  lowpass.frequency.exponentialRampToValueAtTime(2200, t0 + 0.25); // hornet "öppnar sig"
  lowpass.Q.value = 0.9;

  const shaper = c.createWaveShaper();
  shaper.curve = distortionCurve(6);
  shaper.oversample = '2x';

  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;

  shaper.connect(lowpass).connect(master).connect(comp).connect(c.destination);

  // Ackord i stil med klassiska arenahorn (låg, lätt dissonant treklang + oktav)
  const freqs = [138.6, 174.6, 207.7, 69.3];
  const oscs = [];
  for (const f of freqs) {
    for (const detune of [-7, 6]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.97, t0);                    // tonen glider upp lite i början
      o.frequency.exponentialRampToValueAtTime(f, t0 + 0.12);
      o.detune.value = detune;
      const g = c.createGain();
      g.gain.value = f < 100 ? 0.16 : 0.11;
      o.connect(g).connect(shaper);
      o.start(t0);
      o.stop(end + 0.05);
      oscs.push(o);
    }
  }
  return true;
}
