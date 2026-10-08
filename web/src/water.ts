import * as THREE from "three";

/** Temps (s) de l'animació de l'aigua; s'actualitza a cada fotograma. */
export const waterTime = { value: 0 };

const surfaceUniforms = {
  uWaterTime: waterTime,
  uWaterSky: { value: new THREE.Color(0xa8c6e0) },
  uWaterShallow: { value: new THREE.Color(0x3889a8) },
  uWaterDeep: { value: new THREE.Color(0x1a4a64) },
};

const surfaceVertexShader = `
uniform float uWaterTime;
attribute vec4 waterData;
varying vec3 vWorld;
varying vec2 vFlow;
varying float vDepth;
varying float vBank;
varying vec3 vNormalW;

void main() {
  vFlow = waterData.xy * 2.0 - 1.0;
  float fl = length(vFlow);
  if (fl > 1.0e-4) {
    vFlow /= fl;
  }
  vDepth = waterData.z * 2.0;
  vBank = waterData.w * 2.0 - 1.0;

  vec3 pos = position;
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorld = world.xyz;
  float along = dot(world.xz, vFlow);
  float across = dot(world.xz, vec2(-vFlow.y, vFlow.x));
  pos.y += sin(along * 2.4 - uWaterTime * 2.4) * 0.024 + sin(across * 3.6 + uWaterTime * 1.4) * 0.008;

  vec3 n = normalize(normalMatrix * normal);
  vNormalW = normalize((modelMatrix * vec4(n, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const surfaceFragmentShader = `
uniform float uWaterTime;
uniform vec3 uWaterSky;
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;
varying vec3 vWorld;
varying vec2 vFlow;
varying float vDepth;
varying float vBank;
varying vec3 vNormalW;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  vec3 n = normalize(vNormalW);
  float fresnel = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);

  float along = dot(vWorld.xz, vFlow);
  float across = dot(vWorld.xz, vec2(-vFlow.y, vFlow.x));
  vec2 ripple = vec2(
    sin(along * 2.6 - uWaterTime * 3.2 + sin(across * 1.0) * 0.3) * 0.16,
    sin(across * 5.5 + uWaterTime * 1.8) * 0.05 + sin(along * 3.2 - uWaterTime * 3.6) * 0.1);
  n = normalize(n + vec3(ripple.x, 0.0, ripple.y));

  vec3 col = mix(uWaterDeep, uWaterShallow, 1.0 - clamp(vDepth * 0.5 + fresnel * 0.28, 0.0, 1.0));
  float streak = sin(along * 3.6 - uWaterTime * 4.0 + sin(across * 0.7) * 0.4);
  float sparkle = pow(max(0.0, streak * 0.22 + 0.14), 4.0);
  col += uWaterSky * (0.07 + 0.28 * fresnel + sparkle * 0.14);

  // Partícules arrossegades avall del corrent. Tres capes amb graelles de mida, angle i velocitat
  // diferents; a cada cel·la, el hash decideix si n'hi ha, on cau i quina mida té, així no es veu
  // cap patró regular. La mida i el suavitzat van en metres i amb fwidth perquè de lluny no parpellegin.
  // Mida del píxel en metres, de les coordenades contínues (la distància dins la cel·la salta a la vora).
  float pixelM = max(length(fwidth(vec2(along, across))) * 0.7, 1.0e-4);
  float specks = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 spacing = i == 0 ? vec2(1.1, 0.7) : (i == 1 ? vec2(1.7, 0.95) : vec2(0.8, 0.55));
    float speed = i == 0 ? 0.5 : (i == 1 ? 0.34 : 0.62);
    float ang = i == 0 ? 0.0 : (i == 1 ? 0.13 : -0.11);
    vec2 q = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * vec2(along, across);
    q.x -= uWaterTime * speed;
    q += vec2(17.3, 5.1) * fi;
    vec2 cell = floor(q / spacing);
    vec2 f = q / spacing - cell;
    vec2 seed = cell + vec2(fi * 31.7, fi * 11.3);
    // Només ~28 % de les cel·les tenen partícula.
    float present = step(hash12(seed + 7.7), 0.28);
    vec2 centre = 0.2 + 0.6 * hash22(seed);
    // Cada partícula oscil·la una mica de costat, amb fase pròpia.
    centre.y += sin(uWaterTime * 1.3 + hash12(seed + 2.9) * 6.283) * 0.08;
    vec2 dm = (f - centre) * spacing;
    dm.x *= 0.75;
    float dist = length(dm);
    float r = mix(0.018, 0.045, hash12(seed + 4.3));
    float w = pixelM;
    // De lluny, la partícula és més petita que el píxel: s'esvaeix en lloc de fer-se borrosa.
    specks += present * (1.0 - smoothstep(r - w, r + w, dist)) * clamp(r / (1.5 * w), 0.0, 1.0);
  }
  specks = clamp(specks, 0.0, 1.0);
  col = mix(col, vec3(0.86, 0.9, 0.84), specks * 0.6);

  float foam = smoothstep(0.7, 0.98, abs(vBank));
  foam *= 0.55 + 0.45 * sin(along * 5.0 - uWaterTime * 4.0);
  col = mix(col, vec3(0.82, 0.88, 0.86), foam * 0.28);

  float alpha = mix(0.84, 0.7, fresnel * 0.3);
  gl_FragColor = vec4(col, alpha);
}
`;

function createSurfaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uWaterTime: waterTime,
      uWaterSky: { value: surfaceUniforms.uWaterSky.value.clone() },
      uWaterShallow: { value: surfaceUniforms.uWaterShallow.value.clone() },
      uWaterDeep: { value: surfaceUniforms.uWaterDeep.value.clone() },
    },
    vertexShader: surfaceVertexShader,
    fragmentShader: surfaceFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

const volumeVertexShader = `
attribute vec4 waterData;
varying float vDepth;
void main() {
  vDepth = waterData.z * 2.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const volumeFragmentShader = `
uniform float uWaterTime;
varying float vDepth;
void main() {
  float pulse = 0.96 + 0.04 * sin(uWaterTime * 1.6);
  vec3 col = mix(vec3(0.03, 0.13, 0.22), vec3(0.06, 0.24, 0.36), clamp(vDepth * 0.4, 0.0, 1.0));
  gl_FragColor = vec4(col * pulse, 0.65);
}
`;

function createVolumeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uWaterTime: waterTime },
    vertexShader: volumeVertexShader,
    fragmentShader: volumeFragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export const waterSurfaceMaterial = createSurfaceMaterial();
export const waterVolumeMaterial = createVolumeMaterial();

export function setWaterEnvironment(envMap: THREE.Texture, _intensity = 0.5): void {
  // ShaderMaterial sense PBR: el cel ja entra per uWaterSky animat.
  void envMap;
}

function ensureWaterDataAttribute(geometry: THREE.BufferGeometry): void {
  if (geometry.getAttribute("waterData")) {
    return;
  }
  const fromGltf = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (fromGltf) {
    const attr = fromGltf.clone();
    attr.normalized = fromGltf.normalized;
    geometry.setAttribute("waterData", attr);
    return;
  }
  const pos = geometry.getAttribute("position");
  if (!pos) {
    return;
  }
  const data = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    data[i * 4] = 1;
    data[i * 4 + 1] = 0.5;
    data[i * 4 + 2] = 0.35;
    data[i * 4 + 3] = 0.5;
  }
  geometry.setAttribute("waterData", new THREE.BufferAttribute(data, 4));
}

export function applyWaterMaterial(mesh: THREE.Mesh, kind: "surface" | "volume"): void {
  ensureWaterDataAttribute(mesh.geometry);
  if (!mesh.geometry.getAttribute("normal")) {
    mesh.geometry.computeVertexNormals();
  }
  mesh.material = kind === "volume" ? waterVolumeMaterial : waterSurfaceMaterial;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = kind === "surface" ? 10 : 9;
}