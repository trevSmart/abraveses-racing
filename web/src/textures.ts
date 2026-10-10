// Textures procedurals generades al navegador (sense recursos externs).
//
// - Textures de *detall* (mitjana ≈ 0,5): modulen el color que ja hi ha (ortofoto, color de
//   vèrtex) a escala del món; vegeu detail.ts. Es creen en espai lineal (no són colors).
//   Gairebé totes són grises; l'asfalt porta un pèl de color per còdol.
// - Textures de *color* (fullatge, escorça, pneumàtic, matrícula): mapes normals en sRGB.

import * as THREE from "three";

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Soroll de valor fractal i enrajolable (la graella de cada octava fa la volta). */
function fbm(size: number, baseCells: number, octaves: number, seed: number, persistence = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  const rng = mulberry32(seed);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) {
      lattice[i] = rng();
    }
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cells) * cells;
      const r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cells;
        const c1 = (x0 + 1) % cells;
        const a = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * sx;
        const b = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) {
    out[i] /= total;
  }
  return out;
}

/** Normalitza a mitjana 0,5 amb el contrast demanat (desviació ~ `contrast`). */
function normalizeDetail(v: Float32Array, contrast: number): Float32Array {
  let mean = 0;
  for (const x of v) mean += x;
  mean /= v.length;
  let varSum = 0;
  for (const x of v) varSum += (x - mean) ** 2;
  const sd = Math.sqrt(varSum / v.length) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    out[i] = Math.min(1, Math.max(0, 0.5 + ((v[i] - mean) / sd) * contrast));
  }
  return out;
}

/** Mida de les textures de detall. Es generen en carregar: 256 px és 4× més ràpid que 512 i, a
 * 1,5–3 m per repetició, encara són 6–12 mm per píxel. K escala les mides fixades en píxels. */
const DETAIL_SIZE = 256;
const K = DETAIL_SIZE / 512;

function grayTexture(size: number, values: Float32Array): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < values.length; i++) {
    const g = Math.round(values[i] * 255);
    data[i * 4] = g;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = g;
    data[i * 4 + 3] = 255;
  }
  return finishTexture(new THREE.DataTexture(data, size, size), false);
}

function finishTexture<T extends THREE.Texture>(tex: T, srgb: boolean): T {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Taques fosques o clares (còdols, grava) disperses, enrajolables. */
function speckles(v: Float32Array, size: number, count: number, rMin: number, rMax: number, delta: number, seed: number): void {
  const rng = mulberry32(seed);
  for (let n = 0; n < count; n++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const r = rMin + rng() * (rMax - rMin);
    const d = delta * (0.6 + rng() * 0.8) * (rng() < 0.5 ? -1 : 1);
    const ir = Math.ceil(r);
    for (let dy = -ir; dy <= ir; dy++) {
      for (let dx = -ir; dx <= ir; dx++) {
        const dist = Math.hypot(dx, dy) / r;
        if (dist > 1) continue;
        const x = (Math.floor(cx + dx) + size) % size;
        const y = (Math.floor(cy + dy) + size) % size;
        v[y * size + x] += d * (1 - dist * dist);
      }
    }
  }
}

// --- Detall (multiplicadors grisos) ---------------------------------------------------------

/** Terra en general (prats, camps, erms): gra fi, grumolls i alguna pedreta. ~3 m per repetició. */
export function groundDetail(): THREE.DataTexture {
  const size = DETAIL_SIZE;
  const v = fbm(size, 8, 5, 11, 0.55);
  const fine = fbm(size, 128, 2, 12);
  for (let i = 0; i < v.length; i++) v[i] = v[i] * 0.6 + fine[i] * 0.4;
  speckles(v, size, Math.round(900 * K * K), Math.max(0.5, 0.8 * K), 2.2 * K, 0.18, 13);
  return grayTexture(size, normalizeDetail(v, 0.16));
}

function cellHash(ix: number, iy: number, seed: number): number {
  let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Voronoi enrajolable: distància a la vora (F2−F1, en unitats de cel·la) i id de la cel·la. */
function voronoi(size: number, cells: number, seed: number, jitter: number): { edge: Float32Array; id: Int32Array } {
  const jx = new Float32Array(cells * cells);
  const jy = new Float32Array(cells * cells);
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const i = y * cells + x;
      jx[i] = (cellHash(x, y, seed) - 0.5) * jitter;
      jy[i] = (cellHash(x, y, seed + 17) - 0.5) * jitter;
    }
  }
  const edge = new Float32Array(size * size);
  const id = new Int32Array(size * size);
  const cs = size / cells;
  for (let y = 0; y < size; y++) {
    const cy = Math.floor(y / cs);
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cs);
      let f1 = 1e9;
      let f2 = 1e9;
      let best = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const iy = cy + oy;
        const ny = iy < 0 ? iy + cells : iy >= cells ? iy - cells : iy;
        for (let ox = -1; ox <= 1; ox++) {
          const ix = cx + ox;
          const nx = ix < 0 ? ix + cells : ix >= cells ? ix - cells : ix;
          const pi = ny * cells + nx;
          const dx = x - (ix + jx[pi]) * cs;
          const dy = y - (iy + jy[pi]) * cs;
          const d = Math.hypot(dx, dy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            best = pi;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
      edge[row + x] = (f2 - f1) / cs;
      id[row + x] = best;
    }
  }
  return { edge, id };
}

function cellTones(cells: number, seed: number): { tone: Float32Array; tint: Float32Array; h: Float32Array } {
  const n = cells * cells;
  const tone = new Float32Array(n);
  const tint = new Float32Array(n);
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % cells;
    const y = (i / cells) | 0;
    const hv = cellHash(x, y, seed);
    const u = cellHash(x, y, seed + 4);
    h[i] = hv;
    tint[i] = (cellHash(x, y, seed + 8) - 0.5) * 0.04;
    // Gairebé el mateix gris: uns pocs còdols clars i algun de fosc. Un mosaic de colors
    // es llegeix com a terratzo, no com a asfalt.
    tone[i] = hv < 0.06 ? 0.66 + u * 0.16 : hv > 0.94 ? 0.42 + u * 0.04 : 0.5 + (u - 0.5) * 0.045;
  }
  return { tone, tint, h };
}

function faceMask(edge: number): number {
  const t = Math.min(1, Math.max(0, (edge - 0.012) / 0.055));
  return t * t * (3 - 2 * t);
}

function blurWrap(src: Float32Array, size: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < size; y++) {
    const y0 = (y + size - 1) % size;
    const y1 = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const x0 = (x + size - 1) % size;
      const x1 = (x + 1) % size;
      out[y * size + x] =
        (src[y0 * size + x0] + src[y0 * size + x] + src[y0 * size + x1] +
          src[y * size + x0] + src[y * size + x] + src[y * size + x1] +
          src[y1 * size + x0] + src[y1 * size + x] + src[y1 * size + x1]) / 9;
    }
  }
  return out;
}

export type AsphaltMaps = {
  /** Color lineal, mitjana ≈ 0,5: multiplica el gris de la calçada. */
  albedo: THREE.DataTexture;
  /** RGB = normal tangent (128, 128, 255 pla); A = rugositat. */
  surface: THREE.DataTexture;
};

/** Asfalt gastat de carrer: àrid fi atapeït, alguns còdols més grossos, junta de betum i relleu
 * a la vora de cada pedra. ~4 m per repetició (vegeu `scaleM` a main.ts). Les esquerdes i les
 * taques grosses les posa el shader, en coordenades del món, perquè no es repeteixin amb la rajola. */
export function asphaltMaps(): AsphaltMaps {
  const size = 1024;
  const coarseCells = 70;
  const fineCells = 210;
  const coarse = voronoi(size, coarseCells, 21, 0.9);
  const fine = voronoi(size, fineCells, 44, 0.92);
  const grit = fbm(size, 64, 2, 7);
  const cTone = cellTones(coarseCells, 3);
  const fTone = cellTones(fineCells, 19);
  const r = new Float32Array(size * size);
  const g = new Float32Array(size * size);
  const b = new Float32Array(size * size);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  let lumSum = 0;
  for (let i = 0; i < r.length; i++) {
    const cid = coarse.id[i];
    const isCoarse = cTone.h[cid] < 0.28 && coarse.edge[i] > 0.03;
    const tone = isCoarse ? cTone.tone[cid] : fTone.tone[fine.id[i]];
    const tint = isCoarse ? cTone.tint[cid] : fTone.tint[fine.id[i]];
    const face = faceMask(isCoarse ? coarse.edge[i] : fine.edge[i]);
    const mineral = 0.96 + (grit[i] - 0.5) * 0.08;
    // La junta enfosqueix poc: si baixa gaire, la xarxa entre còdols es veu com línies negres.
    const ao = 0.84 + 0.16 * face;
    r[i] = (tone + tint) * mineral * ao;
    g[i] = tone * mineral * ao;
    b[i] = (tone - tint * 0.65) * mineral * ao;
    lumSum += 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
    const top = isCoarse ? 0.55 + 0.4 * cTone.h[cid] : 0.35 + 0.4 * fTone.h[fine.id[i]];
    height[i] = Math.min(1, Math.max(0, top * (0.62 + 0.38 * face) + (grit[i] - 0.5) * 0.04));
    rough[i] = 0.46 + 0.42 * face;
  }
  const shift = 0.5 - lumSum / r.length;
  for (let i = 0; i < r.length; i++) {
    r[i] = Math.min(1, Math.max(0, r[i] + shift));
    g[i] = Math.min(1, Math.max(0, g[i] + shift));
    b[i] = Math.min(1, Math.max(0, b[i] + shift));
  }
  const rb = blurWrap(r, size);
  const gb = blurWrap(g, size);
  const bb = blurWrap(b, size);
  r.set(rb);
  g.set(gb);
  b.set(bb);
  const h = blurWrap(height, size);
  const albedo = new Uint8Array(size * size * 4);
  const surface = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const y0 = (y + size - 1) % size;
    const y1 = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const x0 = (x + size - 1) % size;
      const x1 = (x + 1) % size;
      const i = y * size + x;
      const dx = (h[y * size + x0] - h[y * size + x1]) * 1.15;
      const dy = (h[y0 * size + x] - h[y1 * size + x]) * 1.15;
      const len = Math.hypot(dx, dy, 1);
      albedo[i * 4] = Math.round(r[i] * 255);
      albedo[i * 4 + 1] = Math.round(g[i] * 255);
      albedo[i * 4 + 2] = Math.round(b[i] * 255);
      albedo[i * 4 + 3] = 255;
      surface[i * 4] = Math.round((dx / len * 0.5 + 0.5) * 255);
      surface[i * 4 + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
      surface[i * 4 + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      surface[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, rough[i])) * 255);
    }
  }
  return {
    albedo: finishTexture(new THREE.DataTexture(albedo, size, size), false),
    surface: finishTexture(new THREE.DataTexture(surface, size, size), false),
  };
}

/** Camí de terra: sorra fina, grava i algun còdol. ~2 m per repetició. Sense franges: la textura
 * es projecta des de dalt amb els eixos del món i uns solcs no seguirien la direcció del camí. */
export function dirtDetail(): THREE.DataTexture {
  const size = DETAIL_SIZE;
  const v = fbm(size, 12, 4, 31, 0.55);
  const grain = fbm(size, 128, 2, 33);
  for (let i = 0; i < v.length; i++) v[i] = v[i] * 0.55 + grain[i] * 0.45;
  speckles(v, size, Math.round(2600 * K * K), Math.max(0.5, 0.5 * K), 1.6 * K, 0.22, 32);
  speckles(v, size, Math.round(260 * K * K), 1.5 * K, 4.0 * K, 0.18, 34);
  return grayTexture(size, normalizeDetail(v, 0.15));
}

/** Arrebossat de façana: taques, regalims verticals i gra. ~2,5 m per repetició. */
export function plasterDetail(): THREE.DataTexture {
  const size = DETAIL_SIZE;
  const v = fbm(size, 6, 5, 41, 0.5);
  const grain = fbm(size, 128, 1, 42);
  const rng = mulberry32(43);
  for (let i = 0; i < v.length; i++) v[i] = v[i] * 0.75 + grain[i] * 0.25;
  // Regalims de pluja: franges verticals fosques que s'esvaeixen cap avall.
  for (let n = 0; n < 40; n++) {
    const x0 = Math.floor(rng() * size);
    const w = Math.max(1, Math.round((2 + Math.floor(rng() * 6)) * K));
    const len = size * (0.15 + rng() * 0.4);
    const y0 = Math.floor(rng() * size);
    for (let y = 0; y < len; y++) {
      for (let dx = 0; dx < w; dx++) {
        const idx = (((y0 + y) % size) * size) + ((x0 + dx) % size);
        v[idx] -= 0.08 * (1 - y / len);
      }
    }
  }
  return grayTexture(size, normalizeDetail(v, 0.12));
}

/** Vidre de finestres: pla, blau-gris uniforme amb un toc de grà (estil joc, no foto). */
export function windowGlassMap(): THREE.DataTexture {
  const size = 64;
  const n = fbm(size, 6, 2, 771, 0.4);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const grain = n[i];
      const base = 0.26 + grain * 0.035;
      const r = Math.round(255 * base);
      const g = Math.round(255 * (base + 0.025));
      const b = Math.round(255 * (base + 0.055));
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  return finishTexture(tex, true);
}

/** Maçoneria (església, ermita): filades irregulars de blocs amb junta fosca. ~3 m per repetició. */
export function stoneDetail(): THREE.DataTexture {
  const size = DETAIL_SIZE;
  const noise = fbm(size, 32, 3, 51);
  const v = new Float32Array(size * size);
  const rng = mulberry32(52);
  const rows = 10;
  const rowH = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = rng() * 40 * K;
    const blocks: { x0: number; x1: number; tone: number }[] = [];
    while (x < size + 60 * K) {
      const w = (36 + rng() * 60) * K;
      blocks.push({ x0: x, x1: x + w, tone: 0.4 + rng() * 0.25 });
      x += w;
    }
    for (let y = Math.floor(r * rowH); y < Math.floor((r + 1) * rowH); y++) {
      const ly = y - r * rowH;
      for (let px = 0; px < size; px++) {
        const b = blocks.find((bl) => (px >= bl.x0 && px < bl.x1) || (px + size >= bl.x0 && px + size < bl.x1)) ?? blocks[0];
        const lx = Math.min(px - b.x0 < 0 ? px + size - b.x0 : px - b.x0, b.x1 - (px < b.x0 ? px + size : px));
        const edge = Math.min(ly, rowH - ly, lx);
        const mortar = edge < 3 * K ? 0.18 : 1;
        v[y * size + px] = mortar * (b.tone + noise[y * size + px] * 0.3);
      }
    }
  }
  return grayTexture(size, normalizeDetail(v, 0.2));
}

/** Paret de totxo a trencajunt. R = to del totxo (multiplicador, mitjana 0,5); G = màscara de la
 * junta de morter, que el shader pinta d'un color clar propi (vegeu `mortar` a detail.ts).
 * 21 filades × 9 totxos per repetició: a 3,15 m, totxos de 35 × 15 cm amb junta d'~1,2 cm. */
export function brickDetail(): THREE.DataTexture {
  const size = 512;
  const courses = 21;
  const bricks = 9;
  const joint = 2.2; // px
  const courseH = size / courses;
  const brickW = size / bricks;
  const rng = mulberry32(55);
  const noise = fbm(size, 64, 3, 56);
  const stain = fbm(size, 4, 3, 57);
  // To de cada totxo: poca variació, tots molt clars (sense trossos foscos ni molt cuits).
  const tone = Array.from({ length: courses * bricks }, () => 0.96 + rng() * 0.06);
  // Cada filada desplaçada mitja peça (trencajunt) amb una mica de desordre.
  const shift = Array.from({ length: courses }, (_, r) => (r % 2) * 0.5 + (rng() - 0.5) * 0.12);
  const v = new Float32Array(size * size);
  const mortar = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / courseH);
    const ly = y - row * courseH;
    for (let x = 0; x < size; x++) {
      const fx = x / brickW + shift[row];
      const col = ((Math.floor(fx) % bricks) + bricks) % bricks;
      const lx = (fx - Math.floor(fx)) * brickW;
      const i = y * size + x;
      // Distància a la junta, amb la vora del totxo una mica irregular.
      const edge = Math.min(ly, courseH - ly, lx, brickW - lx) + (noise[i] - 0.5) * 1.6;
      const m = Math.min(1, Math.max(0, (joint - edge) / 1.2 + 0.5));
      mortar[i] = m;
      // La vora del totxo, enfonsada respecte a la cara, queda una mica més fosca.
      const rim = edge < joint + 2 ? 0.94 : 1;
      const brick = tone[row * bricks + col] * rim * (0.94 + noise[i] * 0.1) * (0.97 + stain[i] * 0.06);
      // Al morter, el to només hi aporta un gra suau (el color el posa el shader).
      v[i] = brick * (1 - m) + (0.9 + noise[i] * 0.2) * m;
    }
  }
  const r = normalizeDetail(v, 0.07);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < r.length; i++) {
    data[i * 4] = Math.round(r[i] * 255);
    data[i * 4 + 1] = Math.round(mortar[i] * 255);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  return finishTexture(new THREE.DataTexture(data, size, size), false);
}

/** Teula àrab: canals arrodonits (ombrejat cilíndric), cavalcaments foscos i teules desiguals.
 * u = al llarg del carener (8 canals), v = pendent avall (4 filades). Repetició ~1,6 × 1,4 m. */
export function roofTileDetail(): THREE.DataTexture {
  const size = DETAIL_SIZE;
  const cols = 8;
  const rows = 4;
  const rng = mulberry32(61);
  const tone = Array.from({ length: cols * rows }, () => 0.85 + rng() * 0.3);
  const noise = fbm(size, 64, 2, 62);
  const v = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fr = (y / size) * rows;
    const row = Math.floor(fr);
    const ty = fr - row;
    for (let x = 0; x < size; x++) {
      // Les filades alternes es desplacen mitja teula, com quan es col·loquen.
      const fc = (x / size) * cols + (row % 2) * 0.5;
      const col = Math.floor(fc) % cols;
      const tx = fc - Math.floor(fc);
      const shade = 0.35 + 0.65 * Math.sin(Math.PI * tx); // canal: fosc a les vores, clar al llom
      const overlap = ty < 0.12 ? 0.55 + ty * 3.5 : 1; // ombra on la teula de dalt cavalca
      v[y * size + x] = shade * overlap * tone[row * cols + col] * (0.9 + noise[y * size + x] * 0.2);
    }
  }
  return grayTexture(size, normalizeDetail(v, 0.22));
}

// --- Color -------------------------------------------------------------------------------------

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  draw(ctx);
  return finishTexture(new THREE.CanvasTexture(c), srgb);
}

/** Fullatge: pinzellades de fulles clares i fosques. És un multiplicador lineal (mitjana ~0,85)
 * del color de la foto de cada arbre, no un color. */
export function foliageMap(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx) => {
    const rng = mulberry32(71);
    ctx.fillStyle = "rgb(232,232,232)";
    ctx.fillRect(0, 0, 256, 256);
    for (let n = 0; n < 1400; n++) {
      const x = rng() * 256;
      const y = rng() * 256;
      const l = Math.floor(150 + rng() * 105);
      ctx.fillStyle = `rgb(${l},${Math.min(255, l + 10)},${l})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 2 + rng() * 5, 1.5 + rng() * 3, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }, false);
}

/** Escorça: estries verticals irregulars. */
export function barkMap(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx) => {
    const rng = mulberry32(81);
    ctx.fillStyle = "rgb(120,96,72)";
    ctx.fillRect(0, 0, 128, 128);
    for (let n = 0; n < 160; n++) {
      const x = rng() * 128;
      const l = Math.floor(60 + rng() * 90);
      ctx.strokeStyle = `rgb(${l},${Math.floor(l * 0.82)},${Math.floor(l * 0.62)})`;
      ctx.lineWidth = 1 + rng() * 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + rng() * 8 - 4, 40, x + rng() * 8 - 4, 90, x + rng() * 6 - 3, 128);
      ctx.stroke();
    }
  });
}

/** Banda de rodolament del pneumàtic (u = al voltant, v = amplada) i flanc. */
export function tyreMap(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx) => {
    ctx.fillStyle = "#1c1c1f";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#0d0d0f";
    // Dibuix en V: blocs alternats a banda i banda d'un solc central.
    for (let i = 0; i < 32; i++) {
      const x = i * 8;
      ctx.fillRect(x, 20, 4, 90);
      ctx.fillRect(x + 4, 146, 4, 90);
    }
    ctx.fillRect(0, 122, 256, 12);
  });
}

/** Matrícula espanyola de l'època (província de Zamora), amb la proporció real de 520 × 110 mm. */
export function plateMap(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 520;
  c.height = 110;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f4f4ee";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
  ctx.fillStyle = "#111";
  ctx.font = "bold 78px 'Arial Narrow', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2 + 4, c.width - 30);
  const tex = finishTexture(new THREE.CanvasTexture(c), true);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Planta d'hort / arbust per a plans creuats: fulles que surten de la base, fons transparent.
 * Grisos (multiplicador lineal del color de la foto de cada planta), alfa per al retall. */
export function plantSpriteMap(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const rng = mulberry32(91);
  const baseX = size / 2;
  const baseY = size - 6;
  // Primer les fulles del fons (més fosques), després les del davant (més clares).
  for (let layer = 0; layer < 2; layer++) {
    const count = layer === 0 ? 34 : 46;
    for (let n = 0; n < count; n++) {
      const spread = (rng() * 2 - 1) * (Math.PI * 0.46);
      const len = size * (0.38 + rng() * 0.5) * (1 - Math.abs(spread) * 0.35);
      const dirX = Math.sin(spread);
      const dirY = -Math.cos(spread);
      const tipX = baseX + dirX * len;
      const tipY = baseY + dirY * len;
      const l = layer === 0 ? 120 + rng() * 60 : 170 + rng() * 85;
      // Tija.
      ctx.strokeStyle = `rgb(${l * 0.8},${l * 0.85},${l * 0.7})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(baseX + (rng() - 0.5) * 10, baseY);
      ctx.quadraticCurveTo(baseX + dirX * len * 0.3, baseY + dirY * len * 0.55, tipX, tipY);
      ctx.stroke();
      // Fulla: el·lipse al llarg de la tija, a la part de dalt.
      const leafLen = 22 + rng() * 34;
      const leafW = 8 + rng() * 12;
      ctx.save();
      ctx.translate(baseX + dirX * len * 0.78, baseY + dirY * len * 0.78);
      ctx.rotate(spread + (rng() - 0.5) * 0.6);
      ctx.fillStyle = `rgb(${l},${l},${l * 0.95})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, leafW, leafLen, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${l * 0.7},${l * 0.7},${l * 0.65},0.8)`; // nervi central
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -leafLen * 0.9);
      ctx.lineTo(0, leafLen * 0.9);
      ctx.stroke();
      ctx.restore();
    }
  }
  const tex = finishTexture(new THREE.CanvasTexture(c), false);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
