// Cel: cúpula amb gradient d'atmosfera, núvols procedurals que es desplacen, sol i lens flare.
//
// Tot el cel es calcula en espai de pantalla (sRGB, sense tone mapping), igual que la boira de
// three.js, que es barreja després del tone mapping. La boira es redirigeix (ShaderChunk) perquè
// prengui el color del cel en la direcció de cada píxel: el terreny llunyà es fon amb l'horitzó
// que té just al darrere, també a la banda del sol.

import * as THREE from "three";

/** Elevació aparent del sol (graus): prou baixa perquè surti a la part alta del pla de la càmera. */
export const SUN_VISUAL_ELEVATION_DEG = 11;

/** Direcció unitària cap al sol a partir d'un azimut (vector horitzontal x, z) i una elevació. */
export function sunDirection(azX: number, azZ: number, elevationDeg: number): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const flat = new THREE.Vector2(azX, azZ).normalize();
  return new THREE.Vector3(flat.x * Math.cos(el), Math.sin(el), flat.y * Math.cos(el));
}

const DOME_RADIUS_M = 450;
const CLOUD_SCALE = 0.55;
const CLOUD_LOW = 0.5;
const CLOUD_HIGH = 0.72;
const WIND = new THREE.Vector2(0.0022, 0.0009); // unitats de textura per segon
const NOISE_SIZE = 256;
/** Radi angular del disc del sol (una mica més gran que el real, 0,27°, perquè es vegi). */
const SUN_RADIUS_RAD = THREE.MathUtils.degToRad(0.55);

function glslColor(hex: number): string {
  // Colors en sRGB tal qual: el cel i la boira treballen en espai de pantalla.
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
}

function glslVec3(v: THREE.Vector3): string {
  return `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;
}

/** Color del cel sense núvols en una direcció: compartit pel cel i per la boira. */
function skyBaseGlsl(sunDir: THREE.Vector3): string {
  return /* glsl */ `
const vec3 SKY_HORIZON = ${glslColor(0xd6e3ea)};
const vec3 SKY_LOW = ${glslColor(0xa9c8e4)};
const vec3 SKY_ZENITH = ${glslColor(0x4f88cf)};
const vec3 SKY_SUN_GLOW = ${glslColor(0xfff0d2)};
const vec3 SKY_SUN_HAZE = ${glslColor(0xf3dcb8)};
const vec3 SKY_SUN_DIR = ${glslVec3(sunDir)};

vec3 skyBase(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 col = mix(SKY_HORIZON, SKY_LOW, smoothstep(0.0, 0.2, h));
  col = mix(col, SKY_ZENITH, smoothstep(0.08, 0.9, h));
  float mu = max(dot(d, SKY_SUN_DIR), 0.0);
  // Costat contrari al sol una mica més saturat i fosc, com el cel real.
  col *= 1.0 - 0.07 * max(-dot(d, SKY_SUN_DIR), 0.0) * smoothstep(0.0, 0.4, h);
  // Calitja càlida a l'horitzó del costat del sol i halo de dispersió al voltant del disc.
  float band = 1.0 - smoothstep(0.0, 0.3, abs(d.y));
  col = mix(col, SKY_SUN_HAZE, pow(mu, 4.0) * band * 0.45);
  col = mix(col, SKY_SUN_GLOW, clamp(pow(mu, 9.0) * 0.28 + pow(mu, 60.0) * 0.45, 0.0, 1.0));
  return col;
}
`;
}

let fogPatched = false;

/** Fa que la boira de tots els materials agafi el color del cel en la direcció de la vista. */
function patchFog(sunDir: THREE.Vector3): void {
  if (fogPatched) {
    return;
  }
  fogPatched = true;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogDir;
#endif
`;
  chunks.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // Vector de vista en coordenades del món (rotació inversa de la matriu de vista).
  vFogDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;
  chunks.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogDir;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${skyBaseGlsl(sunDir)}
#endif
`;
  chunks.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  // A menys de fogNear (la majoria de píxels) no hi ha boira: s'estalvia el color del cel.
  if ( fogFactor > 0.0 ) {
    gl_FragColor.rgb = mix( gl_FragColor.rgb, skyBase( normalize( vFogDir ) ), fogFactor );
  }
#endif
`;
}

// --- Soroll per als núvols: fBm de valor que repeteix sense costures, en una textura RGBA ---

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tileableFbm(size: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  for (const period of [4, 8, 16, 32, 64]) {
    const lattice = Float32Array.from({ length: period * period }, rand);
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * period;
      const iy = Math.floor(fy);
      const ty = fy - iy;
      const sy = ty * ty * (3 - 2 * ty);
      const y0 = iy % period;
      const y1 = (iy + 1) % period;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * period;
        const ix = Math.floor(fx);
        const tx = fx - ix;
        const sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % period;
        const x1 = (ix + 1) % period;
        const a = lattice[y0 * period + x0] + (lattice[y0 * period + x1] - lattice[y0 * period + x0]) * sx;
        const b = lattice[y1 * period + x0] + (lattice[y1 * period + x1] - lattice[y1 * period + x0]) * sx;
        out[y * size + x] += amp * (a + (b - a) * sy);
      }
    }
    amp *= 0.5;
  }
  // L'fBm s'amuntega al voltant de la mitjana: s'estira a 0–1 perquè els llindars siguin clars.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = (out[i] - lo) / (hi - lo);
  }
  return out;
}

const SKY_FRAGMENT = (sunDir: THREE.Vector3) => /* glsl */ `
uniform sampler2D uNoise;
uniform vec2 uWind;
varying vec3 vDir;

${skyBaseGlsl(sunDir)}

const vec3 CLOUD_LIT = ${glslColor(0xfdfcf8)};
const vec3 CLOUD_SHADE = ${glslColor(0xb4c0cf)};

float cloudDensity(vec2 uv) {
  float base = texture2D(uNoise, uv).r;
  float det = texture2D(uNoise, uv * 3.3 + vec2(0.37, 0.71)).g;
  return base * 0.72 + det * 0.28;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);
  float mu = dot(d, SKY_SUN_DIR);
  float cover = 0.0;
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.12) * ${CLOUD_SCALE.toFixed(3)} + uWind;
    float n = cloudDensity(uv);
    cover = smoothstep(${CLOUD_LOW.toFixed(3)}, ${CLOUD_HIGH.toFixed(3)}, n) * smoothstep(0.015, 0.16, d.y);
    if (cover > 0.002) {
      // Il·luminació: si el núvol és més dens cap al sol, aquest punt queda a l'ombra.
      float toward = cloudDensity(uv + normalize(SKY_SUN_DIR.xz) * 0.025);
      float lit = clamp(0.62 + (n - toward) * 7.0, 0.0, 1.0);
      vec3 cloud = mix(CLOUD_SHADE, CLOUD_LIT, lit);
      cloud *= 1.0 - 0.08 * smoothstep(0.7, 1.0, cover);
      // Vores fines translúcides a contrallum (silver lining).
      float fwd = pow(max(mu, 0.0), 12.0);
      cloud = mix(cloud, SKY_SUN_GLOW * 1.08, fwd * (1.0 - cover) * 0.85);
      // Perspectiva aèria: els núvols baixos es fonen amb la calitja de l'horitzó.
      cloud = mix(col, cloud, 0.35 + 0.65 * smoothstep(0.02, 0.35, d.y));
      col = mix(col, cloud, cover);
    }
  }
  float disk = smoothstep(${Math.cos(SUN_RADIUS_RAD * 1.25).toFixed(7)}, ${Math.cos(SUN_RADIUS_RAD * 0.8).toFixed(7)}, mu);
  float clear = 1.0 - cover * 0.85;
  col = mix(col, vec3(1.0, 0.995, 0.97), disk * clear);
  col += SKY_SUN_GLOW * pow(max(mu, 0.0), 1400.0) * 0.6 * clear;
  // Tramat d'un bit per evitar bandes al gradient.
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Just davant del pla llunyà: amb el test de profunditat, només es pinten els píxels on es veu
  // el cel. El que hi ha més enllà (> 599 m) ja és del tot dins la boira, que té el mateix color.
  gl_Position.z = gl_Position.w * (1.0 - 1e-6);
}
`;

// --- Textures del lens flare (dibuixades en un canvas) ---

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function radial(ctx: CanvasRenderingContext2D, s: number, stops: [number, number][]): void {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [at, a] of stops) {
    g.addColorStop(at, `rgba(255,255,255,${a})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}

const glowTexture = () =>
  canvasTexture(256, (ctx, s) =>
    radial(ctx, s, [
      [0, 1],
      [0.06, 0.85],
      [0.18, 0.32],
      [0.45, 0.08],
      [1, 0],
    ]),
  );

const starTexture = () =>
  canvasTexture(512, (ctx, s) => {
    ctx.globalCompositeOperation = "lighter";
    const rays = 8;
    for (let i = 0; i < rays; i++) {
      ctx.save();
      ctx.translate(s / 2, s / 2);
      ctx.rotate((i / rays) * Math.PI + (i % 2) * 0.09);
      ctx.scale(1, i % 2 ? 0.012 : 0.02);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
      const a = i % 2 ? 0.45 : 0.8;
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.25, `rgba(255,255,255,${a * 0.35})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });

const hexTexture = () =>
  canvasTexture(128, (ctx, s) => {
    ctx.filter = "blur(2px)";
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const r = s * 0.44;
      ctx.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.44);
    g.addColorStop(0, "rgba(255,255,255,0.35)");
    g.addColorStop(0.8, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0.9)");
    ctx.fillStyle = g;
    ctx.fill();
  });

const ringTexture = () =>
  canvasTexture(256, (ctx, s) =>
    radial(ctx, s, [
      [0, 0],
      [0.62, 0],
      [0.8, 0.5],
      [0.88, 0.22],
      [1, 0],
    ]),
  );

type FlareElement = { mesh: THREE.Mesh; t: number; size: number; opacity: number; spin?: number };

export type SunOcclusion = (origin: THREE.Vector3, dir: THREE.Vector3) => boolean;

export class Sky {
  readonly dome: THREE.Mesh;
  /** Fracció del sol tapada pels núvols (0–1), suavitzada: serveix per atenuar la llum directa. */
  cloudOverSun = 0;

  private readonly sunDir: THREE.Vector3;
  private readonly uniforms: { uNoise: { value: THREE.DataTexture }; uWind: { value: THREE.Vector2 } };
  private readonly noise: Uint8Array<ArrayBuffer>;
  private readonly flareScene = new THREE.Scene();
  private readonly flareCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private readonly flares: FlareElement[] = [];
  private readonly size = new THREE.Vector2();
  private readonly sunNdc = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly probeDirs: THREE.Vector3[];
  private readonly probe = new THREE.Vector3();
  private time = 0;
  private visibility = 0;
  private probeIndex = 0;
  private readonly probeHits: boolean[];

  constructor(sunDir: THREE.Vector3, layer: number) {
    this.sunDir = sunDir.clone().normalize();
    patchFog(this.sunDir);

    const r = tileableFbm(NOISE_SIZE, 7);
    const g = tileableFbm(NOISE_SIZE, 1234);
    this.noise = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);
    for (let i = 0; i < r.length; i++) {
      this.noise[i * 4] = Math.round(r[i] * 255);
      this.noise[i * 4 + 1] = Math.round(g[i] * 255);
      this.noise[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(this.noise, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    this.uniforms = { uNoise: { value: tex }, uWind: { value: new THREE.Vector2() } };

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_RADIUS_M, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT(this.sunDir),
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    // Després de tots els opacs (abans dels transparents, com el vidre del cotxe): el shader del cel
    // és car i així no es calcula als píxels que tapen el terreny i les cases. Només per a la càmera
    // principal (ni minimapa, ni mapa gran, ni ombres).
    this.dome.renderOrder = 1000;
    this.dome.frustumCulled = false;
    this.dome.layers.set(layer);

    // Rajos de prova repartits pel disc del sol: l'oclusió parcial (vora d'una teulada) és gradual.
    const up = Math.abs(this.sunDir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(this.sunDir, up).normalize();
    const v = new THREE.Vector3().crossVectors(u, this.sunDir).normalize();
    const spread = SUN_RADIUS_RAD * 1.6;
    this.probeDirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]].map(
      ([a, b]) =>
        this.sunDir
          .clone()
          .addScaledVector(u, a * spread)
          .addScaledVector(v, b * spread)
          .normalize(),
    );
    this.probeHits = this.probeDirs.map(() => false);

    this.buildFlare();
  }

  private buildFlare(): void {
    const glow = glowTexture();
    const star = starTexture();
    const hex = hexTexture();
    const ring = ringTexture();
    const add = (map: THREE.Texture, color: number, t: number, size: number, opacity: number, spin?: number) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map,
          color,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      this.flareScene.add(mesh);
      this.flares.push({ mesh, t, size, opacity, spin });
    };
    // t = 1 és el sol, 0 el centre de la pantalla, negatiu a l'altra banda. Mida en fracció d'alçada.
    add(glow, 0xfff1d8, 1, 0.5, 0.55);
    add(glow, 0xffffff, 1, 0.1, 0.9);
    add(star, 0xfff6e6, 1, 0.42, 0.55, 0.25);
    add(ring, 0xffd9a8, 1, 0.3, 0.08);
    add(hex, 0xffb35c, 0.62, 0.045, 0.16);
    add(glow, 0xffe2a0, 0.42, 0.05, 0.22);
    add(ring, 0x9fc6ff, 0.28, 0.12, 0.1);
    add(hex, 0x7fe0c0, -0.18, 0.075, 0.1);
    add(glow, 0xb59cff, -0.42, 0.18, 0.08);
    add(hex, 0xffc070, -0.7, 0.04, 0.18);
    add(hex, 0x8fb4ff, -0.86, 0.11, 0.07);
    add(ring, 0xffa0d0, -1.12, 0.32, 0.05);
  }

  /** Mostreig a la CPU de la mateixa densitat de núvols que el shader (filtre bilineal i repetició). */
  private sampleNoise(u: number, v: number, channel: number): number {
    const x = u * NOISE_SIZE - 0.5;
    const y = v * NOISE_SIZE - 0.5;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const at = (i: number, j: number) => {
      const xi = ((i % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE;
      const yj = ((j % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE;
      return this.noise[(yj * NOISE_SIZE + xi) * 4 + channel] / 255;
    };
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
    return a + (b - a) * fy;
  }

  private cloudCoverAt(d: THREE.Vector3): number {
    if (d.y <= 0) {
      return 0;
    }
    const wind = this.uniforms.uWind.value;
    const u = (d.x / (d.y + 0.12)) * CLOUD_SCALE + wind.x;
    const v = (d.z / (d.y + 0.12)) * CLOUD_SCALE + wind.y;
    const n = this.sampleNoise(u, v, 0) * 0.72 + this.sampleNoise(u * 3.3 + 0.37, v * 3.3 + 0.71, 1) * 0.28;
    return THREE.MathUtils.smoothstep(n, CLOUD_LOW, CLOUD_HIGH) * THREE.MathUtils.smoothstep(d.y, 0.015, 0.16);
  }

  /** Cada fotograma: la cúpula segueix la càmera, el vent mou els núvols i es recalcula el flare. */
  update(dt: number, camera: THREE.PerspectiveCamera, occluded: SunOcclusion): void {
    this.time += dt;
    this.uniforms.uWind.value.copy(WIND).multiplyScalar(this.time);
    this.dome.position.copy(camera.position);

    const cloud = this.cloudCoverAt(this.sunDir);
    this.cloudOverSun += (cloud - this.cloudOverSun) * (1 - Math.exp(-6 * dt));

    // Posició del sol a la pantalla; fora del pla (amb marge) el flare s'esvaeix.
    camera.getWorldDirection(this.camDir);
    let onScreen = 0;
    if (this.camDir.dot(this.sunDir) > 0.05) {
      this.sunNdc.copy(camera.position).addScaledVector(this.sunDir, DOME_RADIUS_M).project(camera);
      const edge = Math.max(Math.abs(this.sunNdc.x), Math.abs(this.sunNdc.y));
      onScreen = 1 - THREE.MathUtils.smoothstep(edge, 0.95, 1.25);
    }
    // Oclusió per edificis i turons: uns quants rajos per fotograma, en roda.
    if (onScreen > 0) {
      for (let k = 0; k < 3; k++) {
        const i = this.probeIndex;
        this.probeIndex = (this.probeIndex + 1) % this.probeDirs.length;
        this.probeHits[i] = occluded(this.probe.copy(camera.position), this.probeDirs[i]);
      }
    }
    const open = this.probeHits.reduce((a, hit) => a + (hit ? 0 : 1), 0) / this.probeHits.length;
    const target = onScreen * open * (1 - 0.92 * this.cloudOverSun);
    this.visibility += (target - this.visibility) * (1 - Math.exp(-14 * dt));
  }

  /** Dibuixa el lens flare a sobre de l'escena ja renderitzada. */
  renderFlare(renderer: THREE.WebGLRenderer): void {
    if (this.visibility < 0.004) {
      return;
    }
    renderer.getSize(this.size);
    const w = this.size.x;
    const h = this.size.y;
    if (this.flareCam.right !== w / 2 || this.flareCam.top !== h / 2) {
      this.flareCam.left = -w / 2;
      this.flareCam.right = w / 2;
      this.flareCam.top = h / 2;
      this.flareCam.bottom = -h / 2;
      this.flareCam.updateProjectionMatrix();
    }
    const sx = (this.sunNdc.x * w) / 2;
    const sy = (this.sunNdc.y * h) / 2;
    // Com més centrat el sol, més intensos els reflexos interns de les lents.
    const centered = 1 - Math.min(1, Math.hypot(this.sunNdc.x, this.sunNdc.y) / 1.4);
    for (const f of this.flares) {
      const mat = f.mesh.material as THREE.MeshBasicMaterial;
      const ghost = f.t === 1 ? 1 : 0.55 + 0.75 * centered;
      mat.opacity = f.opacity * this.visibility * ghost;
      f.mesh.position.set(sx * f.t, sy * f.t, 0);
      f.mesh.scale.setScalar(f.size * h);
      if (f.spin !== undefined) {
        f.mesh.rotation.z = Math.atan2(sy, sx) * f.spin;
      }
    }
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.flareScene, this.flareCam);
    renderer.autoClear = autoClear;
  }
}
