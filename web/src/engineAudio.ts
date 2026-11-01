// So del motor, sintetitzat amb Web Audio (sense fitxers de so). Cada bucle és una tira d'explosions
// d'un 4 cilindres, un xic desiguals: en variar-ne la velocitat de lectura amb les voltes, el to segueix
// el motor. Hi ha un bucle per a règim baix i un per a règim alt, perquè un de sol sonaria a joguina
// en estirar-lo de 850 a 6.000 voltes.

import { REDLINE_RPM } from "./vehicle";

type LoopVoice = {
  /** Voltes a què sona el bucle a velocitat normal. */
  rpm: number;
  /** Ressonàncies de l'escapament (Hz), de la més greu a la més aguda. */
  freqs: [number, number, number];
  /** Segons que triga a apagar-se cada ressonància. */
  decays: [number, number, number];
  /** Pes de cada ressonància. */
  weights: [number, number, number];
  seed: number;
};

// Al ralentí, el bucle baix sona a uns 0,45×. Si tot fos greu, els altaveus d'un mòbil o un portàtil,
// que gairebé no donen res per sota de 300 Hz, el deixarien mut: per això encara porta una mica de mitjos.
export const LOW_VOICE: LoopVoice = {
  rpm: 1400,
  freqs: [180, 620, 1400],
  decays: [0.012, 0.008, 0.004],
  weights: [1, 0.7, 0.28],
  seed: 12,
};
export const HIGH_VOICE: LoopVoice = {
  rpm: 4000,
  freqs: [210, 620, 1400],
  decays: [0.007, 0.004, 0.002],
  weights: [1, 0.42, 0.14],
  seed: 34,
};

/** Explosions per bucle. Múltiple de 4 perquè els cilindres, cadascun amb la seva força, encaixin. */
const PULSES = 48;
/** Un cilindre mai no empeny igual que els altres: d'aquí surt el batec del ralentí. */
const CYLINDER_STRENGTH = [1, 0.74, 0.93, 0.66];
/** Baixa el to de tot el motor. No és físic (un 4 cilindres aniria més agut), però sona més ple. */
const PITCH = 0.75;
/** Entre aquestes voltes es passa del bucle baix a l'alt. */
const CROSSFADE_RPM: [number, number] = [2200, 3000];
const MASTER_VOLUME = 0.42;
/** Voltes a partir de les quals talla el limitador, si s'accelera. La punta en 4a no hi arriba. */
const LIMITER_RPM = 5900;
const LIMITER_HZ = 17;
/** Segons entre dues actualitzacions dels paràmetres: l'àudio no necessita cada fotograma. */
const UPDATE_INTERVAL = 0.025;

/** Qualsevol d'aquests gestos permet que el navegador comenci a sonar. */
const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchend", "keydown", "click"] as const;

/** Generador pseudoaleatori amb llavor: el motor sona igual a cada partida. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un bucle sense costura: les cues de les darreres explosions continuen a l'inici de la tira. */
export function renderEngineLoop(voice: LoopVoice, sampleRate: number): Float32Array<ArrayBuffer> {
  const random = seededRandom(voice.seed);
  // Un 4 temps de 4 cilindres fa dues explosions per volta.
  const firingPeriod = 60 / (voice.rpm * 2);
  const length = Math.round(PULSES * firingPeriod * sampleRate);
  const out = new Float32Array(length);
  const spacing = length / PULSES;
  const [f1, f2, f3] = voice.freqs;
  const [d1, d2, d3] = voice.decays;
  const [w1, w2, w3] = voice.weights;
  const pulseLength = Math.round(d1 * 6 * sampleRate);
  for (let p = 0; p < PULSES; p++) {
    const strength = CYLINDER_STRENGTH[p % 4] * (0.92 + 0.16 * random());
    const start = Math.round(p * spacing + (random() - 0.5) * spacing * 0.05);
    const phase = random() * 0.6;
    for (let i = 0; i < pulseLength; i++) {
      const t = i / sampleRate;
      const noise = (random() - 0.5) * Math.exp(-t / d3);
      const sample =
        w1 * Math.exp(-t / d1) * Math.sin(2 * Math.PI * f1 * t) +
        w2 * Math.exp(-t / d2) * Math.sin(2 * Math.PI * f2 * t + phase) +
        w3 * Math.exp(-t / d3) * Math.sin(2 * Math.PI * f3 * t) +
        0.35 * noise;
      out[(((start + i) % length) + length) % length] += strength * sample;
    }
  }
  // Sense component contínua, i tots dos bucles al mateix nivell.
  const mean = out.reduce((sum, x) => sum + x, 0) / length;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    out[i] -= mean;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < length; i++) {
    out[i] *= 0.9 / peak;
  }
  return out;
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

type Graph = {
  master: GainNode;
  low: { source: AudioBufferSourceNode; gain: GainNode; rpm: number };
  high: { source: AudioBufferSourceNode; gain: GainNode; rpm: number };
  body: GainNode;
  filter: BiquadFilterNode;
  hiss: GainNode;
  hissFilter: BiquadFilterNode;
};

export class EngineAudio {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private enabled = true;
  private paused = false;
  private armed = false;
  private nextUpdate = 0;

  /** El joc ja s'ha carregat. El navegador no deixa sonar res fins que l'usuari toca alguna cosa. */
  arm(): void {
    if (this.armed) {
      return;
    }
    this.armed = true;
    const unlock = (): void => {
      this.start();
      if (this.ctx?.state === "running") {
        for (const type of UNLOCK_EVENTS) {
          window.removeEventListener(type, unlock, true);
        }
      }
    };
    for (const type of UNLOCK_EVENTS) {
      window.addEventListener(type, unlock, true);
    }
    // Si amaga la pestanya, el bucle del joc s'atura però el so seguiria amb les últimes voltes.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        void this.ctx?.suspend();
      } else if (this.enabled) {
        void this.ctx?.resume();
      }
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on && this.armed) {
      this.start();
    }
    this.applyMaster();
  }

  /** Opcions o mapa oberts: el joc està en pausa i el cotxe no es mou. */
  setPaused(paused: boolean): void {
    if (paused !== this.paused) {
      this.paused = paused;
      this.applyMaster();
    }
  }

  /** `load`: 0 amb el peu fora del gas, 1 a fons. */
  update(rpm: number, load: number): void {
    const { ctx, graph } = this;
    if (!ctx || !graph || ctx.currentTime < this.nextUpdate) {
      return;
    }
    const now = ctx.currentTime;
    this.nextUpdate = now + UPDATE_INTERVAL;
    const revs = Math.min(rpm / REDLINE_RPM, 1.1);

    graph.low.source.playbackRate.setTargetAtTime((PITCH * rpm) / graph.low.rpm, now, 0.02);
    graph.high.source.playbackRate.setTargetAtTime((PITCH * rpm) / graph.high.rpm, now, 0.02);
    // Mescla d'igual potència: el volum no baixa enmig del pas d'un bucle a l'altre.
    const mix = smoothstep(CROSSFADE_RPM[0], CROSSFADE_RPM[1], rpm) * (Math.PI / 2);
    graph.low.gain.gain.setTargetAtTime(Math.cos(mix), now, 0.03);
    graph.high.gain.gain.setTargetAtTime(Math.sin(mix), now, 0.03);

    // El limitador talla l'encesa unes quantes vegades per segon.
    const cut = rpm >= LIMITER_RPM && load > 0.1 && Math.sin(now * 2 * Math.PI * LIMITER_HZ) < 0;
    const level = (0.35 + 0.65 * load) * (0.7 + 0.3 * revs) * (cut ? 0.3 : 1);
    graph.body.gain.setTargetAtTime(level, now, cut ? 0.004 : 0.04);
    // Amb gas, l'escapament s'obre i el so es fa més brillant.
    graph.filter.frequency.setTargetAtTime(500 + rpm * (0.25 + 0.45 * load), now, 0.04);
    graph.hiss.gain.setTargetAtTime(0.008 + 0.04 * load * revs, now, 0.05);
    graph.hissFilter.frequency.setTargetAtTime(300 + rpm * 0.2, now, 0.05);
  }

  private start(): void {
    if (!this.enabled) {
      return;
    }
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.graph = this.buildGraph(this.ctx);
        this.applyMaster();
      }
      void this.ctx.resume();
    } catch {
      // Sense Web Audio el joc funciona igual, però mut.
      this.enabled = false;
    }
  }

  private applyMaster(): void {
    if (this.ctx && this.graph) {
      const volume = this.enabled && !this.paused ? MASTER_VOLUME : 0;
      this.graph.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.06);
    }
  }

  private buildGraph(ctx: AudioContext): Graph {
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const body = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    body.connect(filter);
    filter.connect(master);

    const voice = (v: LoopVoice): Graph["low"] => {
      const samples = renderEngineLoop(v, ctx.sampleRate);
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(body);
      source.start();
      return { source, gain, rpm: v.rpm };
    };
    const low = voice(LOW_VOICE);
    const high = voice(HIGH_VOICE);

    // L'aire de l'admissió i l'escapament: soroll filtrat que només es nota amb gas.
    const random = seededRandom(56);
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = random() * 2 - 1;
    }
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noise;
    noiseSource.loop = true;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.Q.value = 0.8;
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    noiseSource.connect(hissFilter);
    hissFilter.connect(hiss);
    hiss.connect(master);
    noiseSource.start();

    return { master, low, high, body, filter, hiss, hissFilter };
  }
}
