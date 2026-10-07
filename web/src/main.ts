import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { Autopilot } from "./autopilot";
import { R12, stepSpeed, stepSteer, yawRate } from "./vehicle";

type SpawnData = {
  position: { x: number; y: number; z: number };
  rotation_y_deg: number;
};

// Raycast accelerat amb BVH: la calçada i les parets es consulten desenes de cops per fotograma.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

type SurfaceKind = "road" | "building" | "roof" | "prop" | "terrain" | "green";

/** Capa dels detalls petits (façanes, plantes): els veu la càmera principal però no el minimapa,
 * el mapa gran ni el mapa d'ombres. */
const DETAIL_LAYER = 1;

const keys = new Set<string>();

// --- Opcions (tecla O): es desen al navegador ---

type Settings = { hideStreetNames: boolean };
const SETTINGS_KEY = "abraveses-racing.settings";

function loadSettings(): Settings {
  const defaults: Settings = { hideStreetNames: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) } : defaults;
  } catch {
    return defaults;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Sense emmagatzematge (finestra privada, etc.): l'opció val només per a aquesta sessió.
  }
}

const settings = loadSettings();

const scene = new THREE.Scene();
const SKY = 0xb4daf5;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 140, 560);

// La boira tapa del tot a 560 m: més enllà no cal dibuixar res.
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.2, 600);
camera.layers.enable(DETAIL_LAYER);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.info.autoReset = false;
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.domElement.tabIndex = 0;
renderer.domElement.style.outline = "none";
document.body.appendChild(renderer.domElement);
renderer.domElement.addEventListener("pointerdown", () => {
  renderer.domElement.focus();
});

scene.add(new THREE.AmbientLight(0xfff8ef, 0.52));
scene.add(new THREE.HemisphereLight(0xd8ecff, 0x8fbc7a, 0.38));
// Ombres només al voltant del cotxe: el mapa d'ombres el segueix (vegeu followSun), i així
// amb 2048 px cobreix 100 m amb ~5 cm per texel en lloc de 240 m borrosos.
const SUN_OFFSET = new THREE.Vector3(80, 140, 40).normalize().multiplyScalar(160);
const SHADOW_HALF_M = 50;
const sun = new THREE.DirectionalLight(0xfff5e8, 1.12);
sun.position.copy(SUN_OFFSET);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 400;
sun.shadow.camera.left = -SHADOW_HALF_M;
sun.shadow.camera.right = SHADOW_HALF_M;
sun.shadow.camera.top = SHADOW_HALF_M;
sun.shadow.camera.bottom = -SHADOW_HALF_M;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

const worldRoot = new THREE.Group();
scene.add(worldRoot);

const kart = new THREE.Group();
scene.add(kart);
// Rodes animades: `spin` giren amb la distància recorreguda, `steer` són les davanteres.
const kartWheels = { spin: [] as THREE.Object3D[], steer: [] as THREE.Object3D[] };

let spawn: SpawnData = {
  position: { x: 0, y: 3, z: 0 },
  rotation_y_deg: 0,
};

const state = {
  speed: 0,
  heading: 0,
  /** Posició del volant (−1..1), amb inèrcia. */
  steer: 0,
  /** El model té les rodes tocant y = 0; només un pèl per sobre de la calçada. */
  wheelOffset: 0.02,
  verticalVelocity: 0,
};

const GRAVITY = 38;
const HOP_VELOCITY = 10.5;

// Mostres de "és a la calçada": una mica dins la carrosseria (4,35 × 1,64 m) perquè
// els voladissos puguin sobresortir com als carrers estrets reals.
const KART_HALF_W = 0.7;
const KART_HALF_L = 1.6;
const WALL_CHECK_M = 2.3;
// Càmera de persecució per a un cotxe de mida real.
const CAM_BACK_M = 10.5;
const CAM_UP_M = 4.2;
const CAM_LOOK_UP_M = 1.4;

const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const down = new THREE.Vector3(0, -1, 0);
const rayOrigin = new THREE.Vector3();
const rayDir = new THREE.Vector3();
// Només la calçada: el terreny dens faria el raycast massa car i no és conduïble.
const roadMeshes: THREE.Object3D[] = [];
const wallMeshes: THREE.Object3D[] = [];
const textureLoader = new THREE.TextureLoader();
let terrainSizeM = 700;
let terrainMaterial: THREE.MeshStandardMaterial | null = null;
let roofMaterial: THREE.MeshStandardMaterial | null = null;
let assetCacheKey = "1";

async function loadSpawn(): Promise<void> {
  const res = await fetch("/spawn.json");
  if (res.ok) {
    spawn = (await res.json()) as SpawnData;
  }
}

type WorldMeta = { size_m: number; elevation_min_m: number; resolution: number };

async function loadWorldMeta(): Promise<void> {
  const res = await fetch("/world_meta.json");
  if (!res.ok) {
    return;
  }
  const meta = (await res.json()) as WorldMeta;
  terrainSizeM = meta.size_m;
  assetCacheKey = `${meta.size_m}-${meta.resolution}-${meta.elevation_min_m}`;
}

function ensurePlanarUvs(geometry: THREE.BufferGeometry, sizeM: number): void {
  const pos = geometry.attributes.position;
  if (!pos) {
    return;
  }
  const half = sizeM / 2;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uvs[i * 2] = (pos.getX(i) + half) / sizeM;
    uvs[i * 2 + 1] = (-pos.getZ(i) + half) / sizeM;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

/** Un sol material (i una sola textura de 4096 px a la GPU) per a tots els trossos del terreny;
 * les teulades en fan una còpia de doble cara que comparteix la mateixa textura. */
function sharedTerrainMaterials(): { ground: THREE.MeshStandardMaterial; roof: THREE.MeshStandardMaterial } {
  if (!terrainMaterial || !roofMaterial) {
    const ground = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    const roof = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    terrainMaterial = ground;
    roofMaterial = roof;
    textureLoader.load(
      `/terrain.jpg?${assetCacheKey}`,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        for (const mat of [ground, roof]) {
          mat.map = tex;
          mat.needsUpdate = true;
        }
      },
      undefined,
      () => {
        ground.color.setHex(0x8fbf75);
        roof.color.setHex(0xb0644a);
      },
    );
  }
  return { ground: terrainMaterial, roof: roofMaterial };
}

function applyTerrainMaterial(mesh: THREE.Mesh, kind: "terrain" | "roof"): void {
  ensurePlanarUvs(mesh.geometry, terrainSizeM);
  const mats = sharedTerrainMaterials();
  mesh.material = kind === "roof" ? mats.roof : mats.ground;
}

// --- Renault 12 low-poly a mida real (4,35 × 1,64 m), +Z endavant, rodes tocant y = 0 ---

const R12_PAINT = 0x74264f; // granat tirant a lila
const R12_WHEEL_R = 0.3;
const R12_FRONT_AXLE_Z = 1.32;
const R12_REAR_AXLE_Z = R12_FRONT_AXLE_Z - R12.wheelbaseM;
/** Angle màxim de les rodes davanteres: atan(batalla / radi de gir mínim). */
const R12_MAX_WHEEL_ANGLE = Math.atan(R12.wheelbaseM / R12.minTurnRadius);

/** Perfil lateral dibuixat en (z, y) i extrudit a l'amplada (eix X), centrat. */
function extrudeSide(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geo.rotateY(-Math.PI / 2); // forma x → món z; extrusió → món −x
  geo.translate((width - 2 * bevel) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

function addPart(root: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function buildKartVisual(root: THREE.Group): void {
  const paint = new THREE.MeshPhysicalMaterial({
    color: R12_PAINT,
    roughness: 0.38,
    metalness: 0.15,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
  });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1c2730, roughness: 0.12, metalness: 0.35 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.22, metalness: 0.35 });
  const black = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.6 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.9 });
  const headlight = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c0, emissiveIntensity: 0.35 });
  const taillight = new THREE.MeshStandardMaterial({ color: 0xb3141b, emissive: 0x5a0000, emissiveIntensity: 0.6 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xf29a1d, emissive: 0x4a2600, emissiveIntensity: 0.5 });
  const plate = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 });

  // Carrosseria baixa: berlina de tres volums amb passos de roda.
  const arch = R12_WHEEL_R + 0.07;
  const body = new THREE.Shape();
  body.moveTo(-2.15, 0.3);
  body.lineTo(R12_REAR_AXLE_Z - arch, 0.3);
  body.absarc(R12_REAR_AXLE_Z, R12_WHEEL_R, arch, Math.PI, 0, true);
  body.lineTo(R12_FRONT_AXLE_Z - arch, 0.3);
  body.absarc(R12_FRONT_AXLE_Z, R12_WHEEL_R, arch, Math.PI, 0, true);
  body.lineTo(2.15, 0.3);
  body.lineTo(2.17, 0.66); // frontal
  body.lineTo(2.1, 0.76); // vora del capó
  body.lineTo(0.78, 0.86); // base del parabrisa
  body.lineTo(-1.5, 0.88); // línia de cintura fins al vidre posterior
  body.lineTo(-2.1, 0.86); // tapa del maleter
  body.lineTo(-2.17, 0.7);
  body.closePath();
  addPart(root, extrudeSide(body, R12.widthM, 0.03), paint);

  // Habitacle de vidre, més estret que la carrosseria, amb sostre i pilars de color.
  const cabin = new THREE.Shape();
  cabin.moveTo(0.78, 0.86);
  cabin.lineTo(0.18, 1.34);
  cabin.lineTo(-0.95, 1.36);
  cabin.lineTo(-1.52, 0.88);
  cabin.closePath();
  addPart(root, extrudeSide(cabin, 1.4, 0.02), glass);
  addPart(root, new THREE.BoxGeometry(1.42, 0.05, 1.2), paint, 0, 1.385, -0.39);
  const pillars: [number, number, number, number][] = [
    [0.78, 0.87, 0.18, 1.36], // A
    [-0.3, 0.87, -0.33, 1.37], // B
    [-0.95, 1.36, -1.52, 0.88], // C
  ];
  for (const [z1, y1, z2, y2] of pillars) {
    const len = Math.hypot(z2 - z1, y2 - y1);
    for (const side of [-1, 1]) {
      const pillar = addPart(root, new THREE.BoxGeometry(0.05, len, 0.08), paint, side * 0.705, (y1 + y2) / 2, (z1 + z2) / 2);
      pillar.rotation.x = Math.atan2(z2 - z1, y2 - y1);
    }
  }

  // Frontal: fars rectangulars amb la graella al mig i el rombe de Renault.
  for (const side of [-1, 1]) {
    addPart(root, new THREE.BoxGeometry(0.34, 0.15, 0.04), headlight, side * 0.5, 0.6, 2.18);
    addPart(root, new THREE.BoxGeometry(0.14, 0.06, 0.04), amber, side * 0.62, 0.47, 2.18);
    addPart(root, new THREE.BoxGeometry(0.32, 0.17, 0.04), taillight, side * 0.58, 0.66, -2.18);
    addPart(root, new THREE.BoxGeometry(0.1, 0.06, 0.04), amber, side * 0.58, 0.53, -2.18);
    addPart(root, new THREE.BoxGeometry(0.12, 0.08, 0.06), black, side * 0.87, 0.97, 0.62); // retrovisor
    addPart(root, new THREE.BoxGeometry(0.012, 0.03, 3.3), chrome, side * 0.83, 0.56, 0.05); // embellidor lateral
  }
  addPart(root, new THREE.BoxGeometry(0.58, 0.13, 0.04), black, 0, 0.6, 2.17);
  const logo = addPart(root, new THREE.BoxGeometry(0.07, 0.07, 0.02), chrome, 0, 0.6, 2.2);
  logo.rotation.z = Math.PI / 4;

  // Para-xocs cromats i matrícules.
  addPart(root, new THREE.BoxGeometry(1.7, 0.09, 0.12), chrome, 0, 0.4, 2.22);
  addPart(root, new THREE.BoxGeometry(1.7, 0.09, 0.12), chrome, 0, 0.4, -2.22);
  addPart(root, new THREE.BoxGeometry(0.52, 0.11, 0.02), plate, 0, 0.4, 2.29);
  addPart(root, new THREE.BoxGeometry(0.52, 0.11, 0.02), plate, 0, 0.5, -2.2);

  // Rodes amb tapaboques: pivot (gir de direcció) → spinner (rodolament) → pneumàtic.
  const tyreGeo = new THREE.CylinderGeometry(R12_WHEEL_R, R12_WHEEL_R, 0.18, 20);
  tyreGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16);
  hubGeo.rotateZ(Math.PI / 2);
  for (const z of [R12_FRONT_AXLE_Z, R12_REAR_AXLE_Z]) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.7, R12_WHEEL_R, z);
      root.add(pivot);
      const spinner = new THREE.Group();
      pivot.add(spinner);
      addPart(spinner, tyreGeo, tyre);
      addPart(spinner, hubGeo, chrome, side * 0.095, 0, 0);
      kartWheels.spin.push(spinner);
      if (z === R12_FRONT_AXLE_Z) {
        kartWheels.steer.push(pivot);
      }
    }
  }
}

function animateWheels(distance: number): void {
  for (const w of kartWheels.spin) {
    w.rotation.x += distance / R12_WHEEL_R;
  }
  for (const w of kartWheels.steer) {
    w.rotation.y = -state.steer * R12_MAX_WHEEL_ANGLE;
  }
}

function surfaceKind(obj: THREE.Object3D): SurfaceKind {
  let node: THREE.Object3D | null = obj;
  while (node) {
    const name = node.name.toLowerCase();
    if (name.includes("road")) {
      return "road";
    }
    if (name.includes("building")) {
      return "building";
    }
    if (name.includes("roof")) {
      return "roof";
    }
    if (name.includes("prop")) {
      return "prop";
    }
    if (name.includes("terrain")) {
      return "terrain";
    }
    if (name.includes("green")) {
      return "green";
    }
    node = node.parent;
  }
  return "terrain";
}

function castGroundHits(x: number, z: number): THREE.Intersection[] {
  raycaster.set(rayOrigin.set(x, 400, z), down);
  raycaster.far = 800;
  return raycaster.intersectObjects(roadMeshes, false);
}

function roadHitAt(x: number, z: number): THREE.Intersection | null {
  for (const hit of castGroundHits(x, z)) {
    if (surfaceKind(hit.object) === "road") {
      return hit;
    }
  }
  return null;
}

function isOnRoad(x: number, z: number): boolean {
  return roadHitAt(x, z) !== null;
}

function sampleRoadY(x: number, z: number): number | null {
  const hit = roadHitAt(x, z);
  return hit ? hit.point.y : null;
}

function driveSamplePoints(x: number, z: number, heading: number): [number, number][] {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const rx = Math.cos(heading);
  const rz = -Math.sin(heading);
  return [
    [x, z],
    [x + fx * KART_HALF_L, z + fz * KART_HALF_L],
    [x - fx * KART_HALF_L, z - fz * KART_HALF_L],
    [x + rx * KART_HALF_W, z + rz * KART_HALF_W],
    [x - rx * KART_HALF_W, z - rz * KART_HALF_W],
  ];
}

function canDriveAt(x: number, z: number, heading: number): boolean {
  const points = driveSamplePoints(x, z, heading);
  const onRoad = points.filter(([px, pz]) => isOnRoad(px, pz)).length;
  return onRoad >= Math.max(3, points.length - 1);
}

function snapToDrivableRoad(x: number, z: number, heading: number): [number, number] {
  if (canDriveAt(x, z, heading)) {
    return [x, z];
  }
  for (let radius = 0.75; radius <= 48; radius += 0.75) {
    const steps = Math.max(12, Math.ceil(radius * 2));
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const tx = x + Math.cos(angle) * radius;
      const tz = z + Math.sin(angle) * radius;
      if (canDriveAt(tx, tz, heading)) {
        return [tx, tz];
      }
    }
  }
  return [x, z];
}

function blockedByWall(
  from: THREE.Vector3,
  dir: THREE.Vector3,
  distance: number,
): boolean {
  if (wallMeshes.length === 0) {
    return false;
  }
  raycaster.set(rayOrigin.set(from.x, from.y + 0.85, from.z), rayDir.copy(dir).normalize());
  raycaster.far = distance;
  const hits = raycaster.intersectObjects(wallMeshes, false);
  return hits.length > 0 && hits[0].distance < distance;
}

function roadFloorY(x: number, z: number): number | null {
  const gy = sampleRoadY(x, z);
  return gy === null ? null : gy + state.wheelOffset;
}

function tryHop(): void {
  if (state.verticalVelocity > 0.4) {
    return;
  }
  const floor = roadFloorY(kart.position.x, kart.position.z);
  if (floor === null) {
    return;
  }
  if (kart.position.y > floor + 0.12) {
    return;
  }
  state.verticalVelocity = HOP_VELOCITY;
}

function applySpawn(): void {
  state.speed = 0;
  state.verticalVelocity = 0;
  state.steer = 0;
  autopilot?.reset();
  state.heading = THREE.MathUtils.degToRad(spawn.rotation_y_deg);
  kart.rotation.y = state.heading;
  const [sx, sz] = snapToDrivableRoad(spawn.position.x, spawn.position.z, state.heading);
  const y = sampleRoadY(sx, sz) ?? spawn.position.y;
  kart.position.set(sx, y + state.wheelOffset, sz);
  placeCameraBehindKart();
}

const worldMaterials = {
  building: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 }),
  prop: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 }),
  green: new THREE.MeshStandardMaterial({ color: 0x62c872, roughness: 0.92 }),
  road: new THREE.MeshStandardMaterial({ color: 0x35353c, roughness: 0.86 }),
};

function tintWorld(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    // Sense normals, els materials il·luminats donen NaN al shader i es pinten negres.
    if (!mesh.geometry.attributes.normal) {
      mesh.geometry.computeVertexNormals();
    }
    const kind = surfaceKind(mesh);
    // Només fan ombra les coses alçades; el terra, la calçada i els detalls només la reben.
    mesh.castShadow = kind === "building" || kind === "roof";
    mesh.receiveShadow = kind !== "prop";

    if (kind === "building") {
      wallMeshes.push(mesh);
      mesh.geometry.computeBoundsTree();
      mesh.material = mesh.geometry.attributes.color
        ? worldMaterials.building
        : new THREE.MeshStandardMaterial({ color: 0xd9a088, roughness: 0.78 });
      return;
    }
    if (kind === "prop") {
      mesh.material = worldMaterials.prop;
      mesh.layers.set(DETAIL_LAYER);
      return;
    }
    if (kind === "green") {
      mesh.material = worldMaterials.green;
      return;
    }
    if (kind === "road") {
      roadMeshes.push(mesh);
      mesh.geometry.computeBoundsTree();
      mesh.material = worldMaterials.road;
      return;
    }
    applyTerrainMaterial(mesh, kind === "roof" ? "roof" : "terrain");
  });
}

type TreesFile = { trees: [number, number, number, number][] };

function buildCartoonTrees(instances: TreesFile["trees"]): THREE.InstancedMesh {
  const trunk = new THREE.CylinderGeometry(0.07, 0.1, 0.55, 6);
  trunk.translate(0, 0.28, 0);
  const crown = new THREE.ConeGeometry(0.52, 1.15, 7);
  crown.translate(0, 0.95, 0);
  const geo = mergeGeometries([trunk, crown], true);
  if (!geo) {
    throw new Error("tree geometry merge failed");
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0x3d9e52, roughness: 0.82, flatShading: true });
  const trees = new THREE.InstancedMesh(geo, mat, instances.length);
  trees.castShadow = true;
  trees.receiveShadow = true;
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let i = 0; i < instances.length; i++) {
    const [x, y, z, s] = instances[i];
    pos.set(x, y, z);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 2.399) % (Math.PI * 2));
    scale.set(s, s, s);
    m.compose(pos, quat, scale);
    trees.setMatrixAt(i, m);
  }
  trees.instanceMatrix.needsUpdate = true;
  return trees;
}

async function loadTrees(): Promise<void> {
  const res = await fetch(`/trees.json?${assetCacheKey}`);
  if (!res.ok) {
    return;
  }
  const data = (await res.json()) as TreesFile;
  if (!data.trees?.length) {
    return;
  }
  worldRoot.add(buildCartoonTrees(data.trees));
}

// --- Poble de detall: arbres i plantes d'hort detectats a l'ortofoto (village.json) ---

type VillageFile = {
  trees: { x: number; y: number; z: number; r: number; h: number; c: [number, number, number] }[];
  plants: { x: number; y: number; z: number; c: [number, number, number] }[];
};

/** Color de la foto en sRGB; `gain` compensa que la foto inclou les ombres de dins la copa. */
function photoColor(c: [number, number, number], gain: number): THREE.Color {
  return new THREE.Color().setRGB(
    Math.min(1, (c[0] / 255) * gain),
    Math.min(1, (c[1] / 255) * gain),
    Math.min(1, (c[2] / 255) * gain),
    THREE.SRGBColorSpace,
  );
}

// Arbres i plantes es parteixen en zones de 8×8: el frustum culling descarta les que queden
// fora de càmera, i les plantes (petites) només es dibuixen a prop.
const CHUNKS_PER_SIDE = 8;
const TREE_DRAW_DIST_M = 450;
const PLANT_DRAW_DIST_M = 140;
type DistanceCulled = { obj: THREE.Object3D; x: number; z: number; maxDist: number };
const distanceCulled: DistanceCulled[] = [];

function groupByChunk<T extends { x: number; z: number }>(items: T[]): T[][] {
  const size = terrainSizeM / CHUNKS_PER_SIDE;
  const cell = (v: number) => THREE.MathUtils.clamp(Math.floor((v + terrainSizeM / 2) / size), 0, CHUNKS_PER_SIDE - 1);
  const groups = new Map<number, T[]>();
  for (const it of items) {
    const key = cell(it.x) * CHUNKS_PER_SIDE + cell(it.z);
    const list = groups.get(key);
    if (list) {
      list.push(it);
    } else {
      groups.set(key, [it]);
    }
  }
  return [...groups.values()];
}

function registerDistanceCull(obj: THREE.Object3D, items: { x: number; z: number }[], maxDist: number): void {
  const x = items.reduce((a, t) => a + t.x, 0) / items.length;
  const z = items.reduce((a, t) => a + t.z, 0) / items.length;
  // Radi de la zona (diagonal de mitja cel·la) perquè no desaparegui res a la vora.
  const reach = maxDist + (terrainSizeM / CHUNKS_PER_SIDE) * 0.71;
  distanceCulled.push({ obj, x, z, maxDist: reach });
}

let lastCullCheck = -Infinity;

function cullByDistance(now: number): void {
  if (now - lastCullCheck < 250) {
    return;
  }
  lastCullCheck = now;
  const { x, z } = camera.position;
  for (const c of distanceCulled) {
    c.obj.visible = Math.hypot(c.x - x, c.z - z) < c.maxDist;
  }
}

const treeTrunkGeo = new THREE.CylinderGeometry(0.1, 0.16, 1, 6).translate(0, 0.5, 0);
const treeCrownGeo = new THREE.IcosahedronGeometry(1, 1);
const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.9 });
const treeCrownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
const plantGeo = new THREE.OctahedronGeometry(0.3, 0).scale(1, 0.75, 1).translate(0, 0.18, 0);
const plantMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });

function buildVillageTrees(trees: VillageFile["trees"]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const chunk of groupByChunk(trees)) {
    const trunks = new THREE.InstancedMesh(treeTrunkGeo, treeTrunkMat, chunk.length);
    const crowns = new THREE.InstancedMesh(treeCrownGeo, treeCrownMat, chunk.length);
    chunk.forEach((t, i) => {
      const crownH = t.r * 0.85;
      const trunkH = Math.max(1, t.h - crownH * 1.3);
      const girth = THREE.MathUtils.clamp(t.r * 0.3, 0.7, 2);
      quat.setFromAxisAngle(up, ((t.x * 7.1 + t.z * 3.7) % (Math.PI * 2)));
      trunks.setMatrixAt(i, m.compose(pos.set(t.x, t.y, t.z), quat, scale.set(girth, trunkH, girth)));
      crowns.setMatrixAt(i, m.compose(pos.set(t.x, t.y + t.h - crownH, t.z), quat, scale.set(t.r, crownH, t.r)));
      crowns.setColorAt(i, photoColor(t.c, 1.35));
    });
    const group = new THREE.Group();
    for (const mesh of [trunks, crowns]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    registerDistanceCull(group, chunk, TREE_DRAW_DIST_M);
    out.push(group);
  }
  return out;
}

function buildHortPlants(plants: VillageFile["plants"]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const chunk of groupByChunk(plants)) {
    const mesh = new THREE.InstancedMesh(plantGeo, plantMat, chunk.length);
    chunk.forEach((p, i) => {
      const s = 0.8 + (((p.x + p.z) * 0.618) % 1 + 1) % 1 * 0.5;
      quat.setFromAxisAngle(up, (p.x * 1.7 + p.z) % (Math.PI * 2));
      mesh.setMatrixAt(i, m.compose(pos.set(p.x, p.y, p.z), quat, scale.set(s, s, s)));
      mesh.setColorAt(i, photoColor(p.c, 1.15));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    mesh.layers.set(DETAIL_LAYER);
    registerDistanceCull(mesh, chunk, PLANT_DRAW_DIST_M);
    out.push(mesh);
  }
  return out;
}

async function loadVillage(): Promise<void> {
  const res = await fetch(`/village.json?${assetCacheKey}`);
  if (!res.ok) {
    return;
  }
  const data = (await res.json()) as VillageFile;
  const group = new THREE.Group();
  if (data.trees?.length) {
    group.add(...buildVillageTrees(data.trees));
  }
  if (data.plants?.length) {
    group.add(...buildHortPlants(data.plants));
  }
  worldRoot.add(group);
  group.updateMatrixWorld(true);
  freezeStatic(group);
}

/** El mapa d'ombres segueix el cotxe, ajustat a la mida del texel perquè les vores no tremolin. */
function followSun(): void {
  const texel = (2 * SHADOW_HALF_M) / sun.shadow.mapSize.x;
  const x = Math.round(kart.position.x / texel) * texel;
  const z = Math.round(kart.position.z / texel) * texel;
  const y = kart.position.y;
  sun.target.position.set(x, y, z);
  sun.position.set(x + SUN_OFFSET.x, y + SUN_OFFSET.y, z + SUN_OFFSET.z);
  sun.target.updateMatrixWorld();
}

async function loadWorld(): Promise<void> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(`/world.glb?${assetCacheKey}`);
  const world = gltf.scene;
  tintWorld(world);
  worldRoot.add(world);
  world.updateMatrixWorld(true);
  freezeStatic(world);
}

/** El món no es mou: sense recalcular matrius a cada fotograma. */
function freezeStatic(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
  });
}

// --- Minimapa: vista cenital orientada amb el kart, zoom segons la velocitat ---

const MINIMAP_PX = 200;
const MINIMAP_MARGIN = 16;
const MINIMAP_HALF_SLOW = 45;
const MINIMAP_HALF_FAST = 110;
/** Velocitat (m/s) a partir de la qual el minimapa ja és al zoom més llunyà (~90 km/h). */
const MINIMAP_FAST_SPEED = 25;
const MINIMAP_BG = new THREE.Color(0x26302a);
const LABEL_SPACING_M = 35;

type StreetsFile = {
  streets: { name: string; points: [number, number][] }[];
  roads?: [number, number][][];
};
type StreetLabel = { text: string; x: number; z: number; dx: number; dz: number };

const minimapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
let minimapHalf = MINIMAP_HALF_SLOW;
// Sense MSAA: a 200 px el minimapa no ho nota i estalvia un resolve per actualització.
const minimapTarget = new THREE.WebGLRenderTarget(1, 1);
const hudScene = new THREE.Scene();
const hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
const minimapQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(MINIMAP_PX, MINIMAP_PX),
  new THREE.MeshBasicMaterial({
    map: minimapTarget.texture,
    alphaMap: circleMaskTexture(),
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }),
);
hudScene.add(minimapQuad);

const minimapCanvas = document.getElementById("minimap") as HTMLCanvasElement | null;
const minimapCtx = minimapCanvas?.getContext("2d") ?? null;
const streetLabels: StreetLabel[] = [];
const streetLines: { name: string; points: [number, number][] }[] = [];
const roadPolylines: [number, number][][] = [];
const projA = new THREE.Vector3();
const projB = new THREE.Vector3();

function circleMaskTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(128, 128, 126, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

function layoutMinimap(): void {
  const dpr = renderer.getPixelRatio();
  const px = Math.round(MINIMAP_PX * dpr);
  minimapTarget.setSize(px, px);
  hudCam.right = window.innerWidth;
  hudCam.top = window.innerHeight;
  hudCam.updateProjectionMatrix();
  minimapQuad.position.set(
    window.innerWidth - MINIMAP_MARGIN - MINIMAP_PX / 2,
    window.innerHeight - MINIMAP_MARGIN - MINIMAP_PX / 2,
    0,
  );
  if (minimapCanvas) {
    minimapCanvas.width = px;
    minimapCanvas.height = px;
  }
}

function shortStreetName(name: string): string {
  return name.replace(/^Calle\s+/i, "C/ ").replace(/^Carretera\s+/i, "Ctra. ");
}

async function loadStreets(): Promise<void> {
  const res = await fetch(`/streets.json?${assetCacheKey}`);
  if (!res.ok) {
    return;
  }
  const data = (await res.json()) as StreetsFile;
  roadPolylines.push(...(data.roads ?? data.streets.map((s) => s.points)));
  autopilot = new Autopilot(roadPolylines);
  for (const street of data.streets ?? []) {
    streetLines.push(street);
    const text = shortStreetName(street.name);
    let carry = LABEL_SPACING_M / 2;
    for (let i = 1; i < street.points.length; i++) {
      const [ax, az] = street.points[i - 1];
      const [bx, bz] = street.points[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) {
        continue;
      }
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      let d = carry;
      for (; d < len; d += LABEL_SPACING_M) {
        streetLabels.push({ text, x: ax + dx * d, z: az + dz * d, dx, dz });
      }
      carry = d - len;
    }
  }
}

function updateMinimapCamera(dt: number, forward: THREE.Vector3): void {
  const t = THREE.MathUtils.clamp(Math.abs(state.speed) / MINIMAP_FAST_SPEED, 0, 1);
  const target = THREE.MathUtils.lerp(MINIMAP_HALF_SLOW, MINIMAP_HALF_FAST, t);
  minimapHalf += (target - minimapHalf) * (1 - Math.exp(-2.5 * dt));
  minimapCam.left = -minimapHalf;
  minimapCam.right = minimapHalf;
  minimapCam.top = minimapHalf;
  minimapCam.bottom = -minimapHalf;
  minimapCam.updateProjectionMatrix();

  // Centre una mica per davant del kart: més mapa visible en la direcció de marxa.
  const ahead = minimapHalf * 0.3;
  const cx = kart.position.x + forward.x * ahead;
  const cz = kart.position.z + forward.z * ahead;
  minimapCam.position.set(cx, kart.position.y + 300, cz);
  minimapCam.up.set(forward.x, 0, forward.z);
  minimapCam.lookAt(cx, kart.position.y, cz);
  minimapCam.updateMatrixWorld();
}

function toMinimapPx(x: number, y: number, z: number, out: THREE.Vector3, size: number): THREE.Vector3 {
  out.set(x, y, z).project(minimapCam);
  return out.set(((out.x + 1) / 2) * size, ((1 - out.y) / 2) * size, 0);
}

function drawStreetLabels(
  ctx: CanvasRenderingContext2D,
  toPx: (x: number, z: number, out: THREE.Vector3) => THREE.Vector3,
  dpr: number,
  fits: (p: THREE.Vector3, textWidth: number) => boolean,
  fontPx = 11,
): void {
  ctx.save();
  ctx.font = `600 ${fontPx * dpr}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = "rgba(20, 20, 24, 0.85)";
  ctx.fillStyle = "#ffffff";
  const placed: { x: number; y: number; w: number; text: string }[] = [];
  for (const label of streetLabels) {
    const p = toPx(label.x, label.z, projA);
    const w = ctx.measureText(label.text).width;
    if (!fits(p, w)) {
      continue;
    }
    const clash = placed.some((o) => {
      const dist = Math.hypot(o.x - p.x, o.y - p.y);
      return o.text === label.text ? dist < 140 * dpr : dist < (o.w + w) * 0.45 + 8 * dpr;
    });
    if (clash) {
      continue;
    }
    const q = toPx(label.x + label.dx, label.z + label.dz, projB);
    let angle = Math.atan2(q.y - p.y, q.x - p.x);
    if (angle > Math.PI / 2) {
      angle -= Math.PI;
    } else if (angle < -Math.PI / 2) {
      angle += Math.PI;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.strokeText(label.text, 0, 0);
    ctx.fillText(label.text, 0, 0);
    ctx.restore();
    placed.push({ x: p.x, y: p.y, w, text: label.text });
  }
  ctx.restore();
}

function drawMinimapOverlay(): void {
  if (!minimapCanvas || !minimapCtx) {
    return;
  }
  const ctx = minimapCtx;
  const size = minimapCanvas.width;
  const dpr = size / MINIMAP_PX;
  const r = size / 2;
  ctx.clearRect(0, 0, size, size);

  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 2 * dpr, 0, Math.PI * 2);
  ctx.clip();

  const y = kart.position.y;
  if (!settings.hideStreetNames) {
    drawStreetLabels(
      ctx,
      (x, z, out) => toMinimapPx(x, y, z, out, size),
      dpr,
      (p, w) => Math.hypot(p.x - r, p.y - r) <= r - w / 2 - 6 * dpr,
    );
  }

  if (autopilotOn && autopilot) {
    const path = autopilot.plannedPath();
    if (path.length > 1) {
      ctx.beginPath();
      path.forEach(([px, pz], i) => {
        const q = toMinimapPx(px, y, pz, projB, size);
        if (i === 0) {
          ctx.moveTo(q.x, q.y);
        } else {
          ctx.lineTo(q.x, q.y);
        }
      });
      ctx.strokeStyle = "rgba(64, 200, 255, 0.95)";
      ctx.lineWidth = 3 * dpr;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }

  // Marcador del kart: el mapa gira amb el kart, així que sempre apunta amunt.
  const k = toMinimapPx(kart.position.x, kart.position.y, kart.position.z, projA, size);
  ctx.translate(k.x, k.y);
  ctx.beginPath();
  ctx.moveTo(0, -9 * dpr);
  ctx.lineTo(6.5 * dpr, 7 * dpr);
  ctx.lineTo(0, 3.5 * dpr);
  ctx.lineTo(-6.5 * dpr, 7 * dpr);
  ctx.closePath();
  ctx.fillStyle = "#f5c518";
  ctx.lineWidth = 2 * dpr;
  ctx.stroke();
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(r, r, r - 2 * dpr, 0, Math.PI * 2);
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.stroke();
  drawCompass(ctx, r, dpr);
}

function drawCompass(ctx: CanvasRenderingContext2D, r: number, dpr: number): void {
  // El nord UTM és -Z al món local; el mapa gira, així que el projectem.
  const size = r * 2;
  const a = toMinimapPx(kart.position.x, kart.position.y, kart.position.z, projA, size);
  const b = toMinimapPx(kart.position.x, kart.position.y, kart.position.z - 10, projB, size);
  const north = Math.atan2(b.y - a.y, b.x - a.x);
  const ring = r - 2 * dpr;

  ctx.save();
  ctx.translate(r, r);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 2 * dpr;
  for (let i = 1; i < 4; i++) {
    const t = north + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(t) * (ring - 7 * dpr), Math.sin(t) * (ring - 7 * dpr));
    ctx.lineTo(Math.cos(t) * ring, Math.sin(t) * ring);
    ctx.stroke();
  }

  const nx = Math.cos(north) * ring;
  const ny = Math.sin(north) * ring;
  ctx.beginPath();
  ctx.arc(nx, ny, 11 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = "#d8322b";
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${12 * dpr}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", nx, ny + 0.5 * dpr);
  ctx.restore();
}

// --- Rètol de carrer: apareix uns segons quan el kart entra en un carrer nou ---

const STREET_SNAP_M = 7;
const STREET_CONFIRM_S = 0.35;
const STREET_BANNER_MS = 2600;
const streetBanner = document.getElementById("street-banner");
let currentStreet: string | null = null;
let candidateStreet: string | null = null;
let candidateTime = 0;
let bannerTimer: number | undefined;

function nearestStreet(x: number, z: number): string | null {
  let best = STREET_SNAP_M;
  let name: string | null = null;
  for (const street of streetLines) {
    const pts = street.points;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      const vx = bx - ax;
      const vz = bz - az;
      const len2 = vx * vx + vz * vz;
      const t = len2 > 0 ? THREE.MathUtils.clamp(((x - ax) * vx + (z - az) * vz) / len2, 0, 1) : 0;
      const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
      if (d < best) {
        best = d;
        name = street.name;
      }
    }
  }
  return name;
}

function showStreetBanner(name: string): void {
  if (!streetBanner || settings.hideStreetNames) {
    return;
  }
  streetBanner.textContent = name;
  streetBanner.classList.add("visible");
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => streetBanner.classList.remove("visible"), STREET_BANNER_MS);
}

function updateCurrentStreet(dt: number): void {
  // Petita histèresi perquè als encreuaments no parpellegi entre dos carrers.
  const name = nearestStreet(kart.position.x, kart.position.z);
  if (name === null || name === currentStreet) {
    candidateStreet = null;
    return;
  }
  if (name !== candidateStreet) {
    candidateStreet = name;
    candidateTime = 0;
  }
  candidateTime += dt;
  if (candidateTime >= STREET_CONFIRM_S) {
    currentStreet = name;
    candidateStreet = null;
    showStreetBanner(name);
  }
}

/** El minimapa s'actualitza a ~20 Hz: a l'ull no es nota i estalvia un render complet de cada tres. */
const MINIMAP_INTERVAL_MS = 50;
let lastMinimapRender = -Infinity;

function renderMinimap(now: number): void {
  if (now - lastMinimapRender >= MINIMAP_INTERVAL_MS) {
    lastMinimapRender = now;
    const fog = scene.fog;
    const background = scene.background;
    scene.fog = null;
    scene.background = MINIMAP_BG;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(minimapTarget);
    renderer.render(scene, minimapCam);
    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = true;
    scene.fog = fog;
    scene.background = background;
    drawMinimapOverlay();
  }
  // El quad del HUD sí que cal cada fotograma: el render principal esborra la pantalla.
  renderer.autoClear = false;
  renderer.render(hudScene, hudCam);
  renderer.autoClear = true;
}

// --- Mapa gran: clic al minimapa (o M) l'obre; clic a prop d'un carrer hi fa respawn ---

type RespawnPick = { x: number; z: number; heading: number; dist: number };

const RESPAWN_MAX_M = 25;
const bigMap = document.getElementById("bigmap");
const bigMapCanvas = document.getElementById("bigmap-canvas") as HTMLCanvasElement | null;
const bigMapCtx = bigMapCanvas?.getContext("2d") ?? null;
const bigMapHint = document.getElementById("bigmap-hint");
const bigMapImage = document.createElement("canvas");
const bigMapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
const roadHighlightMat = new THREE.MeshBasicMaterial({ color: 0xffc93c });
let bigMapOpen = false;
let bigMapPx = 0;
let hoverPx: [number, number] | null = null;
let hoverPick: RespawnPick | null = null;

/** Punt més proper de l'eix d'un carrer, orientat seguint la via (el sentit més semblant a l'actual). */
function nearestRoadPoint(x: number, z: number): RespawnPick | null {
  let best: RespawnPick | null = null;
  for (const line of roadPolylines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1];
      const [bx, bz] = line[i];
      const vx = bx - ax;
      const vz = bz - az;
      const len2 = vx * vx + vz * vz;
      if (len2 < 1e-6) {
        continue;
      }
      const t = THREE.MathUtils.clamp(((x - ax) * vx + (z - az) * vz) / len2, 0, 1);
      const px = ax + vx * t;
      const pz = az + vz * t;
      const dist = Math.hypot(x - px, z - pz);
      if (!best || dist < best.dist) {
        const along = Math.atan2(vx, vz);
        const flip = Math.cos(along - state.heading) < 0;
        best = { x: px, z: pz, heading: flip ? along + Math.PI : along, dist };
      }
    }
  }
  return best;
}

// Finestra visible del mapa gran (món local): centre i mitja amplada. Zoom = menys mitja amplada.
const MAP_MIN_HALF_M = 20;
let mapViewX = 0;
let mapViewZ = 0;
let mapViewHalf = 350;
let mapDrag: { x: number; y: number; viewX: number; viewZ: number; moved: boolean } | null = null;
let suppressMapClick = false;

function clampMapView(): void {
  const maxHalf = terrainSizeM / 2;
  mapViewHalf = THREE.MathUtils.clamp(mapViewHalf, MAP_MIN_HALF_M, maxHalf);
  const limit = maxHalf - mapViewHalf;
  mapViewX = THREE.MathUtils.clamp(mapViewX, -limit, limit);
  mapViewZ = THREE.MathUtils.clamp(mapViewZ, -limit, limit);
}

function mapCssToWorld(px: number, py: number): [number, number] {
  return [
    mapViewX + (px / bigMapPx - 0.5) * 2 * mapViewHalf,
    mapViewZ + (py / bigMapPx - 0.5) * 2 * mapViewHalf,
  ];
}

function worldToMapPx(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const scale = (bigMapCanvas?.width ?? 1) / (2 * mapViewHalf);
  return out.set((x - mapViewX + mapViewHalf) * scale, (z - mapViewZ + mapViewHalf) * scale, 0);
}

function layoutBigMap(): void {
  bigMapPx = Math.max(240, Math.floor(Math.min(window.innerWidth, window.innerHeight - 56) - 48));
  const w = Math.round(bigMapPx * renderer.getPixelRatio());
  bigMapImage.width = w;
  bigMapImage.height = w;
  if (bigMapCanvas) {
    bigMapCanvas.width = w;
    bigMapCanvas.height = w;
    bigMapCanvas.style.width = `${bigMapPx}px`;
    bigMapCanvas.style.height = `${bigMapPx}px`;
  }
}

function captureBigMap(): void {
  // Vista cenital nord amunt de la finestra actual, amb la calçada en groc i el terreny enfosquit.
  // Es torna a renderitzar a cada zoom perquè es vegi nítid, no com una imatge ampliada.
  clampMapView();
  bigMapCam.left = -mapViewHalf;
  bigMapCam.right = mapViewHalf;
  bigMapCam.top = mapViewHalf;
  bigMapCam.bottom = -mapViewHalf;
  bigMapCam.position.set(mapViewX, 300, mapViewZ);
  bigMapCam.up.set(0, 0, -1);
  bigMapCam.lookAt(mapViewX, 0, mapViewZ);
  bigMapCam.updateProjectionMatrix();
  bigMapCam.updateMatrixWorld();

  const savedRoads = roadMeshes.map((m) => [m, (m as THREE.Mesh).material] as const);
  for (const m of roadMeshes) {
    (m as THREE.Mesh).material = roadHighlightMat;
  }
  const terrainColor = terrainMaterial?.color.getHex();
  terrainMaterial?.color.setScalar(0.42);
  const fog = scene.fog;
  const background = scene.background;
  scene.fog = null;
  scene.background = MINIMAP_BG;
  renderer.shadowMap.autoUpdate = false;

  renderer.setViewport(0, 0, bigMapPx, bigMapPx);
  renderer.setScissor(0, 0, bigMapPx, bigMapPx);
  renderer.setScissorTest(true);
  renderer.render(scene, bigMapCam);
  // Copiem el framebuffer a la mateixa tasca, abans que el navegador el presenti i el buidi.
  const w = bigMapImage.width;
  bigMapImage
    .getContext("2d")
    ?.drawImage(renderer.domElement, 0, renderer.domElement.height - w, w, w, 0, 0, w, w);

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.shadowMap.autoUpdate = true;
  scene.fog = fog;
  scene.background = background;
  if (terrainColor !== undefined) {
    terrainMaterial?.color.setHex(terrainColor);
  }
  for (const [m, mat] of savedRoads) {
    (m as THREE.Mesh).material = mat;
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, scale: number, fill: string): void {
  // heading 0 = +Z (sud) = avall al mapa; el fletxa dibuixada apunta amunt (−Y).
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(Math.sin(heading), -Math.cos(heading)));
  ctx.beginPath();
  ctx.moveTo(0, -9 * scale);
  ctx.lineTo(6.5 * scale, 7 * scale);
  ctx.lineTo(0, 3.5 * scale);
  ctx.lineTo(-6.5 * scale, 7 * scale);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = "rgba(20, 20, 24, 0.9)";
  ctx.lineWidth = 2 * scale;
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

function drawScaleBar(ctx: CanvasRenderingContext2D, size: number, dpr: number): void {
  const pxPerM = size / (2 * mapViewHalf);
  const meters = [5, 10, 20, 50, 100, 200].find((m) => m * pxPerM >= 70 * dpr) ?? 200;
  const len = meters * pxPerM;
  const x = 14 * dpr;
  const y = size - 16 * dpr;
  ctx.save();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3 * dpr;
  ctx.shadowColor = "rgba(0,0,0,.8)";
  ctx.shadowBlur = 4 * dpr;
  ctx.beginPath();
  ctx.moveTo(x, y - 6 * dpr);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.lineTo(x + len, y - 6 * dpr);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
  ctx.textBaseline = "bottom";
  ctx.fillText(`${meters} m`, x + 4 * dpr, y - 6 * dpr);
  ctx.restore();
}

function drawBigMap(): void {
  if (!bigMapCanvas || !bigMapCtx) {
    return;
  }
  const ctx = bigMapCtx;
  const size = bigMapCanvas.width;
  const dpr = size / bigMapPx;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bigMapImage, 0, 0);
  drawStreetLabels(ctx, worldToMapPx, dpr, (p, w) => p.x > w / 2 && p.x < size - w / 2 && p.y > 8 && p.y < size - 8, 13);

  const k = worldToMapPx(kart.position.x, kart.position.z, projA);
  drawArrow(ctx, k.x, k.y, state.heading, dpr * 1.2, "#f5c518");
  drawScaleBar(ctx, size, dpr);

  let hint = "Roda: zoom · Arrossega: moure · Clic a prop d'un carrer: reaparèixer · M o Esc: tancar";
  if (hoverPx && hoverPick && !mapDrag?.moved) {
    const [hx, hy] = hoverPx;
    const ok = hoverPick.dist <= RESPAWN_MAX_M;
    const p = worldToMapPx(hoverPick.x, hoverPick.z, projB);
    ctx.save();
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.strokeStyle = ok ? "rgba(120, 255, 160, 0.9)" : "rgba(255, 110, 100, 0.9)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(hx * dpr, hy * dpr);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
    if (ok) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(120, 255, 160, 0.25)";
      ctx.fill();
      drawArrow(ctx, p.x, p.y, hoverPick.heading, dpr, "#78ffa0");
      hint = "Clic per reaparèixer aquí";
    } else {
      hint = "Fora de la zona circulable";
    }
  }
  if (bigMapHint) {
    bigMapHint.textContent = hint;
  }
}

function refreshBigMap(): void {
  captureBigMap();
  if (hoverPx) {
    hoverPick = nearestRoadPoint(...mapCssToWorld(...hoverPx));
  }
  drawBigMap();
}

/** Zoom mantenint fix el punt del món que hi ha sota (px, py) en px CSS del canvas. */
function zoomBigMap(factor: number, px = bigMapPx / 2, py = bigMapPx / 2): void {
  const [wx, wz] = mapCssToWorld(px, py);
  mapViewHalf = THREE.MathUtils.clamp(mapViewHalf * factor, MAP_MIN_HALF_M, terrainSizeM / 2);
  mapViewX = wx - (px / bigMapPx - 0.5) * 2 * mapViewHalf;
  mapViewZ = wz - (py / bigMapPx - 0.5) * 2 * mapViewHalf;
  refreshBigMap();
}

function resetBigMapView(): void {
  mapViewX = 0;
  mapViewZ = 0;
  mapViewHalf = terrainSizeM / 2;
}

function toggleBigMap(open: boolean): void {
  if (!bigMap || !bigMapCanvas || open === bigMapOpen) {
    return;
  }
  bigMapOpen = open;
  keys.clear();
  hoverPx = null;
  hoverPick = null;
  mapDrag = null;
  if (open) {
    resetBigMapView();
    layoutBigMap();
    refreshBigMap();
  }
  bigMap.hidden = !open;
  if (!open) {
    renderer.domElement.focus();
  }
}

function respawnAt(pick: RespawnPick): void {
  state.speed = 0;
  state.steer = 0;
  state.verticalVelocity = 0;
  state.heading = pick.heading;
  kart.rotation.y = pick.heading;
  const y = sampleRoadY(pick.x, pick.z) ?? kart.position.y - state.wheelOffset;
  kart.position.set(pick.x, y + state.wheelOffset, pick.z);
  autopilot?.reset();
  // Càmera directament darrere el cotxe, sense travessar el poble lliscant.
  placeCameraBehindKart();
}

function pointerOnBigMap(e: MouseEvent): [number, number] | null {
  if (!bigMapCanvas) {
    return null;
  }
  const rect = bigMapCanvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

bigMapCanvas?.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const at = pointerOnBigMap(e);
    // El pessic del trackpad arriba com a wheel amb ctrlKey i deltas petits.
    const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    if (at) {
      zoomBigMap(factor, at[0], at[1]);
    }
  },
  { passive: false },
);
bigMapCanvas?.addEventListener("mousedown", (e) => {
  if (e.button !== 0) {
    return;
  }
  const at = pointerOnBigMap(e);
  if (at) {
    mapDrag = { x: at[0], y: at[1], viewX: mapViewX, viewZ: mapViewZ, moved: false };
  }
});
window.addEventListener("mouseup", () => {
  suppressMapClick = !!mapDrag?.moved;
  mapDrag = null;
});
bigMapCanvas?.addEventListener("mousemove", (e) => {
  hoverPx = pointerOnBigMap(e);
  if (mapDrag && hoverPx && (e.buttons & 1) === 1) {
    const dx = hoverPx[0] - mapDrag.x;
    const dy = hoverPx[1] - mapDrag.y;
    if (mapDrag.moved || Math.hypot(dx, dy) > 4) {
      mapDrag.moved = true;
      const mPerPx = (2 * mapViewHalf) / bigMapPx;
      mapViewX = mapDrag.viewX - dx * mPerPx;
      mapViewZ = mapDrag.viewZ - dy * mPerPx;
      captureBigMap();
    }
  }
  hoverPick = hoverPx ? nearestRoadPoint(...mapCssToWorld(...hoverPx)) : null;
  drawBigMap();
});
bigMapCanvas?.addEventListener("mouseleave", () => {
  hoverPx = null;
  hoverPick = null;
  drawBigMap();
});
bigMapCanvas?.addEventListener("click", (e) => {
  if (suppressMapClick) {
    suppressMapClick = false;
    return;
  }
  const at = pointerOnBigMap(e);
  const pick = at ? nearestRoadPoint(...mapCssToWorld(...at)) : null;
  if (pick && pick.dist <= RESPAWN_MAX_M) {
    respawnAt(pick);
    toggleBigMap(false);
  }
});
bigMap?.addEventListener("click", (e) => {
  if (e.target === bigMap) {
    toggleBigMap(false);
  }
});
document.getElementById("bigmap-close")?.addEventListener("click", () => toggleBigMap(false));
document.getElementById("bigmap-zoom-in")?.addEventListener("click", () => zoomBigMap(1 / 1.6));
document.getElementById("bigmap-zoom-out")?.addEventListener("click", () => zoomBigMap(1.6));
document.getElementById("bigmap-zoom-reset")?.addEventListener("click", () => {
  resetBigMapView();
  refreshBigMap();
});
minimapCanvas?.addEventListener("click", () => toggleBigMap(true));

// --- Moviment: lliscar per les vores i desencallar-se sol ---

// Desviacions (radians) provades quan el moviment recte xoca amb la vora o una paret.
const SLIDE_OFFSETS = [0, 0.2, -0.2, 0.45, -0.45, 0.8, -0.8, 1.2, -1.2];
const STUCK_SECONDS = 1.0;
let stuckTime = 0;

function moveAlongRoad(move: number, dt: number): number {
  if (Math.abs(move) < 1e-5) {
    return 0;
  }
  const travelSign = Math.sign(move);
  const pos = kart.position;
  const dir = new THREE.Vector3();
  for (const off of SLIDE_OFFSETS) {
    const h = state.heading + off;
    dir.set(Math.sin(h) * travelSign, 0, Math.cos(h) * travelSign);
    const dist = Math.abs(move) * Math.cos(off);
    if (blockedByWall(pos, dir, WALL_CHECK_M + dist * 1.2)) {
      continue;
    }
    const nx = pos.x + dir.x * dist;
    const nz = pos.z + dir.z * dist;
    if (!canDriveAt(nx, nz, h)) {
      continue;
    }
    pos.x = nx;
    pos.z = nz;
    if (off !== 0) {
      // Alinea el kart amb la vora i frega una mica, en lloc d'aturar-lo en sec.
      state.heading += off * Math.min(1, 6 * dt);
      kart.rotation.y = state.heading;
      state.speed *= Math.exp(-5 * Math.abs(Math.sin(off)) * dt);
    }
    return dist;
  }
  state.speed *= 0.35;
  return 0;
}

function unstick(direction: number): void {
  const pos = kart.position;
  if (!canDriveAt(pos.x, pos.z, state.heading)) {
    const [sx, sz] = snapToDrivableRoad(pos.x, pos.z, state.heading);
    pos.x = sx;
    pos.z = sz;
  }
  // L'orientació lliure més propera a l'actual, en el sentit en què s'accelera.
  const dir = new THREE.Vector3();
  for (let step = 1; step <= 12; step++) {
    for (const sign of [1, -1]) {
      const h = state.heading + sign * step * (Math.PI / 12);
      dir.set(Math.sin(h) * direction, 0, Math.cos(h) * direction);
      if (canDriveAt(pos.x + dir.x * 1.5, pos.z + dir.z * 1.5, h) && !blockedByWall(pos, dir, 2)) {
        state.heading = h;
        kart.rotation.y = h;
        return;
      }
    }
  }
}

function updateStuckWatchdog(throttle: number, moved: number, dt: number): void {
  if (throttle === 0 || moved > 0.002 || state.verticalVelocity !== 0) {
    stuckTime = 0;
    return;
  }
  stuckTime += dt;
  if (stuckTime >= STUCK_SECONDS) {
    stuckTime = 0;
    unstick(Math.sign(throttle));
  }
}

// --- Autopilot: P l'activa; qualsevol tecla de conducció hi torna el control manual ---

let autopilot: Autopilot | null = null;
let autopilotOn = false;
const DRIVE_KEYS = ["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"];

function setAutopilot(on: boolean): void {
  autopilotOn = on && !!autopilot?.ready;
  autopilot?.reset();
  document.getElementById("autopilot-badge")?.toggleAttribute("hidden", !autopilotOn);
}

function readInput(dt: number): { throttle: number; steer: number; brake: boolean } {
  if (autopilotOn && autopilot) {
    return autopilot.update(kart.position.x, kart.position.z, state.heading, state.speed, dt);
  }
  return {
    throttle:
      (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0),
    steer: (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0),
    brake: keys.has(" "),
  };
}

const speedometer = document.getElementById("speedometer");

function updateSpeedometer(): void {
  if (speedometer) {
    const kmh = Math.round(Math.abs(state.speed) * 3.6);
    speedometer.textContent = state.speed < -0.3 ? `R ${kmh} km/h` : `${kmh} km/h`;
  }
}

function placeCameraBehindKart(): void {
  const { x, y, z } = kart.position;
  camera.position.set(
    x - Math.sin(state.heading) * CAM_BACK_M,
    y + CAM_UP_M,
    z - Math.cos(state.heading) * CAM_BACK_M,
  );
  camera.lookAt(x, y + CAM_LOOK_UP_M, z);
}

function update(dt: number): void {
  const { throttle, steer, brake } = readInput(dt);

  // Física d'un R12 a escala real (vegeu vehicle.ts). Aturat no gira: cal maniobrar.
  state.speed = stepSpeed(state.speed, throttle, brake, dt);
  state.steer = stepSteer(state.steer, steer, dt);
  state.heading -= yawRate(state.speed, state.steer) * dt;
  kart.rotation.y = state.heading;
  updateSpeedometer();

  const moved = moveAlongRoad(state.speed * dt, dt);
  updateStuckWatchdog(throttle, moved, dt);
  animateWheels(Math.sign(state.speed) * moved);
  const forward = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));

  const floorY = roadFloorY(kart.position.x, kart.position.z);
  const airborne = state.verticalVelocity !== 0 || (floorY !== null && kart.position.y > floorY + 0.08);

  if (airborne) {
    state.verticalVelocity -= GRAVITY * dt;
    kart.position.y += state.verticalVelocity * dt;
    const landY = floorY ?? kart.position.y;
    if (floorY !== null && kart.position.y <= landY && state.verticalVelocity <= 0) {
      kart.position.y = landY;
      state.verticalVelocity = 0;
    }
  } else if (floorY !== null) {
    kart.position.y = floorY;
  }

  if (kart.position.y < -20) {
    applySpawn();
  }

  const camTarget = kart.position.clone().add(new THREE.Vector3(0, CAM_LOOK_UP_M, 0));
  const camPos = kart.position
    .clone()
    .add(new THREE.Vector3(-forward.x * CAM_BACK_M, CAM_UP_M, -forward.z * CAM_BACK_M));
  camera.position.lerp(camPos, 1 - Math.exp(-4 * dt));
  camera.lookAt(camTarget);
  updateMinimapCamera(dt, forward);
  updateCurrentStreet(dt);
  followSun();
}

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  layoutMinimap();
  if (bigMapOpen) {
    layoutBigMap();
    refreshBigMap();
  }
}

window.addEventListener("resize", onResize);
const optionsModal = document.getElementById("options");
const optHideStreetNames = document.getElementById("opt-hide-street-names") as HTMLInputElement | null;
let optionsOpen = false;

function toggleOptions(open: boolean): void {
  if (!optionsModal || open === optionsOpen) {
    return;
  }
  optionsOpen = open;
  keys.clear();
  optionsModal.hidden = !open;
  if (open) {
    if (optHideStreetNames) {
      optHideStreetNames.checked = settings.hideStreetNames;
    }
    optHideStreetNames?.focus();
  } else {
    renderer.domElement.focus();
  }
}

optHideStreetNames?.addEventListener("change", () => {
  settings.hideStreetNames = optHideStreetNames.checked;
  saveSettings();
  if (settings.hideStreetNames) {
    window.clearTimeout(bannerTimer);
    streetBanner?.classList.remove("visible");
  }
  lastMinimapRender = -Infinity; // redibuixa el minimapa amb o sense noms de seguida
});
optionsModal?.addEventListener("click", (e) => {
  if (e.target === optionsModal) {
    toggleOptions(false);
  }
});
document.getElementById("options-close")?.addEventListener("click", () => toggleOptions(false));

function trackKey(e: KeyboardEvent, down: boolean): void {
  const fromKey = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const fromCode =
    e.code === "Space"
      ? " "
      : e.code.startsWith("Key")
        ? e.code.slice(3).toLowerCase()
        : e.code.replace("Arrow", "arrow").toLowerCase();
  if (down && !e.repeat && !bigMapOpen && (fromKey === "o" || fromCode === "o" || (optionsOpen && fromKey === "escape"))) {
    toggleOptions(!optionsOpen);
    e.preventDefault();
    return;
  }
  if (optionsOpen) {
    return;
  }
  if (down && !e.repeat && (fromKey === "m" || fromCode === "m" || (bigMapOpen && fromKey === "escape"))) {
    toggleBigMap(!bigMapOpen);
    e.preventDefault();
    return;
  }
  if (bigMapOpen) {
    if (down && (fromKey === "+" || fromKey === "=")) {
      zoomBigMap(1 / 1.6);
    } else if (down && (fromKey === "-" || fromKey === "_")) {
      zoomBigMap(1.6);
    }
    return;
  }
  for (const k of [fromKey, fromCode]) {
    if (down) {
      keys.add(k);
    } else {
      keys.delete(k);
    }
  }
  if (down && (fromKey === "r" || fromCode === "r")) {
    applySpawn();
  }
  if (down && !e.repeat && (fromKey === "p" || fromCode === "p")) {
    setAutopilot(!autopilotOn);
  } else if (down && autopilotOn && (DRIVE_KEYS.includes(fromKey) || DRIVE_KEYS.includes(fromCode))) {
    setAutopilot(false);
  }
  if (down && (e.code === "ShiftLeft" || e.code === "ShiftRight")) {
    tryHop();
    e.preventDefault();
  }
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(fromKey)) {
    e.preventDefault();
  }
}

window.addEventListener("keydown", (e) => trackKey(e, true));
window.addEventListener("keyup", (e) => trackKey(e, false));

// --- Rendiment: indicador de FPS i resolució adaptativa ---

const perfEl = document.getElementById("perf");
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 2);
const MIN_PIXEL_RATIO = 0.6;
let perfFrames = 0;
let perfElapsed = 0;
let slowSamples = 0;
let fastSamples = 0;

/** Baixa la resolució interna si no arriba a ~50 FPS i la recupera a poc a poc quan sobra marge. */
function adaptResolution(fps: number): void {
  const pr = renderer.getPixelRatio();
  if (fps < 50) {
    slowSamples++;
    fastSamples = 0;
  } else if (fps > 57) {
    fastSamples++;
    slowSamples = 0;
  } else {
    slowSamples = 0;
    fastSamples = 0;
  }
  let next = pr;
  if (slowSamples >= 2 && pr > MIN_PIXEL_RATIO) {
    next = Math.max(MIN_PIXEL_RATIO, pr - 0.15);
    slowSamples = 0;
  } else if (fastSamples >= 6 && pr < MAX_PIXEL_RATIO) {
    next = Math.min(MAX_PIXEL_RATIO, pr + 0.1);
    fastSamples = 0;
  }
  if (next !== pr) {
    renderer.setPixelRatio(next);
    layoutMinimap();
  }
}

function updatePerf(frameMs: number): void {
  perfFrames++;
  perfElapsed += frameMs;
  if (perfElapsed < 500) {
    return;
  }
  const fps = (perfFrames * 1000) / perfElapsed;
  const ms = perfElapsed / perfFrames;
  perfFrames = 0;
  perfElapsed = 0;
  if (ms > 200) {
    return; // pestanya en segon pla: la mostra no és representativa
  }
  adaptResolution(fps);
  if (perfEl) {
    const info = renderer.info.render;
    perfEl.textContent =
      `${Math.round(fps)} FPS · ${ms.toFixed(1)} ms · ${renderer.getPixelRatio().toFixed(2)}× · ` +
      `${info.calls} draws · ${Math.round(info.triangles / 1000)}k tri`;
    perfEl.classList.toggle("slow", fps < 45);
  }
}

let last = performance.now();
function loop(now: number): void {
  const frameMs = now - last;
  const dt = Math.min(0.05, frameMs / 1000);
  last = now;
  renderer.info.reset();
  // Amb el mapa gran obert el joc està en pausa i tapat: no cal dibuixar res al darrere.
  // Amb les opcions obertes està en pausa però es veu al fons.
  if (!bigMapOpen) {
    if (!optionsOpen) {
      update(dt);
    }
    cullByDistance(now);
    renderer.render(scene, camera);
    renderMinimap(now);
  }
  updatePerf(frameMs);
  requestAnimationFrame(loop);
}

async function boot(): Promise<void> {
  try {
    // Aquí i no a dalt: les constants del model (R12_*) es defineixen més avall del mòdul.
    buildKartVisual(kart);
    await loadSpawn();
    await loadWorldMeta();
    await loadWorld();
    await loadTrees();
    await loadVillage();
    await loadStreets();
    layoutMinimap();
    applySpawn();
    document.getElementById("loading")?.remove();
    const hud = document.getElementById("hud");
    if (hud) {
      hud.hidden = false;
    }
    document.getElementById("credit")?.removeAttribute("hidden");
    minimapCanvas?.removeAttribute("hidden");
    renderer.domElement.focus();
    requestAnimationFrame(loop);
  } catch (err) {
    const el = document.getElementById("loading");
    if (el) {
      el.textContent =
        "No s'ha pogut carregar el món. Executa: python tools/mapgen/build_world.py --all";
    }
    console.error(err);
  }
}

boot();
