// Textures de detall a escala del món, injectades als materials estàndard de three.js.
//
// El detall és una textura (mitjana 0,5) que multiplica el color difús ja calculat
// (ortofoto, color de vèrtex o color de la instància): `color *= mix(1, 2·d, força·fade)`.
// Gairebé sempre és grisa (només el canal R). L'asfalt porta color, normal i rugositat.
// Es mostreja a dues escales per amagar la repetició i s'esvaeix amb la distància a la càmera.
//
// Parets i teulades porten, a més, una capa d'envelliment (`weather`) calculada en coordenades del
// món, perquè no es repeteixi amb la rajola: taques, regalims, brutícia i humitat a tocar de terra,
// esquerdes, arrebossat caigut, liquen i to propi per a cada totxo o teula. La quantitat depèn del
// desgast de cada casa, que surt de l'any i l'estat del Cadastre (`setHouseWear`).

import * as THREE from "three";

type DetailMode =
  /** Projecció des de dalt (x, z del món): terra, calçades. */
  | "top"
  /** Alineada amb cada paret: u al llarg del mur (des de la normal), v alçada. Les cares planes
   * (capçals de mur) es projecten des de dalt. Vol normals planes: vegeu `tintWorld` a main.ts. */
  | "wall"
  /** Teulades: fileres paral·leles al carener (direcció des de la normal), v pendent avall. */
  | "ridge";

export type DetailOptions = {
  map: THREE.Texture;
  mode: DetailMode;
  /** Metres que ocupa una repetició de la textura. */
  scaleM: number;
  /** 0 = sense detall, 1 = contrast complet de la textura. */
  strength: number;
  /** Distància (m) on el detall comença i acaba d'esvair-se. */
  fade?: [number, number];
  /** Només des de dalt: escala relativa de la segona mostra (més gran) que trenca la repetició. */
  secondScale?: number;
  /** Color de la junta (només paret): on el canal G de la textura és 1, el color del material
   * es substitueix per aquest, en lloc de multiplicar-lo. Per a juntes més clares que la peça. */
  mortar?: THREE.Color;
  /** Trenca la repetició (només paret): cada zona de pocs metres mostra la textura desplaçada
   * d'una altra manera. Per a textures sense estructura (arrebossat); trencaria filades i juntes. */
  antiTile?: boolean;
  /** Relleu i rugositat, només en projecció des de dalt. RGB = normal tangent (128, 128, 255 és
   * pla; el verd apunta cap a +Z del món) i A = rugositat. El color es llegeix en RGB. */
  surface?: THREE.Texture;
  /** Intensitat del relleu abans d'esvair-se amb la distància. */
  relief?: number;
  /** Envelliment segons el material. Vol `installHouseHide`, que declara l'atribut `houseId`. */
  weather?: WeatherKind;
  /** Peces per repetició de la textura: cada peça pren al shader un to que no es repeteix. */
  grid?: { cols: number; rows: number; jitter: number };
  /** Metres de relleu que representa el canal B de la textura (només paret), a prop de la càmera. */
  bump?: number;
};

export type WeatherKind = "plaster" | "brick" | "stone" | "roof";

const WEAR_TEXELS = 2048;
/** Desgast dels murs sense casa (houseId 0): tàpies i tancaments. */
const WEAR_DEFAULT = 0.55;

function wearTexture(): THREE.DataTexture {
  const data = new Uint8Array(WEAR_TEXELS).fill(Math.round(WEAR_DEFAULT * 255));
  const tex = new THREE.DataTexture(data, WEAR_TEXELS, 1, THREE.RedFormat, THREE.UnsignedByteType);
  tex.needsUpdate = true;
  return tex;
}

function flatGroundTexture(): THREE.DataTexture {
  // Sense terreny carregat: tot queda molt per sobre de terra, sense brutícia.
  const data = new Uint16Array([THREE.DataUtils.toHalfFloat(-1000)]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RedFormat, THREE.HalfFloatType);
  tex.needsUpdate = true;
  return tex;
}

/** Uniforms compartits per tots els materials amb `weather`: es poden omplir després de compilar. */
export const weatherUniforms = {
  uWeatherMap: { value: null as THREE.Texture | null },
  uDetGround: { value: flatGroundTexture() as THREE.Texture },
  /** x → u: (x·escala + desplaçament), z → v: el mateix amb els dos últims. */
  uDetGroundXf: { value: new THREE.Vector4(0, 0.5, 0, 0.5) },
  uDetWearMap: { value: wearTexture() as THREE.Texture },
};

/** Alçada del terreny, per saber a quants metres de terra és cada punt de la paret.
 * `heights` és una graella n × n que cobreix de −halfM a +halfM, amb v creixent amb la z del món. */
export function setGroundHeights(heights: Float32Array, n: number, halfM: number): void {
  const data = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    data[i] = THREE.DataUtils.toHalfFloat(heights[i]);
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  weatherUniforms.uDetGround.value = tex;
  // El primer i l'últim vèrtex de la graella cauen al centre dels texels de les vores.
  const scale = ((n - 1) / n) / (2 * halfM);
  const offset = halfM * scale + 0.5 / n;
  weatherUniforms.uDetGroundXf.value.set(scale, offset, scale, offset);
}

/** Desgast de 0 (acabada de fer) a 1 (molt castigada) a partir de les dades del Cadastre. Hi ha una
 * mica d'atzar per casa: dues cases del mateix any no s'han conservat igual. */
export function houseWear(id: number, year: number | undefined, condition: string | undefined): number {
  const jitter = ((id * 0.61803399) % 1) * 0.2 - 0.1;
  let wear = WEAR_DEFAULT;
  if (year) {
    // El Cadastre data moltes cases antigues al 1900: és el sostre, no una edat real.
    wear = Math.min(0.8, Math.max(0.08, (2015 - year) / 100));
  }
  if (condition === "Declinada" || condition === "Ruïna") {
    wear += 0.25;
  }
  return Math.min(1, Math.max(0, wear + jitter));
}

/** Omple el desgast de cada casa (índex: houseId). */
export function setHouseWear(wearById: Map<number, number>): void {
  const tex = weatherUniforms.uDetWearMap.value as THREE.DataTexture;
  const data = tex.image.data as Uint8Array;
  for (const [id, wear] of wearById) {
    if (id > 0 && id < WEAR_TEXELS) {
      data[id] = Math.round(wear * 255);
    }
  }
  tex.needsUpdate = true;
}

// Tècnica de variació de textura d'I. Quilez: una versió molt ampliada i borrosa (mipmap fix) de
// la mateixa textura fa d'índex suau; cada esglaó de l'índex desplaça la textura una quantitat
// pseudoaleatòria i entre esglaons es fon amb el següent. Les derivades es passen a mà perquè el
// salt de desplaçament no faci triar un mipmap equivocat (línies a les vores de les zones).
const ANTI_TILE_FN = `
vec3 detVaried(vec2 uv, vec2 dx, vec2 dy) {
  float l = textureLod(uDetMap, uv * 0.13 + 0.37, 3.0).r * 16.0;
  float i = floor(l);
  float f = l - i;
  vec3 a = textureGrad(uDetMap, uv + sin(vec2(3.0, 7.0) * i), dx, dy).rgb;
  vec3 b = textureGrad(uDetMap, uv + sin(vec2(3.0, 7.0) * (i + 1.0)), dx, dy).rgb;
  return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * (a.r - b.r)));
}`;

const SAMPLE: Record<DetailMode, string> = {
  top: `
    vec2 detUv = vDetWorld.xz / uDetScale;
    float det = texture2D(uDetMap, detUv).r;
    if (uDetSecond > 0.0) det = mix(det, texture2D(uDetMap, detUv * uDetSecond + 0.37).r, 0.35);`,
  wall: `
    vec3 detS = texture2D(uDetMap, detUv).rgb;
    float det = detS.r;
    float detMortar = detS.g;
    gDetH = detS.b;`,
  ridge: `
    vec2 ridgeDir = vDetRidge;
    float rl = length(ridgeDir);
    ridgeDir = rl > 1e-4 ? ridgeDir / rl : vec2(1.0, 0.0);
    vec2 downDir = vec2(-ridgeDir.y, ridgeDir.x);
    // La v és la distància sobre el vessant, no la projecció en planta: si no, les filades
    // s'estiren com més dret és el pendent (1 / cos de la inclinació).
    float alongSlope = max(abs(vDetNormal.y), 0.35);
    vec2 ridgeUv = vec2(dot(vDetWorld.xz, ridgeDir), dot(vDetWorld.xz, downDir) / alongSlope);
    vec2 detUv = ridgeUv / vec2(uDetScale, uDetScale * 0.875);
    float det = texture2D(uDetMap, detUv).r;`,
};

/** Paret amb antirepetició. Les derivades venen de fora de la branca, és segur. */
const WALL_VARIED = `
    vec3 detS = detVaried(detUv, detDx, detDy);
    float det = detS.r;
    float detMortar = detS.g;
    gDetH = detS.b;`;

const DET_HASH = `
float detHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

/** Quina peça (totxo, teula) cau a cada punt, sense tornar a la rajola: així dues parets no tenen
 * els mateixos totxos foscos. El desplaçament de la filada ha de ser el de `brickDetail`. */
function pieceFn(grid: NonNullable<DetailOptions["grid"]>): string {
  const f = (x: number) => x.toFixed(4);
  return `
vec2 detPiece(vec2 uv) {
  float row = floor(uv.y * ${f(grid.rows)});
  float shift = mod(row, 2.0) * 0.5 + (fract(mod(row, ${f(grid.rows)}) * 0.618034) - 0.5) * ${f(grid.jitter)};
  return vec2(floor(uv.x * ${f(grid.cols)} + shift), row);
}`;
}

/** To de cada peça, aplicat a `det`. Es deixa de fer quan les peces ja no es distingeixen (si no,
 * el soroll d'un píxel a l'altre es veu com a formigueig). */
const PIECE_TONE: Record<"brick" | "roof", string> = {
  // Pocs totxos es distingeixen de veritat: uns de més cuits i uns de més pàl·lids.
  brick: `
    vec2 detP = detPiece(detUv);
    float detPa = detHash(detP);
    float detPb = detHash(detP + 41.7);
    float detPiecesOn = 1.0 - smoothstep(0.3, 0.85, fwidth(detUv.y) * uDetRows);
    float detTone = 1.0 + (detPa - 0.5) * 0.2;
    detTone *= detPb < 0.07 ? 0.78 + detPa * 0.08 : detPb > 0.94 ? 1.14 : 1.0;
    det *= mix(1.0, detTone, detPiecesOn);
    detBrickTint = (detHash(detP + 7.3) - 0.5) * detPiecesOn;`,
  // Teules velles barrejades amb d'altres de recanvi, més clares o més fosques.
  roof: `
    vec2 detP = detPiece(detUv);
    float detPa = detHash(detP);
    float detPb = detHash(detP + 41.7);
    float detPiecesOn = 1.0 - smoothstep(0.3, 0.85, fwidth(detUv.y) * uDetRows);
    float detTone = 1.0 + (detPa - 0.5) * 0.24;
    detTone *= detPb < 0.05 ? 0.72 : detPb > 0.96 ? 1.2 : 1.0;
    det *= mix(1.0, detTone, detPiecesOn);
    // Regalims que baixen pel vessant.
    float detRun = smoothstep(0.55, 0.8, texture2D(uWeatherMap, ridgeUv / 6.7).b);
    det *= 1.0 - detRun * 0.16;`,
};

/** Com s'envelleix cada material. Entra `wc` (color), surt modificat. `wBig` i `wFine` són el mapa
 * d'envelliment a 31 i 6,7 m per repetició; `wear` és el desgast del punt. */
const WEATHER_WALL = `
    // Taques grans de brutícia i parts més rentades per la pluja.
    wc *= mix(1.0 - 0.14 * (0.35 + wear), 1.04, smoothstep(0.22, 0.78, wBig.r));
    wc = mix(wc, wc * vec3(1.03, 0.97, 0.88), wBig.g * 0.45 * wear);
    // Regalims de pluja, a tongades.
    float wStreak = smoothstep(0.5, 0.76, wFine.b) * smoothstep(0.32, 0.62, wBig.a);
    wc *= 1.0 - wStreak * (0.03 + 0.11 * wear);
    // Esquitxos i terra a tocar de terra, i la humitat que puja més amunt.
    float wH = vDetGroundH;
    float wGrime = 1.0 - smoothstep(0.02, 0.35 + 0.65 * wFine.r, wH);
    wc *= mix(vec3(1.0), vec3(0.6, 0.55, 0.49), wGrime * (0.3 + 0.55 * wear));
    float wDamp = (1.0 - smoothstep(0.25, 0.7 + 1.5 * wBig.g, wH)) * smoothstep(0.4, 0.62, wBig.r);
    wc *= 1.0 - wDamp * 0.2 * wear;
    // Verdet a les cares que no veuen el sol (el nord és −z).
    float wNorth = smoothstep(0.25, 0.9, -normalize(vDetNormal).z);
    wc = mix(wc, wc * vec3(0.6, 0.72, 0.46), wNorth * (wGrime + wDamp * 0.5) * smoothstep(0.45, 0.65, wFine.g) * (0.25 + 0.5 * wear));`;

const WEATHER: Record<WeatherKind, string> = {
  plaster: `${WEATHER_WALL}
    // Esquerdes fines: l'isolínia del soroll, amb la vora trencada pel clapat fi. Una isolínia
    // sencera tanca anells d'un metre; tallada per dues màscares, només en queden trams.
    float wCrackV = wFine.a + (wFine.g - 0.5) * 0.14;
    float wCrackW = max(0.005, fwidth(wCrackV) * 0.7);
    float wCrack = 1.0 - smoothstep(0.0, wCrackW, abs(wCrackV - 0.5));
    wCrack *= smoothstep(0.58, 0.66, wBig.a) * smoothstep(0.52, 0.6, wBig.g);
    wCrack *= smoothstep(0.35, 0.6, wear) * (1.0 - smoothstep(6.0, 28.0, detDist));
    wc *= 1.0 - wCrack * 0.38;
    // Arrebossat caigut, sobretot a baix i a les cases velles: es veu el mur de sota.
    float wSpallN = wFine.r * 0.62 + wBig.g * 0.38;
    float wSpallT = mix(0.85, 0.71, smoothstep(0.3, 0.95, wear)) + smoothstep(0.3, 3.5, wH) * 0.055;
    float wSpall = smoothstep(wSpallT, wSpallT + 0.012, wSpallN) * smoothstep(0.32, 0.5, wear);
    wc *= 1.0 - 0.14 * smoothstep(wSpallT - 0.035, wSpallT, wSpallN) * smoothstep(0.32, 0.5, wear);
    wc = mix(wc, vec3(0.3, 0.25, 0.2) * (0.72 + wFine.g * 0.6), wSpall);
    gDetCut = wSpall * 0.012;`,
  brick: `${WEATHER_WALL}
    // Cada totxo tira una mica més cap al taronja o cap al morat.
    wc *= mix(vec3(1.0), vec3(1.0 + detBrickTint * 0.14, 1.0, 1.0 - detBrickTint * 0.2), 1.0 - gDetMortar);
    // Junta bruta i desigual, i salnitre blanc que surt del mur a la part de baix.
    wc *= mix(1.0, mix(0.66, 1.04, wFine.g), gDetMortar);
    float wSalt = smoothstep(0.58, 0.78, wBig.a) * (1.0 - smoothstep(0.2, 2.4, wH)) * smoothstep(0.42, 0.62, wFine.r);
    wc = mix(wc, vec3(0.72, 0.69, 0.63), wSalt * 0.34 * wear);`,
  stone: `${WEATHER_WALL}
    // Liquen clar i groguenc a les pedres, a clapes.
    float wLichen = smoothstep(0.66, 0.72, wFine.r * 0.55 + wFine.g * 0.45) * smoothstep(0.4, 0.6, wBig.g);
    wc = mix(wc, vec3(0.56, 0.53, 0.33), wLichen * (0.2 + 0.35 * wear));`,
  roof: `
    wc *= mix(1.0 - 0.15 * (0.35 + wear), 1.06, smoothstep(0.22, 0.78, wBig.r));
    // Liquen ataronjat i molsa fosca, típics de la teula vella.
    float wLichen = smoothstep(0.6, 0.67, wFine.r * 0.6 + wBig.g * 0.4) * smoothstep(0.3, 0.7, wear);
    wc = mix(wc, wc * vec3(1.12, 0.98, 0.56) + vec3(0.03, 0.02, 0.0), wLichen * 0.38);
    float wSoot = smoothstep(0.64, 0.72, wFine.g * 0.5 + wBig.a * 0.5);
    wc *= 1.0 - wSoot * 0.14 * wear;`,
};
// Esquerdes i taques en coordenades del món: si anessin a la textura, es repetirien cada pocs metres.
const ASPHALT_FNS = `
float detVnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(detHash(i), detHash(i + vec2(1.0, 0.0)), u.x),
             mix(detHash(i + vec2(0.0, 1.0)), detHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 gDetCol;
vec4 gDetSurf;
float gDetFade;
float gDetReady;
void detAsphalt() {
  gDetFade = 1.0 - smoothstep(uDetFade.x, uDetFade.y, distance(vDetWorld, cameraPosition));
  if (gDetFade <= 0.0) return;
  vec2 detUv = vDetWorld.xz / uDetScale;
  gDetCol = texture2D(uDetMap, detUv).rgb;
  gDetSurf = texture2D(uDetSurf, detUv);
  vec2 w = vDetWorld.xz;
  float wear = detVnoise(w * 0.075);
  // Esquerdes amples i poc contrastades: una línia fina i negra es llegeix com un tall.
  float crack = 1.0 - smoothstep(0.0, 0.055, abs(detVnoise(w * 0.42) - 0.5));
  crack *= smoothstep(0.62, 0.82, detVnoise(w * 0.038 + 2.0));
  float crack2 = 1.0 - smoothstep(0.0, 0.045, abs(detVnoise(w * 0.23 + 6.0) - 0.36));
  crack2 *= smoothstep(0.74, 0.9, detVnoise(w * 0.026 + 11.0));
  float cracks = clamp(crack + crack2, 0.0, 1.0);
  float tar = smoothstep(0.76, 0.9, detVnoise(w * 0.11 + 17.0));
  gDetCol *= mix(vec3(0.93), vec3(1.07), wear);
  gDetCol *= mix(vec3(1.0), vec3(1.06, 1.05, 1.03), smoothstep(0.64, 0.82, wear));
  gDetCol *= mix(vec3(1.0), vec3(0.86, 0.85, 0.84), cracks);
  gDetCol *= mix(vec3(1.0), vec3(0.82), tar);
  gDetSurf.a = mix(gDetSurf.a, 0.9, cracks * 0.45);
  gDetSurf.a = mix(gDetSurf.a, 0.4, tar);
  gDetReady = 1.0;
}`;

/** Afegeix el detall al material, encadenant qualsevol `onBeforeCompile` que ja tingués. */
export function addWorldDetail(material: THREE.Material, opts: DetailOptions): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  const fade = opts.fade ?? [40, 140];
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      uDetMap: { value: opts.map },
      uDetScale: { value: opts.scaleM },
      uDetStrength: { value: opts.strength },
      uDetFade: { value: new THREE.Vector2(fade[0], fade[1]) },
      uDetSecond: { value: opts.secondScale ?? 0 },
      uDetMortar: { value: opts.mortar ?? new THREE.Color() },
      uDetSurf: { value: opts.surface ?? opts.map },
      uDetRelief: { value: opts.relief ?? 1 },
      uDetBump: { value: opts.bump ?? 0 },
      uDetRows: { value: opts.grid?.rows ?? 1 },
    });
    if (opts.weather) {
      Object.assign(shader.uniforms, weatherUniforms);
    }
    const wall = opts.mode === "wall";
    const mortar = opts.mortar !== undefined && wall;
    const ridge = opts.mode === "ridge";
    const antiTile = opts.antiTile === true && wall;
    const surface = opts.surface !== undefined && opts.mode === "top";
    const weather = opts.weather;
    const bump = wall && (opts.bump ?? 0) > 0;
    // El to de cada peça: la teula el porta sempre; el totxo, on hi ha junta.
    const pieceTone = opts.grid && (weather === "brick" || weather === "roof") ? PIECE_TONE[weather] : "";
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vDetWorld;
varying vec3 vDetNormal;
${ridge ? "varying vec2 vDetRidge;" : ""}
${wall ? "varying vec2 vDetWall;" : ""}
${weather ? `uniform sampler2D uDetGround;
uniform vec4 uDetGroundXf;
uniform sampler2D uDetWearMap;
varying float vDetGroundH;
varying float vDetWear;` : ""}`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vDetWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vDetNormal = mat3(modelMatrix) * objectNormal;
${ridge ? `{
  vec2 slope = vec2(vDetNormal.x, vDetNormal.z);
  float sl = length(slope);
  vDetRidge = sl > 1e-4 ? vec2(-slope.y, slope.x) / sl : vec2(1.0, 0.0);
}` : ""}
${wall ? `{
  vec3 detN = normalize(vDetNormal);
  float detHl = length(detN.xz);
  vDetWall = (abs(detN.y) > 0.7 || detHl < 1e-3)
    ? vDetWorld.xz
    : vec2(dot(vDetWorld.xz, vec2(-detN.z, detN.x) / detHl), vDetWorld.y);
}` : ""}
${weather ? `vDetGroundH = vDetWorld.y - textureLod(uDetGround, vec2(
  vDetWorld.x * uDetGroundXf.x + uDetGroundXf.y,
  vDetWorld.z * uDetGroundXf.z + uDetGroundXf.w), 0.0).r;
vDetWear = textureLod(uDetWearMap, vec2((floor(houseId + 0.5) + 0.5) / ${WEAR_TEXELS}.0, 0.5), 0.0).r;` : ""}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vDetWorld;
varying vec3 vDetNormal;
${ridge ? "varying vec2 vDetRidge;" : ""}
${wall ? "varying vec2 vDetWall;\nfloat gDetH = 0.5;\nfloat gDetCut = 0.0;\nfloat gDetMortar = 0.0;" : ""}
${weather === "brick" ? "float detBrickTint = 0.0;" : ""}
${weather ? "uniform sampler2D uWeatherMap;\nvarying float vDetGroundH;\nvarying float vDetWear;" : ""}
${bump ? "uniform float uDetBump;" : ""}
${opts.grid ? `uniform float uDetRows;${pieceFn(opts.grid)}` : ""}
uniform sampler2D uDetMap;
uniform float uDetScale;
uniform float uDetStrength;
uniform vec2 uDetFade;
uniform float uDetSecond;
uniform vec3 uDetMortar;
${surface ? "uniform sampler2D uDetSurf;\nuniform float uDetRelief;" : ""}
${antiTile ? ANTI_TILE_FN : ""}
${surface || opts.grid ? DET_HASH : ""}
${surface ? ASPHALT_FNS : ""}`,
      )
      .replace(
        "#include <color_fragment>",
        surface
          ? `#include <color_fragment>
  detAsphalt();
  if (gDetReady > 0.5) {
    diffuseColor.rgb *= mix(vec3(1.0), gDetCol * 2.0, uDetStrength * gDetFade);
  }`
          : `#include <color_fragment>
  float detDist = distance(vDetWorld, cameraPosition);
  float detFade = 1.0 - smoothstep(uDetFade.x, uDetFade.y, detDist);
  ${wall ? "vec2 detUv = vDetWall / uDetScale;" : ""}
  ${antiTile ? "vec2 detDx = dFdx(detUv);\n  vec2 detDy = dFdy(detUv);" : ""}
  // Més enllà del fade no hi ha detall: sense mostres de textura. A la vora, el detall ja és ~0 i
  // un mipmap imprecís als quads partits no es nota.
  if (detFade > 0.0) {
    ${antiTile ? WALL_VARIED : SAMPLE[opts.mode]}
    ${pieceTone}
    diffuseColor.rgb *= mix(1.0, det * 2.0, uDetStrength * detFade);
    ${mortar ? `diffuseColor.rgb = mix(diffuseColor.rgb, uDetMortar * mix(1.0, det * 2.0, 0.5), detMortar * detFade);
    gDetMortar = detMortar * detFade;` : ""}
  }
  ${weather ? `// L'envelliment arriba més lluny que el detall: les taques grans es veuen des de l'altra punta.
  float wFade = 1.0 - smoothstep(170.0, 520.0, detDist);
  if (wFade > 0.0) {
    vec2 wUv = ${wall ? "vDetWall" : "vDetWorld.xz"};
    vec4 wBig = texture2D(uWeatherMap, wUv / 31.0);
    vec4 wFine = texture2D(uWeatherMap, wUv / 6.7 + 0.37);
    float wear = clamp(vDetWear + (wBig.g - 0.5) * 0.3, 0.0, 1.0);
    vec3 wc = diffuseColor.rgb;
    ${WEATHER[weather]}
    diffuseColor.rgb = mix(diffuseColor.rgb, wc, wFade);
  }` : ""}`,
      );
    if (bump) {
      // Relleu per derivades de pantalla: la junta i els cops agafen llum i ombra quan el sol ve
      // de biaix. Només de prop: més lluny, el píxel ja és més gros que la junta.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
  float detBumpFade = 1.0 - smoothstep(9.0, 42.0, detDist);
  if (detBumpFade > 0.0) {
    float detBumpH = (gDetH * uDetBump - gDetCut) * detBumpFade;
    vec3 detSx = dFdx(-vViewPosition);
    vec3 detSy = dFdy(-vViewPosition);
    vec3 detR1 = cross(detSy, normal);
    vec3 detR2 = cross(normal, detSx);
    float detD = dot(detSx, detR1) * faceDirection;
    if (abs(detD) > 1e-10) {
      vec3 detGrad = sign(detD) * (dFdx(detBumpH) * detR1 + dFdy(detBumpH) * detR2);
      normal = normalize(abs(detD) * normal - detGrad);
    }
  }`,
      );
    }
    if (surface) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>
  if (gDetReady > 0.5) roughnessFactor = mix(roughnessFactor, gDetSurf.a, gDetFade);`,
        )
        .replace(
          "#include <normal_fragment_begin>",
          `#include <normal_fragment_begin>
  if (gDetReady > 0.5) {
    vec3 geomN = inverseTransformDirection(normal, viewMatrix);
    vec3 T = vec3(1.0, 0.0, 0.0);
    T -= geomN * dot(geomN, T);
    if (dot(T, T) < 1e-4) {
      T = vec3(0.0, 0.0, 1.0);
      T -= geomN * dot(geomN, T);
    }
    T = normalize(T);
    vec3 B = cross(T, geomN);
    vec3 mapN = gDetSurf.rgb * 2.0 - 1.0;
    mapN.xy *= uDetRelief * gDetFade;
    mapN = normalize(vec3(mapN.xy, max(mapN.z, 0.05)));
    normal = transformDirection(T * mapN.x + B * mapN.y + geomN * mapN.z, viewMatrix);
  }`,
        );
    }
  };
  // Cada combinació de codi ha de tenir el seu programa; els valors van per uniforms. La clau
  // anterior es calcula ara, abans de substituir onBeforeCompile (la clau per defecte n'és el codi).
  const second = opts.secondScale ?? 0;
  const surfaceKey = opts.surface !== undefined && opts.mode === "top" ? ":surf" : "";
  material.customProgramCacheKey = () =>
    `${previousKey}|detail:${opts.mode}${opts.mortar ? ":mortar" : ""}${opts.antiTile ? ":anti" : ""}${second ? `:s${second}` : ""}${surfaceKey}${opts.weather ? `:w-${opts.weather}` : ""}${opts.grid ? `:g${opts.grid.cols}x${opts.grid.rows}x${opts.grid.jitter}` : ""}${opts.bump ? ":bump" : ""}`;
}
