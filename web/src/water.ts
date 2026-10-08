import * as THREE from "three";

/** Temps (s) de l'animació de l'aigua; s'actualitza a cada fotograma. */
export const waterTime = { value: 0 };

const WATER_COMMON = `
attribute vec4 color;
varying vec3 vWaterWorld;
varying vec2 vWaterFlow;
varying float vWaterDepth;
varying float vWaterBank;
`;

const WATER_VERTEX_AFTER = `
  vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWaterFlow = color.xy * 2.0 - 1.0;
  float flowLen = length(vWaterFlow);
  if (flowLen > 1.0e-4) {
    vWaterFlow /= flowLen;
  }
  vWaterDepth = color.z * 2.0;
  vWaterBank = color.w * 2.0 - 1.0;
`;

function flowVec(flow: string, prefix: string): string {
  return `
  vec2 ${prefix}flow = ${flow};
  float ${prefix}flowLen = length(${prefix}flow);
  if (${prefix}flowLen < 1.0e-4) {
    ${prefix}flow = vec2(1.0, 0.0);
  } else {
    ${prefix}flow /= ${prefix}flowLen;
  }
  vec2 ${prefix}cross = vec2(-${prefix}flow.y, ${prefix}flow.x);
  vec2 ${prefix}wpxz = vWaterWorld.xz;
  float ${prefix}along = dot(${prefix}wpxz, ${prefix}flow);
  float ${prefix}across = dot(${prefix}wpxz, ${prefix}cross);
`;
}

function createSurfaceMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a8a9a,
    roughness: 0.14,
    metalness: 0.05,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = waterTime;
    shader.uniforms.uWaterSky = { value: new THREE.Color(0xb8d8ec) };
    shader.uniforms.uWaterShallow = { value: new THREE.Color(0x3cb8b0) };
    shader.uniforms.uWaterDeep = { value: new THREE.Color(0x0e4a55) };

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WATER_COMMON}\nuniform float uWaterTime;`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
${WATER_VERTEX_AFTER}
  vec2 flow = vWaterFlow;
  float fl = length(flow);
  if (fl > 1.0e-4) flow /= fl;
  vec2 wp = vWaterWorld.xz;
  float along = dot(wp, flow);
  float across = dot(wp, vec2(-flow.y, flow.x));
  float wt = uWaterTime;
  float swell = sin(along * 1.6 - wt * 1.8 + sin(across * 0.7) * 0.4) * 0.055;
  swell += sin(across * 2.2 + wt * 1.3) * 0.018;
  swell += sin(along * 4.8 - wt * 3.4) * 0.012;
  transformed.y += swell;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
${WATER_COMMON}
uniform float uWaterTime;
uniform vec3 uWaterSky;
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  float wt = uWaterTime;
  ${flowVec("vWaterFlow", "nrm")}
  vec2 ripple = vec2(
    sin(nrmalong * 2.6 - wt * 2.9 + sin(nrmacross * 1.15) * 0.4) * 0.05 + sin(nrmacross * 8.0 + wt * 1.6) * 0.014,
    sin(nrmacross * 6.2 + wt * 1.25) * 0.016 + sin(nrmalong * 3.4 - wt * 3.3 + cos(nrmacross * 0.85) * 0.3) * 0.042);
  ripple += vec2(
    sin(nrmalong * 9.5 - wt * 5.5) * 0.008,
    cos(nrmalong * 8.8 - wt * 5.0) * 0.007);
  normal = normalize(normal + (viewMatrix * vec4(ripple.x, 0.0, ripple.y, 0.0)).xyz);`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  ${flowVec("vWaterFlow", "col")}
  vec3 viewDir = normalize(vViewPosition);
  float fresnel = pow(1.0 - clamp(dot(normalize(normal), viewDir), 0.0, 1.0), 3.5);
  float depthMix = clamp(vWaterDepth * 0.55 + fresnel * 0.25, 0.0, 1.0);
  vec3 waterTint = mix(uWaterDeep, uWaterShallow, 1.0 - depthMix);
  diffuseColor.rgb = mix(diffuseColor.rgb, waterTint, 0.92);
  float foam = smoothstep(0.62, 0.98, abs(vWaterBank));
  foam *= 0.35 + 0.65 * sin(colalong * 5.5 - uWaterTime * 4.8 + sin(colacross * 2.0) * 0.6) * 0.5 + 0.5;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.9, 0.88), foam * 0.55);
  diffuseColor.a = mix(0.94, 0.82, fresnel * 0.28);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
  ${flowVec("vWaterFlow", "emi")}
  float streak = sin(emialong * 3.6 - uWaterTime * 4.0 + sin(emiacross * 0.6) * 0.55);
  streak += 0.5 * sin(emialong * 7.0 - uWaterTime * 6.2 + cos(emiacross * 1.2) * 0.35);
  float sparkle = pow(max(0.0, streak * 0.24 + 0.16), 3.5);
  float caustic = pow(max(0.0, sin(emialong * 11.0 - uWaterTime * 7.5) * sin(emiacross * 9.0 + uWaterTime * 3.0) * 0.5 + 0.5), 6.0);
  float waterFresnel = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
  totalEmissiveRadiance += uWaterSky * (0.14 + 0.6 * waterFresnel + sparkle * 0.45);
  totalEmissiveRadiance += uWaterShallow * caustic * 0.16 * (1.0 - abs(vWaterBank));`,
      );
  };
  return mat;
}

function createVolumeMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a5a66,
    roughness: 0.5,
    metalness: 0,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = waterTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WATER_COMMON}\nuniform float uWaterTime;`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
${WATER_VERTEX_AFTER}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${WATER_COMMON}\nuniform float uWaterTime;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  ${flowVec("vWaterFlow", "vol")}
  float pulse = 0.92 + 0.08 * sin(volalong * 2.0 - uWaterTime * 1.5);
  vec3 vol = mix(vec3(0.06, 0.2, 0.24), vec3(0.12, 0.38, 0.42), clamp(vWaterDepth * 0.4, 0.0, 1.0));
  diffuseColor.rgb = vol * pulse;
  diffuseColor.a *= 0.88 + 0.12 * abs(vWaterBank);`,
      );
  };
  return mat;
}

export const waterSurfaceMaterial = createSurfaceMaterial();
export const waterVolumeMaterial = createVolumeMaterial();

export function setWaterEnvironment(envMap: THREE.Texture, intensity = 0.55): void {
  waterSurfaceMaterial.envMap = envMap;
  waterSurfaceMaterial.envMapIntensity = intensity;
  waterVolumeMaterial.envMap = envMap;
  waterVolumeMaterial.envMapIntensity = intensity * 0.35;
  waterSurfaceMaterial.needsUpdate = true;
  waterVolumeMaterial.needsUpdate = true;
}

export function ensureWaterFlowColors(geometry: THREE.BufferGeometry): void {
  const existing = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (existing && existing.itemSize === 4) {
    return;
  }
  if (existing && existing.itemSize === 3) {
    const upgraded = new Float32Array(existing.count * 4);
    for (let i = 0; i < existing.count; i++) {
      upgraded[i * 4] = existing.getX(i);
      upgraded[i * 4 + 1] = existing.getY(i);
      upgraded[i * 4 + 2] = existing.getZ(i);
      upgraded[i * 4 + 3] = 0.5;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(upgraded, 4));
    return;
  }
  const pos = geometry.getAttribute("position");
  if (!pos) {
    return;
  }
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    colors[i * 4] = 1;
    colors[i * 4 + 1] = 0.5;
    colors[i * 4 + 2] = 0.35;
    colors[i * 4 + 3] = 0.5;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
}

export function applyWaterMaterial(mesh: THREE.Mesh, kind: "surface" | "volume"): void {
  ensureWaterFlowColors(mesh.geometry);
  mesh.material = kind === "volume" ? waterVolumeMaterial : waterSurfaceMaterial;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = kind === "surface" ? 2 : 1;
}
