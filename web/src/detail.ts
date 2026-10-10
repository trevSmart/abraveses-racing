// Textures de detall a escala del món, injectades als materials estàndard de three.js.
//
// El detall és una textura (mitjana 0,5) que multiplica el color difús ja calculat
// (ortofoto, color de vèrtex o color de la instància): `color *= mix(1, 2·d, força·fade)`.
// Gairebé sempre és grisa (només el canal R). L'asfalt porta color, normal i rugositat.
// Es mostreja a dues escales per amagar la repetició i s'esvaeix amb la distància a la càmera.

import * as THREE from "three";

type DetailMode =
  /** Projecció des de dalt (x, z del món): terra, calçades. */
  | "top"
  /** Triplanar segons la normal: parets i murs de qualsevol orientació. */
  | "triplanar"
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
  /** Escala relativa de la segona mostra (més gran) que trenca la repetició; 0 = una sola mostra. */
  secondScale?: number;
  /** Color de la junta (només triplanar): on el canal G de la textura és 1, el color del material
   * es substitueix per aquest, en lloc de multiplicar-lo. Per a juntes més clares que la peça. */
  mortar?: THREE.Color;
  /** Trenca la repetició (només triplanar): cada zona de pocs metres mostra la textura desplaçada
   * d'una altra manera. Per a textures sense estructura (arrebossat); trencaria filades i juntes. */
  antiTile?: boolean;
  /** Relleu i rugositat, només en projecció des de dalt. RGB = normal tangent (128, 128, 255 és
   * pla; el verd apunta cap a +Z del món) i A = rugositat. El color es llegeix en RGB. */
  surface?: THREE.Texture;
  /** Intensitat del relleu abans d'esvair-se amb la distància. */
  relief?: number;
};

// Tècnica de variació de textura d'I. Quilez: una versió molt ampliada i borrosa (mipmap fix) de
// la mateixa textura fa d'índex suau; cada esglaó de l'índex desplaça la textura una quantitat
// pseudoaleatòria i entre esglaons es fon amb el següent. Les derivades es passen a mà perquè el
// salt de desplaçament no faci triar un mipmap equivocat (línies a les vores de les zones).
const ANTI_TILE_FN = `
vec2 detVaried(vec2 uv, vec2 dx, vec2 dy) {
  float l = textureLod(uDetMap, uv * 0.13 + 0.37, 3.0).r * 16.0;
  float i = floor(l);
  float f = l - i;
  vec2 a = textureGrad(uDetMap, uv + sin(vec2(3.0, 7.0) * i), dx, dy).rg;
  vec2 b = textureGrad(uDetMap, uv + sin(vec2(3.0, 7.0) * (i + 1.0)), dx, dy).rg;
  return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * (a.r - b.r)));
}`;

const SAMPLE: Record<DetailMode, string> = {
  top: `
    vec2 detUv = vDetWorld.xz / uDetScale;
    float det = texture2D(uDetMap, detUv).r;
    if (uDetSecond > 0.0) det = mix(det, texture2D(uDetMap, detUv * uDetSecond + 0.37).r, 0.35);`,
  triplanar: `
    vec3 detW = pow(abs(normalize(vDetNormal)), vec3(4.0));
    detW /= (detW.x + detW.y + detW.z + 1e-4);
    vec2 detRG = texture2D(uDetMap, vDetWorld.zy / uDetScale).rg * detW.x
               + texture2D(uDetMap, vDetWorld.xz / uDetScale).rg * detW.y
               + texture2D(uDetMap, vDetWorld.xy / uDetScale).rg * detW.z;
    float det = detRG.r;
    if (uDetSecond > 0.0) {
      vec2 detRG2 = texture2D(uDetMap, vDetWorld.zy / (uDetScale * uDetSecond) + 0.37).rg * detW.x
                  + texture2D(uDetMap, vDetWorld.xz / (uDetScale * uDetSecond) + 0.37).rg * detW.y
                  + texture2D(uDetMap, vDetWorld.xy / (uDetScale * uDetSecond) + 0.37).rg * detW.z;
      det = mix(det, detRG2.r, 0.35);
      detRG.g = mix(detRG.g, detRG2.g, 0.35);
    }`,
  ridge: `
    vec2 ridgeDir = vDetRidge;
    float rl = length(ridgeDir);
    ridgeDir = rl > 1e-4 ? ridgeDir / rl : vec2(1.0, 0.0);
    vec2 downDir = vec2(-ridgeDir.y, ridgeDir.x);
    // La v és la distància sobre el vessant, no la projecció en planta: si no, les filades
    // s'estiren com més dret és el pendent (1 / cos de la inclinació).
    float alongSlope = max(abs(vDetNormal.y), 0.35);
    vec2 ridgeUv = vec2(dot(vDetWorld.xz, ridgeDir), dot(vDetWorld.xz, downDir) / alongSlope);
    float det = texture2D(uDetMap, ridgeUv / vec2(uDetScale, uDetScale * 0.875)).r;`,
};

/** Triplanar amb antirepetició. Les parets són quasi sempre d'un sol pla, així que només es
 * mostregen els plans amb pes (les derivades venen de fora de la branca, és segur). */
const TRIPLANAR_VARIED = `
    vec3 detW = pow(abs(normalize(vDetNormal)), vec3(4.0));
    detW /= (detW.x + detW.y + detW.z + 1e-4);
    vec3 detP = vDetWorld / uDetScale;
    vec3 detDx = detWorldDx / uDetScale;
    vec3 detDy = detWorldDy / uDetScale;
    vec2 detRG = vec2(0.0);
    if (detW.x > 0.01) detRG += detVaried(detP.zy, detDx.zy, detDy.zy) * detW.x;
    if (detW.y > 0.01) detRG += detVaried(detP.xz, detDx.xz, detDy.xz) * detW.y;
    if (detW.z > 0.01) detRG += detVaried(detP.xy, detDx.xy, detDy.xy) * detW.z;
    float det = detRG.r;`;

// Esquerdes i taques en coordenades del món: si anessin a la textura, es repetirien cada pocs metres.
const ASPHALT_FNS = `
float detHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
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
    });
    const mortar = opts.mortar !== undefined && opts.mode === "triplanar";
    const ridge = opts.mode === "ridge";
    const antiTile = opts.antiTile === true && opts.mode === "triplanar";
    const surface = opts.surface !== undefined && opts.mode === "top";
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vDetWorld;
varying vec3 vDetNormal;
${ridge ? "varying vec2 vDetRidge;" : ""}`,
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
}` : ""}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vDetWorld;
varying vec3 vDetNormal;
${ridge ? "varying vec2 vDetRidge;" : ""}
uniform sampler2D uDetMap;
uniform float uDetScale;
uniform float uDetStrength;
uniform vec2 uDetFade;
uniform float uDetSecond;
uniform vec3 uDetMortar;
${surface ? "uniform sampler2D uDetSurf;\nuniform float uDetRelief;" : ""}
${antiTile ? ANTI_TILE_FN : ""}
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
  float detFade = 1.0 - smoothstep(uDetFade.x, uDetFade.y, distance(vDetWorld, cameraPosition));
  ${antiTile ? "vec3 detWorldDx = dFdx(vDetWorld);\n  vec3 detWorldDy = dFdy(vDetWorld);" : ""}
  // Més enllà del fade no hi ha detall: sense mostres de textura. A la vora, el detall ja és ~0 i
  // un mipmap imprecís als quads partits no es nota.
  if (detFade > 0.0) {
    ${antiTile ? TRIPLANAR_VARIED : SAMPLE[opts.mode]}
    diffuseColor.rgb *= mix(1.0, det * 2.0, uDetStrength * detFade);
    ${mortar ? "diffuseColor.rgb = mix(diffuseColor.rgb, uDetMortar * mix(1.0, det * 2.0, 0.5), detRG.g * detFade);" : ""}
  }`,
      );
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
    `${previousKey}|detail:${opts.mode}${opts.mortar ? ":mortar" : ""}${opts.antiTile ? ":anti" : ""}${second ? `:s${second}` : ""}${surfaceKey}`;
}
