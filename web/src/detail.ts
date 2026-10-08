// Textures de detall a escala del món, injectades als materials estàndard de three.js.
//
// El detall és una textura grisa (mitjana 0,5) que multiplica el color difús ja calculat
// (ortofoto, color de vèrtex o color de la instància): `color *= mix(1, 2·d, força·fade)`.
// Es mostreja a dues escales per amagar la repetició i s'esvaeix amb la distància a la càmera.

import * as THREE from "three";

export type DetailMode =
  /** Projecció des de dalt (x, z del món): terra, calçades. */
  | "top"
  /** Triplanar segons la normal: parets i murs de qualsevol orientació. */
  | "triplanar"
  /** Teulades: u al llarg del carener (direcció codificada al color de vèrtex), v pendent avall. */
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
};

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
    float det = detRG.r;`,
  ridge: `
    vec2 ridgeDir = normalize(vDetRidge * 2.0 - 1.0 + 1e-4);
    vec2 ridgeUv = vec2(dot(vDetWorld.xz, ridgeDir), dot(vDetWorld.xz, vec2(-ridgeDir.y, ridgeDir.x)));
    float det = texture2D(uDetMap, ridgeUv / vec2(uDetScale, uDetScale * 0.875)).r;`,
};

/** Afegeix el detall al material, encadenant qualsevol `onBeforeCompile` que ja tingués. */
export function addWorldDetail(material: THREE.Material, opts: DetailOptions): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  const fade = opts.fade ?? [40, 140];
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      uDetMap: { value: opts.map },
      uDetScale: { value: opts.scaleM },
      uDetStrength: { value: opts.strength },
      uDetFade: { value: new THREE.Vector2(fade[0], fade[1]) },
      uDetSecond: { value: opts.secondScale ?? 0 },
      uDetMortar: { value: opts.mortar ?? new THREE.Color() },
    });
    const mortar = opts.mortar !== undefined && opts.mode === "triplanar";
    const ridge = opts.mode === "ridge";
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vDetWorld;
varying vec3 vDetNormal;
${ridge ? "attribute vec4 color;\nvarying vec2 vDetRidge;" : ""}`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vDetWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vDetNormal = mat3(modelMatrix) * objectNormal;
${ridge ? "vDetRidge = color.rg;" : ""}`,
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
uniform vec3 uDetMortar;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  float detFade = 1.0 - smoothstep(uDetFade.x, uDetFade.y, distance(vDetWorld, cameraPosition));
  // Més enllà del fade no hi ha detall: sense mostres de textura. A la vora, el detall ja és ~0 i
  // un mipmap imprecís als quads partits no es nota.
  if (detFade > 0.0) {
    ${SAMPLE[opts.mode]}
    diffuseColor.rgb *= mix(1.0, det * 2.0, uDetStrength * detFade);
    ${mortar ? "diffuseColor.rgb = mix(diffuseColor.rgb, uDetMortar * mix(1.0, det * 2.0, 0.5), detRG.g * detFade);" : ""}
  }`,
      );
  };
  // Cada combinació de codi ha de tenir el seu programa; els valors van per uniforms. La clau
  // anterior es calcula ara, abans de substituir onBeforeCompile (la clau per defecte n'és el codi).
  material.customProgramCacheKey = () => `${previousKey}|detail:${opts.mode}${opts.mortar ? ":mortar" : ""}`;
}
