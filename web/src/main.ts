import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { addWorldDetail } from "./detail";
import {
  asphaltMaps,
  barkMap,
  dirtDetail,
  foliageMap,
  groundDetail,
  plantSpriteMap,
  plasterDetail,
  plateMap,
  roofTileDetail,
  stoneDetail,
  brickDetail,
  tyreMap,
  tyreSidewallMap,
  windowGlassMap,
} from "./textures";
import { Autopilot } from "./autopilot";
import { AirParticles } from "./airParticles";
import { CraneFlocks } from "./birds";
import { Sky, SUN_VISUAL_ELEVATION_DEG, sunDirection } from "./sky";
import { R12, stepSpeed, stepSteer, turnRadius, yawRate } from "./vehicle";
import { applyWaterMaterial, setWaterEnvironment, waterTime } from "./water";
import { buildHouseCenters, houseCenterToClient, houseIdFromHit, resolveHouseRef } from "./housePick";
import { MotionBlur } from "./motionBlur";

type SpawnData = {
  position: { x: number; y: number; z: number };
  rotation_y_deg: number;
};

// Raycast accelerat amb BVH: la calçada i les parets es consulten desenes de cops per fotograma.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
// El BVH del terreny i de la calçada (centenars de trossos) es construeix la primera vegada que un
// raig hi passa, no en carregar: només calen els trossos per on circula el cotxe.
// L'esfera envolupant es comprova abans de tot (acceleratedRaycast no ho fa: inverteix la matriu i
// baixa pel BVH de cada malla), així un raig descarta de seguida els centenars de trossos que no toca.
// Les malles estàtiques (matrixAutoUpdate = false) desen l'esfera en coordenades del món.
const raycastSphere = new THREE.Sphere();

/**
 * El BVH reordena l'índex de la geometria in situ. El GLTFLoader fa compartir el mateix índex a
 * les malles amb la mateixa topologia (els 256 trossos de terreny, per exemple): sense una còpia
 * pròpia, construir el BVH d'un tros desquadra el dels altres i el raig travessa el terra.
 */
function computeOwnBoundsTree(geometry: THREE.BufferGeometry): void {
  if (geometry.index) {
    geometry.setIndex(geometry.index.clone());
  }
  geometry.computeBoundsTree();
}

THREE.Mesh.prototype.raycast = function (this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
  let sphere = this.userData.worldSphere as THREE.Sphere | undefined;
  if (!sphere) {
    if (!this.geometry.boundingSphere) {
      this.geometry.computeBoundingSphere();
    }
    sphere = raycastSphere.copy(this.geometry.boundingSphere!).applyMatrix4(this.matrixWorld);
    if (!this.matrixAutoUpdate) {
      this.userData.worldSphere = sphere.clone();
    }
  }
  if (!raycaster.ray.intersectsSphere(sphere)) {
    return;
  }
  if (this.userData.lazyBvh && !this.geometry.boundsTree) {
    computeOwnBoundsTree(this.geometry);
  }
  acceleratedRaycast.call(this, raycaster, intersects);
};

type SurfaceKind = "road" | "building" | "roof" | "prop" | "terrain" | "green" | "water" | "water_volume";

/** Capa dels detalls petits (façanes, plantes): els veu la càmera principal però no el minimapa,
 * el mapa gran ni el mapa d'ombres. */
const DETAIL_LAYER = 1;

// Temps de càrrega per fase (consola: "[càrrega]"), per saber on cal optimitzar.
const LOAD_T0 = performance.now();
let loadLast = LOAD_T0;
const loadTimings: Record<string, number> = {};
function markLoad(phase: string): void {
  const now = performance.now();
  loadTimings[phase] = Math.round(now - loadLast);
  loadLast = now;
}
(window as unknown as { __loadTimings: Record<string, number> }).__loadTimings = loadTimings;

const keys = new Set<string>();

// --- Opcions (tecla O): es desen al navegador ---

type Settings = { hideStreetNames: boolean; motionBlur: boolean; airParticles: boolean };
const SETTINGS_KEY = "abraveses-racing.settings";

function loadSettings(): Settings {
  const defaults: Settings = { hideStreetNames: false, motionBlur: true, airParticles: true };
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
// Color de reserva: la cúpula del cel tapa el fons i la boira pren el color del cel (vegeu sky.ts).
const SKY = 0xc8dae8;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 140, 560);
// El sol que es veu al cel és més baix que la llum: així surt dins del pla de la càmera de
// persecució sense que les ombres s'allarguin tant que enfosqueixin els carrers.
const SUN_AZIMUTH = { x: 80, z: 40 };
const sky = new Sky(sunDirection(SUN_AZIMUTH.x, SUN_AZIMUTH.z, SUN_VISUAL_ELEVATION_DEG), DETAIL_LAYER);
scene.add(sky.dome);
const craneFlocks = new CraneFlocks(scene);

// La boira tapa del tot a 560 m: més enllà no cal dibuixar res.
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.2, 600);
camera.layers.enable(DETAIL_LAYER);
const airParticles = new AirParticles(
  scene,
  camera,
  sunDirection(SUN_AZIMUTH.x, SUN_AZIMUTH.z, SUN_VISUAL_ELEVATION_DEG),
  DETAIL_LAYER,
);
airParticles.setEnabled(settings.airParticles);
const renderer = new THREE.WebGLRenderer({
  // Sense MSAA: a 1,5× ja hi ha prou píxels, i així es pot copiar el canvas a mitja
  // resolució pel desenfoc (un blit des d'un framebuffer multisample no pot escalar).
  antialias: false,
  powerPreference: "high-performance",
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.info.autoReset = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.domElement.tabIndex = 0;
renderer.domElement.style.outline = "none";
document.body.appendChild(renderer.domElement);
const motionBlur = new MotionBlur();
renderer.domElement.addEventListener("pointerdown", () => {
  renderer.domElement.focus();
});

// Menys ambient pla: deixa que l'hemisferi doni color diferent segons la normal (cel vs terra) a l'ombra.
scene.add(new THREE.AmbientLight(0xe8eef2, 0.34));
scene.add(new THREE.HemisphereLight(0x88b8e8, 0x6a9468, 0.5));
// El mapa d'ombres segueix el cotxe, desplaçat cap on mira la càmera (vegeu followSun).
// La caixa fa els mateixos 100 m que abans (2048 px, ~5 cm per texel): eixamplar-la
// omplia el mapa amb les choperes i es menjava els FPS. En canvi, posar-la més endavant
// fa que els arbres que es veuen davant hi entrin sense dibuixar-ne més.
const SUN_OFFSET = sunDirection(SUN_AZIMUTH.x, SUN_AZIMUTH.z, 34).multiplyScalar(160);
const SHADOW_HALF_M = 50;
const SHADOW_AHEAD_M = 30;
const SUN_INTENSITY = 1.32;
const sun = new THREE.DirectionalLight(0xfff0dc, SUN_INTENSITY);
sun.position.copy(SUN_OFFSET);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 400;
sun.shadow.camera.left = -SHADOW_HALF_M;
sun.shadow.camera.right = SHADOW_HALF_M;
sun.shadow.camera.top = SHADOW_HALF_M;
sun.shadow.camera.bottom = -SHADOW_HALF_M;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 2.8;
scene.add(sun);
scene.add(sun.target);

// L'escena i el món no es mouen: amb matrixAutoUpdate, three.js forçaria a recalcular la matriu de
// cada objecte estàtic a cada render (principal i minimapa), encara que estiguin congelats.
scene.matrixAutoUpdate = false;
const worldRoot = new THREE.Group();
worldRoot.matrixAutoUpdate = false;
scene.add(worldRoot);

const kart = new THREE.Group();
kart.rotation.order = "YXZ"; // rumb, després capcineig i balanceig segons el terreny
scene.add(kart);
// Rodes animades: `spin` giren amb la distància recorreguda, `steer` són les davanteres.
const kartWheels = { spin: [] as THREE.Object3D[], steer: [] as THREE.Object3D[] };
/** Pilots del darrere: s'il·luminen en frenar. */
let taillightMat: THREE.MeshStandardMaterial | null = null;
let brakeLightsOn = false;
const TAIL_IDLE = 0.08;
/** Enceses: es distingeixen de l'apagat, sense enlluernar. */
const TAIL_BRAKE = 0.38;

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
  /** Inclinació de la carrosseria segons el terreny (rad). */
  pitch: 0,
  /** Capcineig extra per acceleració/frenada (rad), sumat a `pitch`. */
  accelPitch: 0,
  roll: 0,
  verticalVelocity: 0,
  /**
   * Derrapatge (rad): la marxa va cap a `heading + driftAngle`, el morro cap a `heading`.
   * Positiu quan la cua surt girant a la dreta.
   */
  driftAngle: 0,
};

const GRAVITY = 38;
const HOP_VELOCITY = 10.5;

// Mostres de "és a la calçada": una mica dins la carrosseria (4,35 × 1,64 m) perquè
// els voladissos puguin sobresortir com als carrers estrets reals.
const KART_HALF_W = 0.7;
const KART_HALF_L = 1.6;
const WALL_CHECK_M = 2.3;

/**
 * Tres càmeres de persecució. La del mig és la de sempre; Z les alterna
 * (normal → oberta → curses). `back`/`up` són metres darrere i per sobre del cotxe.
 */
type CameraPreset = {
  back: number;
  up: number;
  /** Punt de mirada, metres sobre el terra del cotxe. */
  lookUp: number;
  /** Mirada avançada al llarg de la marxa (m): les de curses miren la carretera. */
  lookAhead: number;
  /** Camp de visió vertical (graus). */
  fov: number;
};
const CAM_PRESETS: CameraPreset[] = [
  // Curses: més a prop i més baixa que la normal, amb el cotxe sencer i la carretera al davant.
  { back: 6.8, up: 2.35, lookUp: 1.15, lookAhead: 12, fov: 62 },
  // La de sempre.
  { back: 10.5, up: 4.2, lookUp: 1.4, lookAhead: 0, fov: 60 },
  // Oberta: alta, enrere i inclinada, amb prou camp perquè hi entri l'horitzó.
  { back: 18, up: 11, lookUp: 2.2, lookAhead: 6, fov: 78 },
];
/** Es comença per la del mig. */
let camPresetIndex = 1;

function camPreset(): CameraPreset {
  return CAM_PRESETS[camPresetIndex];
}

function camPresetDist(preset: CameraPreset = camPreset()): number {
  return Math.hypot(preset.back, preset.up);
}

function camPresetPitch(preset: CameraPreset = camPreset()): number {
  return Math.atan2(preset.up, preset.back);
}

/** Textures de detall procedurals, generades un sol cop (vegeu textures.ts). */
const asphalt = asphaltMaps();
const detailTextures = {
  ground: groundDetail(),
  asphalt: asphalt.albedo,
  asphaltSurface: asphalt.surface,
  dirt: dirtDetail(),
  plaster: plasterDetail(),
  stone: stoneDetail(),
  brick: brickDetail(),
  roofTiles: roofTileDetail(),
};
// Les teulades i l'asfalt es veuen de biaix: amb poca anisotropia el mipmap els esborra el gra.
const detailAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
for (const tex of [detailTextures.roofTiles, detailTextures.asphalt, detailTextures.asphaltSurface]) {
  tex.anisotropy = detailAniso;
  tex.needsUpdate = true;
}

const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const down = new THREE.Vector3(0, -1, 0);
const rayOrigin = new THREE.Vector3();
const rayDir = new THREE.Vector3();
// Només la calçada: el terreny dens faria el raycast massa car i no és conduïble.
const roadMeshes: THREE.Object3D[] = [];
/** Làmina d'aigua: el cotxe circula pel llit, per sota. */
const waterMeshes: THREE.Object3D[] = [];
/** Terra on es pot circular: calçada i terreny. Les col·lisions són només contra models 3D. */
const groundMeshes: THREE.Object3D[] = [];
const wallMeshes: THREE.Object3D[] = [];
/** Parets de casa (sense pals): per saber si la càmera és a dins d'una. */
const houseShellMeshes: THREE.Mesh[] = [];

/** Graella (x, z) de les malles de terra: un raig vertical només prova els trossos que té a sota
 *  (2–6) en lloc dels ~400 de calçada i terreny. Es fan uns 17 raigs així per fotograma. */
const GROUND_CELL_M = 32;
const groundCells = new Map<number, { ground: THREE.Object3D[]; road: THREE.Object3D[] }>();
const NO_MESHES: { ground: THREE.Object3D[]; road: THREE.Object3D[] } = { ground: [], road: [] };

function groundCellKey(ix: number, iz: number): number {
  return (ix + 32768) * 65536 + (iz + 32768);
}

function indexGroundMeshes(): void {
  const box = new THREE.Box3();
  const roads = new Set(roadMeshes);
  for (const mesh of groundMeshes) {
    box.setFromObject(mesh);
    for (let ix = Math.floor(box.min.x / GROUND_CELL_M); ix <= Math.floor(box.max.x / GROUND_CELL_M); ix++) {
      for (let iz = Math.floor(box.min.z / GROUND_CELL_M); iz <= Math.floor(box.max.z / GROUND_CELL_M); iz++) {
        const key = groundCellKey(ix, iz);
        let cell = groundCells.get(key);
        if (!cell) {
          cell = { ground: [], road: [] };
          groundCells.set(key, cell);
        }
        cell.ground.push(mesh);
        if (roads.has(mesh)) {
          cell.road.push(mesh);
        }
      }
    }
  }
}

function groundCellAt(x: number, z: number): { ground: THREE.Object3D[]; road: THREE.Object3D[] } {
  return groundCells.get(groundCellKey(Math.floor(x / GROUND_CELL_M), Math.floor(z / GROUND_CELL_M))) ?? NO_MESHES;
}

const textureLoader = new THREE.TextureLoader();
let terrainSizeM = 700;
/** Costat (m) de la zona central amb ortofoto d'alta resolució; 0 = només la textura general. */
let orthoCenterM = 0;
let terrainMaterial: THREE.MeshStandardMaterial | null = null;
let roofMaterial: THREE.MeshStandardMaterial | null = null;
let assetCacheKey = "1";

// Descàrregues en paral·lel: en saber la clau de memòria cau (world_meta) es demanen tots els
// fitxers alhora, i cada carregador reaprofita la seva petició en lloc de començar-la tard.
const prefetchCache = new Map<string, Promise<Response>>();
function fetchOnce(url: string): Promise<Response> {
  let p = prefetchCache.get(url);
  if (!p) {
    p = fetch(url);
    prefetchCache.set(url, p);
  }
  return p.then((r) => r.clone());
}

function prefetchAssets(): void {
  for (const name of ["world.glb", "village.json", "trees.json", "streets.json", "house_cards.json"]) {
    void fetchOnce(`/${name}?${assetCacheKey}`);
  }
}

function setLoading(text: string): void {
  const el = document.getElementById("loading");
  if (el) {
    el.textContent = text;
  }
}

/** Deixa pintar el text de càrrega abans d'una fase llarga. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadSpawn(): Promise<void> {
  const res = await fetch("/spawn.json");
  if (res.ok) {
    spawn = (await res.json()) as SpawnData;
  }
}

type WorldMeta = {
  size_m: number;
  elevation_min_m: number;
  resolution: number;
  ortho_center_m?: number;
  ortho_center_offset_m?: [number, number];
  origin_utm_x?: number;
  origin_utm_y?: number;
  utm_epsg?: number;
};

let worldOriginUtm: { x: number; y: number; epsg: number } | null = null;

async function loadWorldMeta(): Promise<void> {
  const res = await fetch("/world_meta.json");
  if (!res.ok) {
    return;
  }
  const meta = (await res.json()) as WorldMeta;
  terrainSizeM = meta.size_m;
  orthoCenterM = meta.ortho_center_m ?? 0;
  const centerOff = meta.ortho_center_offset_m;
  if (centerOff && centerOff.length === 2) {
    orthoUniforms.uCenterAt.value.set(centerOff[0], centerOff[1]);
  }
  assetCacheKey = `${meta.size_m}-${meta.resolution}-${meta.elevation_min_m}`;
  if (meta.origin_utm_x != null && meta.origin_utm_y != null) {
    worldOriginUtm = { x: meta.origin_utm_x, y: meta.origin_utm_y, epsg: meta.utm_epsg ?? 25830 };
  }
}

// Ortofoto en dos nivells: tot el terreny a baixa resolució i un retall de 700 m (el poble) a ~17 cm/px.
// El retall pot anar desplaçat del centre del quadrat (uCenterAt, metres locals est/nord).
// El shader tria la textura per posició del món i les fon en una franja de 20 m a la vora, així no
// cal partir les malles per zones ni coordenades UV (la projecció és planar i surt de la posició).
const orthoUniforms = {
  uCenterMap: { value: null as THREE.Texture | null },
  uHalfFull: { value: 350 },
  uHalfCenter: { value: 175 },
  uCenterAt: { value: new THREE.Vector2(0, 0) },
  uHasCenter: { value: 0 },
};

function injectOrthoShader(shader: THREE.WebGLProgramParametersWithUniforms, banks?: boolean): void {
  // El segon argument només és el talús si el passem nosaltres: three crida onBeforeCompile
  // amb el renderer, que també és truthy.
  const withBanks = banks === true;
  Object.assign(shader.uniforms, orthoUniforms);
  if (withBanks) {
    shader.vertexShader =
      "attribute vec3 tone;\nattribute float bank;\nvarying vec3 vTone;\nvarying float vBank;\n" + shader.vertexShader;
    shader.fragmentShader = "varying vec3 vTone;\nvarying float vBank;\n" + shader.fragmentShader;
  }
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vAbrWorld;")
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
vAbrWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
${withBanks ? "vTone = tone;\nvBank = bank;" : ""}`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
varying vec3 vAbrWorld;
uniform sampler2D uCenterMap;
uniform float uHalfFull;
uniform float uHalfCenter;
uniform vec2 uCenterAt;
uniform float uHasCenter;`,
    )
    .replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
  vec2 abrUvFull = vec2(vAbrWorld.x, -vAbrWorld.z) / (2.0 * uHalfFull) + 0.5;
  vec4 abrTexel = texture2D(map, abrUvFull);
  if (uHasCenter > 0.5) {
    vec2 abrUvC = (vec2(vAbrWorld.x, -vAbrWorld.z) - uCenterAt) / (2.0 * uHalfCenter) + 0.5;
    // Mostreig sempre (fora del branch) perquè les derivades del mipmap siguin correctes.
    vec4 abrCenter = texture2D(uCenterMap, clamp(abrUvC, 0.0, 1.0));
    vec2 abrEdge = min(abrUvC, 1.0 - abrUvC) * 2.0 * uHalfCenter;
    abrTexel = mix(abrTexel, abrCenter, clamp(min(abrEdge.x, abrEdge.y) / 20.0, 0.0, 1.0));
  }
  ${
    withBanks
      ? `// Al peu del carrer asfaltat (bank = 1) la foto estira murs i voreres: es deixa el to
  // de terra. Cap al camp (bank → 0) es fon amb la foto. El factor és per vèrtex, així la
  // frontera entre dues cares no fa un tall.
  diffuseColor.rgb *= mix(abrTexel.rgb, vTone, clamp(vBank, 0.0, 1.0));
  diffuseColor.a *= abrTexel.a;`
      : "diffuseColor *= abrTexel;"
  }
#endif`,
    );
}

/** Ortofotos pendents: la pantalla de càrrega les espera perquè no aparegui el terreny sense foto. */
const orthoLoads: Promise<void>[] = [];

function loadOrthoTexture(url: string, onLoad: (tex: THREE.Texture) => void, onError?: () => void): void {
  orthoLoads.push(
    new Promise((resolve) => {
      textureLoader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          // Pujada a la GPU (4096² amb mipmaps, ~0,25 s) ara, i no el primer fotograma que es dibuixa.
          renderer.initTexture(tex);
          onLoad(tex);
          resolve();
        },
        undefined,
        () => {
          onError?.();
          resolve();
        },
      );
    }),
  );
}

/** Terreny amb ortofoto projectada; teulades amb color de vèrtex (mostra de la foto) i detall de teula. */
function sharedTerrainMaterials(): { ground: THREE.MeshStandardMaterial; roof: THREE.MeshStandardMaterial } {
  if (!terrainMaterial || !roofMaterial) {
    const ground = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    ground.onBeforeCompile = (shader) => injectOrthoShader(shader, true);
    const roof = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    // L'ortofoto (17–44 cm/px) es veu borrosa de prop: gra de terra a escala real; les teules no
    // porten la foto projectada, només el to mitjà de l'ortofoto al color de vèrtex.
    addWorldDetail(ground, { map: detailTextures.ground, mode: "top", scaleM: 3, strength: 0.85, secondScale: 0.11, fade: [45, 170] });
    addWorldDetail(roof, { map: detailTextures.roofTiles, mode: "ridge", scaleM: 1.6, strength: 0.9, fade: [35, 140] });
    installHouseHide(roof);
    terrainMaterial = ground;
    roofMaterial = roof;
    orthoUniforms.uHalfFull.value = terrainSizeM / 2;
    orthoUniforms.uHalfCenter.value = orthoCenterM / 2;
    loadOrthoTexture(
      `/terrain.jpg?${assetCacheKey}`,
      (tex) => {
        ground.map = tex;
        ground.needsUpdate = true;
        worldMaterials.roadDirt.map = tex;
        worldMaterials.roadDirt.needsUpdate = true;
      },
      () => {
        ground.color.setHex(0x8fbf75);
        worldMaterials.roadDirt.color.setHex(0xb09c80);
      },
    );
    if (orthoCenterM > 0 && orthoCenterM < terrainSizeM) {
      loadOrthoTexture(`/terrain_center.jpg?${assetCacheKey}`, (tex) => {
        orthoUniforms.uCenterMap.value = tex;
        orthoUniforms.uHasCenter.value = 1;
      });
    }
  }
  return { ground: terrainMaterial, roof: roofMaterial };
}

function applyTerrainMaterial(mesh: THREE.Mesh, kind: "terrain" | "roof"): void {
  const mats = sharedTerrainMaterials();
  mesh.material = kind === "roof" ? mats.roof : mats.ground;
}

// --- Renault 12 low-poly a mida real (4,35 × 1,64 m), +Z endavant, rodes tocant y = 0 ---

const R12_PAINT = 0x74264f; // granat tirant a lila
const R12_WHEEL_R = 0.3;
const R12_FRONT_AXLE_Z = 1.32;
const R12_REAR_AXLE_Z = R12_FRONT_AXLE_Z - R12.wheelbaseM;

/** Perfil lateral dibuixat en (z, y) i extrudit a l'amplada (eix X), centrat. El bisell arrodoneix
 *  els cantells sense engrandir el perfil (bevelOffset), perquè els passos de roda no toquin les rodes. */
function extrudeSide(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 5,
    curveSegments: 12,
  });
  geo.rotateY(-Math.PI / 2); // forma x → món z; extrusió → món −x
  geo.translate((width - 2 * bevel) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Materials del cotxe (i finestres) que reben reflexos d'entorn, amb la intensitat que els toca. */
const carEnvMaterials: { mat: THREE.MeshStandardMaterial; intensity: number }[] = [];

function applyCarEnvironment(): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  for (const { mat, intensity } of carEnvMaterials) {
    mat.envMap = env;
    mat.envMapIntensity = intensity;
    mat.needsUpdate = true;
  }
  setWaterEnvironment(env);
}

/** Materials que poden descartar la casa que envolta la càmera. Cal declarar-los abans de
 *  `createWindowGlassMaterial`, que ja crida `installHouseHide` en construir el món. */
const houseHideMaterials: THREE.Material[] = [];
let houseHideCompiled = false;

function createWindowGlassMaterial(sunDir: THREE.Vector3): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: windowGlassMap(),
    color: 0x4a5c68,
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.08,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWinSun = { value: sunDir.clone() };
    shader.uniforms.uWinSky = { value: new THREE.Color(0xc8dff0) };
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\nvarying vec3 vWinWorld;",
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\nvWinWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nvarying vec3 vWinWorld;\nuniform vec3 uWinSun;\nuniform vec3 uWinSky;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
  vec3 viewDir = normalize(vViewPosition);
  float fresnel = pow(1.0 - clamp(dot(normalize(normal), viewDir), 0.0, 1.0), 5.0);
  vec3 refl = reflect(-viewDir, normalize(normal));
  float sunHit = pow(max(dot(refl, normalize(uWinSun)), 0.0), 96.0);
  float skyBand = smoothstep(0.05, 0.4, refl.y);
  totalEmissiveRadiance += uWinSky * fresnel * (0.06 + 0.1 * skyBand);
  totalEmissiveRadiance += vec3(1.0, 0.96, 0.88) * sunHit * 0.14;`,
    );
  };
  carEnvMaterials.push({ mat, intensity: 0.32 });
  installHouseHide(mat);
  return mat;
}

function addPart(
  root: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material | THREE.Material[],
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

/** Sostre del Renault 12. No és una llosa: puja uns 4,5 cm al centre (al llarg i, una mica menys,
 *  d'ample) i baixa cap al parabrisa i el vidre posterior. El vidre de la cabina segueix la mateixa
 *  corba longitudinal. */
function r12RoofGeometry(): THREE.BufferGeometry {
  const xSeg = 14;
  const zSeg = 18;
  const halfW = 0.72;
  const zFront = 0.16;
  const zRear = -0.98;
  const yRim = 1.36;
  const rise = 0.045;
  const crown = 0.022;
  const thick = 0.04;
  const nx = xSeg + 1;
  const nz = zSeg + 1;
  const yTop = (u: number, v: number) =>
    yRim + Math.sin(v * Math.PI) * rise + Math.sin(u * Math.PI) * crown;
  const yBot = (u: number, v: number) => yRim + Math.sin(v * Math.PI) * rise - thick;

  const positions: number[] = [];
  const uvs: number[] = [];
  const pushGrid = (yOf: (u: number, v: number) => number) => {
    for (let iz = 0; iz < nz; iz++) {
      const v = iz / zSeg;
      const z = zFront + (zRear - zFront) * v;
      for (let ix = 0; ix < nx; ix++) {
        const u = ix / xSeg;
        positions.push(-halfW + 2 * halfW * u, yOf(u, v), z);
        uvs.push(u, v);
      }
    }
  };
  pushGrid(yTop);
  pushGrid(yBot);
  const topCount = nx * nz;

  const indices: number[] = [];
  const outward = (ia: number, ib: number, ic: number, dir: [number, number, number]) => {
    const ax = positions[ia * 3] ?? 0;
    const ay = positions[ia * 3 + 1] ?? 0;
    const az = positions[ia * 3 + 2] ?? 0;
    const bx = positions[ib * 3] ?? 0;
    const by = positions[ib * 3 + 1] ?? 0;
    const bz = positions[ib * 3 + 2] ?? 0;
    const cx = positions[ic * 3] ?? 0;
    const cy = positions[ic * 3 + 1] ?? 0;
    const cz = positions[ic * 3 + 2] ?? 0;
    const nxv = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const nyv = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nzv = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (nxv * dir[0] + nyv * dir[1] + nzv * dir[2] >= 0) {
      indices.push(ia, ib, ic);
    } else {
      indices.push(ia, ic, ib);
    }
  };
  const quad = (a: number, b: number, c: number, d: number, dir: [number, number, number]) => {
    outward(a, b, c, dir);
    outward(a, c, d, dir);
  };
  for (let iz = 0; iz < zSeg; iz++) {
    for (let ix = 0; ix < xSeg; ix++) {
      const a = iz * nx + ix;
      const b = a + 1;
      const d = a + nx;
      const c = d + 1;
      quad(a, b, c, d, [0, 1, 0]);
      quad(a + topCount, b + topCount, c + topCount, d + topCount, [0, -1, 0]);
    }
  }
  for (let ix = 0; ix < xSeg; ix++) {
    const a = ix;
    const b = ix + 1;
    quad(a, b, b + topCount, a + topCount, [0, 0, 1]);
    const rear = zSeg * nx + ix;
    quad(rear, rear + 1, rear + 1 + topCount, rear + topCount, [0, 0, -1]);
  }
  for (let iz = 0; iz < zSeg; iz++) {
    const left = iz * nx;
    quad(left, left + nx, left + nx + topCount, left + topCount, [-1, 0, 0]);
    const right = left + xSeg;
    quad(right, right + nx, right + nx + topCount, right + topCount, [1, 0, 0]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Canaló de la vora del sostre: segueix el bombament, una mica per sota del caire. */
function r12DripRail(side: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const steps = 14;
  const zFront = 0.16;
  const zRear = -0.98;
  for (let i = 0; i <= steps; i++) {
    const v = i / steps;
    const z = zFront + (zRear - zFront) * v;
    const y = 1.36 + Math.sin(v * Math.PI) * 0.045 - 0.018;
    pts.push(new THREE.Vector3(side * 0.73, y, z));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.012, 6, false);
}

/** Tapacubos de plàstic gran del Renault 12: anell de ranures radials i el rombe al centre.
 *  Ni les ranures ni el rombe són de revolució, així es veu com gira la roda. */
function r12HubcapParts(): { slots: THREE.BufferGeometry; diamond: THREE.BufferGeometry } {
  const slots: THREE.BufferGeometry[] = [];
  const n = 16;
  const radius = 0.132;
  for (let i = 0; i < n; i++) {
    const g = new THREE.BoxGeometry(0.01, 0.026, 0.042);
    g.translate(0, 0, radius);
    g.rotateX((i / n) * Math.PI * 2);
    slots.push(g);
  }
  // Rombe de franges horitzontals (el logotip a partir del 1972), punta amunt.
  const bars: THREE.BufferGeometry[] = [];
  const stripes = 5;
  const halfH = 0.022;
  for (let i = 0; i < stripes; i++) {
    const y = halfH - ((i + 0.5) / stripes) * 2 * halfH;
    const k = 1 - Math.abs(y) / halfH;
    const g = new THREE.BoxGeometry(0.005, (2 * halfH / stripes) * 0.58, Math.max(0.03 * k, 0.004));
    g.translate(0, y, 0);
    bars.push(g);
  }
  return { slots: mergeGeometries(slots)!, diamond: mergeGeometries(bars)! };
}

function buildKartVisual(root: THREE.Group): void {
  // Reflexos d'entorn només al cotxe: pintura amb vernís, vidres i cromats en necessiten per
  // semblar-ho; al món sencer encariria el render i canviaria la il·luminació de la foto.
  // El mapa d'entorn (PMREM, ~250 ms) es genera després del primer fotograma: vegeu applyCarEnvironment.
  const env = null;
  const paint = new THREE.MeshPhysicalMaterial({
    color: R12_PAINT,
    roughness: 0.35,
    metalness: 0.1,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
    envMap: env,
    // L'entorn és clar (sala blanca): amb més intensitat el granat es tornava rosa.
    envMapIntensity: 0.15,
  });
  // Vidre fumat lleugerament transparent: es veu l'habitacle. No escriu profunditat perquè
  // l'interior (opac, es pinta abans) no quedi tapat, i no fa ombra: el sostre ja la fa.
  const glass = new THREE.MeshStandardMaterial({
    color: 0x1c2a33,
    roughness: 0.04,
    metalness: 0.3,
    envMap: env,
    envMapIntensity: 0.9,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const upholstery = new THREE.MeshStandardMaterial({ color: 0x8a6a4c, roughness: 0.95 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2b2624, roughness: 0.85 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe4e8ec, roughness: 0.16, metalness: 0.95, envMap: env, envMapIntensity: 1 });
  carEnvMaterials.push({ mat: paint, intensity: 0.15 }, { mat: glass, intensity: 0.9 }, { mat: chrome, intensity: 1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.6 });
  const seam = new THREE.MeshStandardMaterial({ color: 0x1a0a12, roughness: 0.8 });
  const tyreTex = tyreMap();
  // Una volta de la textura és mitja volta de roda: els blocs queden de la mida d'un pneumàtic real.
  tyreTex.repeat.set(2, 1);
  const tyreTread = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tyreTex, roughness: 0.92 });
  const tyreWall = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tyreSidewallMap(), roughness: 0.96 });
  const tyre = [tyreTread, tyreWall, tyreWall];
  const headlight = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c0, emissiveIntensity: 0.35 });
  const taillight = new THREE.MeshStandardMaterial({
    color: 0xb3141b,
    emissive: 0xc41c18,
    emissiveIntensity: TAIL_IDLE,
  });
  taillight.name = "taillight";
  taillightMat = taillight;
  const amber = new THREE.MeshStandardMaterial({ color: 0xf29a1d, emissive: 0x4a2600, emissiveIntensity: 0.5 });
  const frontPlate = new THREE.MeshStandardMaterial({ map: plateMap("ZA-4721-C"), roughness: 0.5 });
  const rearPlate = frontPlate;

  // Carrosseria baixa: berlina de tres volums amb passos de roda.
  const arch = R12_WHEEL_R + 0.07;
  // Cantonades arrodonides: morro, capó bombat i maleter amb corbes en lloc d'arestes.
  const body = new THREE.Shape();
  body.moveTo(-2.06, 0.3);
  body.lineTo(R12_REAR_AXLE_Z - arch, 0.3);
  body.absarc(R12_REAR_AXLE_Z, R12_WHEEL_R, arch, Math.PI, 0, true);
  body.lineTo(R12_FRONT_AXLE_Z - arch, 0.3);
  body.absarc(R12_FRONT_AXLE_Z, R12_WHEEL_R, arch, Math.PI, 0, true);
  body.lineTo(2.06, 0.3);
  body.quadraticCurveTo(2.17, 0.3, 2.17, 0.42);
  body.lineTo(2.17, 0.62); // frontal
  body.quadraticCurveTo(2.17, 0.76, 2.0, 0.78); // vora del capó
  body.quadraticCurveTo(1.4, 0.845, 0.78, 0.86); // capó fins a la base del parabrisa
  body.lineTo(-1.5, 0.88); // línia de cintura fins al vidre posterior
  body.quadraticCurveTo(-1.9, 0.885, -2.06, 0.85); // tapa del maleter
  body.quadraticCurveTo(-2.17, 0.82, -2.17, 0.7);
  body.lineTo(-2.17, 0.42);
  body.quadraticCurveTo(-2.17, 0.3, -2.06, 0.3);
  addPart(root, extrudeSide(body, R12.widthM, 0.08), paint);

  // Habitacle de vidre, més estret que la carrosseria, amb sostre i pilars de color.
  const cabin = new THREE.Shape();
  cabin.moveTo(0.78, 0.86);
  cabin.lineTo(0.26, 1.29);
  cabin.quadraticCurveTo(0.18, 1.355, 0.06, 1.36);
  cabin.quadraticCurveTo(-0.39, 1.45, -0.84, 1.36); // sostre bombat, el centre uns 4,5 cm més alt
  cabin.quadraticCurveTo(-0.96, 1.36, -1.04, 1.29);
  cabin.lineTo(-1.52, 0.88);
  cabin.closePath();
  const cabinGlass = addPart(root, extrudeSide(cabin, 1.4, 0.05), glass);
  cabinGlass.castShadow = false;
  addPart(root, r12RoofGeometry(), paint);
  for (const side of [-1, 1]) {
    addPart(root, r12DripRail(side), black);
  }
  const pillars: [number, number, number, number][] = [
    [0.78, 0.87, 0.2, 1.35], // A
    [-0.3, 0.87, -0.33, 1.37], // B
    [-0.98, 1.35, -1.52, 0.88], // C
  ];
  for (const [z1, y1, z2, y2] of pillars) {
    const len = Math.hypot(z2 - z1, y2 - y1);
    for (const side of [-1, 1]) {
      const pillar = addPart(root, new RoundedBoxGeometry(0.05, len, 0.08, 2, 0.02), paint, side * 0.705, (y1 + y2) / 2, (z1 + z2) / 2);
      pillar.rotation.x = Math.atan2(z2 - z1, y2 - y1);
    }
  }

  // Interior, visible a través del vidre: tot cap entre la cintura (y ≈ 0,87) i el vidre.
  // Volant a l'esquerra (+X és l'esquerra mirant cap a +Z).
  addPart(root, new THREE.BoxGeometry(1.3, 0.02, 2.1), trim, 0, 0.895, -0.37); // terra i safates
  addPart(root, new RoundedBoxGeometry(1.3, 0.1, 0.24, 2, 0.03), trim, 0, 0.935, 0.5); // tauler
  const wheel = addPart(root, new THREE.TorusGeometry(0.16, 0.018, 8, 24), black, 0.33, 1.04, 0.22);
  wheel.rotation.x = 0.5;
  const column = addPart(root, new THREE.CylinderGeometry(0.02, 0.02, 0.26, 8), black, 0.33, 0.99, 0.34);
  column.rotation.x = Math.atan2(0.23, -0.1);
  for (const side of [-1, 1]) {
    addPart(root, new RoundedBoxGeometry(0.5, 0.1, 0.46, 2, 0.04), upholstery, side * 0.33, 0.95, -0.2); // seient
    const back = addPart(root, new RoundedBoxGeometry(0.5, 0.4, 0.1, 2, 0.04), upholstery, side * 0.33, 1.1, -0.47);
    back.rotation.x = -0.15;
  }
  addPart(root, new RoundedBoxGeometry(1.24, 0.1, 0.42, 2, 0.04), upholstery, 0, 0.95, -0.82); // banqueta
  const bench = addPart(root, new RoundedBoxGeometry(1.24, 0.3, 0.1, 2, 0.04), upholstery, 0, 1.04, -1.06);
  bench.rotation.x = -0.2;

  // Frontal: fars rectangulars amb la graella al mig i el rombe de Renault.
  for (const side of [-1, 1]) {
    addPart(root, new THREE.BoxGeometry(0.34, 0.15, 0.04), headlight, side * 0.5, 0.6, 2.18);
    addPart(root, new THREE.BoxGeometry(0.14, 0.06, 0.04), amber, side * 0.62, 0.47, 2.18);
    addPart(root, new THREE.BoxGeometry(0.32, 0.17, 0.04), taillight, side * 0.58, 0.66, -2.18);
    addPart(root, new THREE.BoxGeometry(0.1, 0.06, 0.04), amber, side * 0.58, 0.53, -2.18);
    addPart(root, new RoundedBoxGeometry(0.12, 0.08, 0.06, 2, 0.025), black, side * 0.87, 0.97, 0.62); // retrovisor
    addPart(root, new THREE.BoxGeometry(0.012, 0.03, 3.3), chrome, side * 0.83, 0.56, 0.05); // embellidor lateral
  }
  addPart(root, new THREE.BoxGeometry(0.58, 0.13, 0.04), black, 0, 0.6, 2.17);
  const logo = addPart(root, new THREE.BoxGeometry(0.07, 0.07, 0.02), chrome, 0, 0.6, 2.2);
  logo.rotation.z = Math.PI / 4;

  // Para-xocs cromats i matrícules.
  addPart(root, new RoundedBoxGeometry(1.7, 0.09, 0.12, 3, 0.04), chrome, 0, 0.4, 2.22);
  addPart(root, new RoundedBoxGeometry(1.7, 0.09, 0.12, 3, 0.04), chrome, 0, 0.4, -2.22);
  addPart(root, new THREE.BoxGeometry(0.52, 0.11, 0.02), frontPlate, 0, 0.4, 2.29);
  // Darrere, la cara visible és la −Z: es gira perquè el text no surti del revés.
  addPart(root, new THREE.BoxGeometry(0.52, 0.11, 0.02), rearPlate, 0, 0.5, -2.2).rotation.y = Math.PI;

  // Juntes de les portes i tiradors: línies fosques fines als laterals.
  for (const side of [-1, 1]) {
    for (const z of [0.78, -0.3, -1.3]) {
      addPart(root, new THREE.BoxGeometry(0.012, 0.52, 0.012), seam, side * 0.836, 0.6, z);
    }
    addPart(root, new THREE.BoxGeometry(0.012, 0.012, 2.08), seam, side * 0.836, 0.335, -0.26); // baix de les portes
    for (const z of [0.18, -0.8]) {
      addPart(root, new THREE.BoxGeometry(0.03, 0.03, 0.16), chrome, side * 0.845, 0.78, z); // tirador
    }
  }

  // Rodes: pivot (gir de direcció) → spinner (rodolament) → pneumàtic i tapacubos.
  // El tapacubos només mira enfora. El disc tapa la llanda de 13" (radi ~0,165 m).
  const tyreGeo = new THREE.CylinderGeometry(R12_WHEEL_R, R12_WHEEL_R, 0.18, 24);
  tyreGeo.rotateZ(Math.PI / 2);
  const HUB_R = 0.166;
  const hubGeo = new THREE.CylinderGeometry(HUB_R, HUB_R * 0.98, 0.016, 36);
  hubGeo.rotateZ(Math.PI / 2);
  const hubSilver = new THREE.MeshStandardMaterial({
    color: 0xd8dee3,
    roughness: 0.32,
    metalness: 0.78,
    envMap: env,
    envMapIntensity: 0.9,
  });
  const hubDark = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.7, metalness: 0.04 });
  carEnvMaterials.push({ mat: hubSilver, intensity: 0.9 });
  const { slots: slotGeo, diamond: diamondGeo } = r12HubcapParts();
  const badgeGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.005, 20);
  badgeGeo.rotateZ(Math.PI / 2);
  for (const z of [R12_FRONT_AXLE_Z, R12_REAR_AXLE_Z]) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.7, R12_WHEEL_R, z);
      root.add(pivot);
      const spinner = new THREE.Group();
      pivot.add(spinner);
      addPart(spinner, tyreGeo, tyre);
      addPart(spinner, hubGeo, hubSilver, side * 0.104, 0, 0);
      const slots = addPart(spinner, slotGeo, hubDark, side * 0.114, 0, 0);
      const badge = addPart(spinner, badgeGeo, hubDark, side * 0.116, 0, 0);
      const diamond = addPart(spinner, diamondGeo, chrome, side * 0.121, 0, 0);
      for (const piece of [slots, badge, diamond]) {
        piece.castShadow = false;
      }
      kartWheels.spin.push(spinner);
      if (z === R12_FRONT_AXLE_Z) {
        kartWheels.steer.push(pivot);
      }
    }
  }
}

/** Fon les peces fixes de la carrosseria en una malla per material (i per si fan ombra): de ~70
 *  draw calls a una desena, tant al render principal com al mapa d'ombres. Les rodes, que giren,
 *  pengen de grups i no es toquen. */
function mergeStaticParts(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { mat: THREE.Material; castShadow: boolean; meshes: THREE.Mesh[] }>();
  for (const child of root.children) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) {
      continue;
    }
    const key = `${mesh.material.uuid}|${mesh.castShadow}`;
    const bucket = buckets.get(key) ?? { mat: mesh.material, castShadow: mesh.castShadow, meshes: [] };
    bucket.meshes.push(mesh);
    buckets.set(key, bucket);
  }
  const local = new THREE.Matrix4();
  for (const { mat, castShadow, meshes } of buckets.values()) {
    if (meshes.length < 2) {
      continue;
    }
    const geos = meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.clearGroups();
      for (const name of Object.keys(g.attributes)) {
        if (!["position", "normal", "uv"].includes(name)) {
          g.deleteAttribute(name);
        }
      }
      return g.applyMatrix4(local.multiplyMatrices(rootInverse, m.matrixWorld));
    });
    const merged = mergeGeometries(geos);
    if (!merged) {
      continue;
    }
    for (const m of meshes) {
      root.remove(m);
    }
    const mesh = addPart(root, merged, mat);
    mesh.castShadow = castShadow;
  }
}

function animateWheels(distance: number): void {
  for (const w of kartWheels.spin) {
    w.rotation.x += distance / R12_WHEEL_R;
  }
  // Angle de les davanteres a topall: atan(batalla / radi de gir), més obert maniobrant.
  const maxWheelAngle = Math.atan(R12.wheelbaseM / turnRadius(state.speed));
  for (const w of kartWheels.steer) {
    w.rotation.y = -state.steer * maxWheelAngle;
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
    if (name.includes("water_volume")) {
      return "water_volume";
    }
    if (name.includes("water")) {
      return "water";
    }
    node = node.parent;
  }
  return "terrain";
}

function castGroundHits(x: number, z: number): THREE.Intersection[] {
  raycaster.set(rayOrigin.set(x, 400, z), down);
  raycaster.far = 800;
  return raycaster.intersectObjects(groundCellAt(x, z).road, false);
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

type Surface = "paved" | "dirt" | "offroad";

function surfaceAt(x: number, z: number): Surface {
  const hit = roadHitAt(x, z);
  if (!hit) {
    return "offroad";
  }
  return hit.object.name.toLowerCase().includes("dirt") ? "dirt" : "paved";
}

/** Alçada de la làmina si queda per damunt del terra de les rodes; null si el cotxe va eixut.
 *  Mira el centre i els dos eixos: en un gual estret les rodes hi entren abans que el centre.
 *  La vora de la malla s'enterra al talús, així que tocar-la amb un raig no vol dir que hi hagi aigua. */
function waterOverWheels(x: number, y: number, z: number): number | null {
  if (waterMeshes.length === 0) {
    return null;
  }
  const fx = Math.sin(state.heading);
  const fz = Math.cos(state.heading);
  let best: number | null = null;
  for (const along of [0, -1.12, 1.32]) {
    raycaster.set(rayOrigin.set(x + fx * along, y + 6, z + fz * along), down);
    raycaster.far = 12;
    const hits = raycaster.intersectObjects(waterMeshes, false);
    if (hits.length === 0) {
      continue;
    }
    const surfaceY = hits[0].point.y;
    if (surfaceY <= y - state.wheelOffset + 0.05) {
      continue;
    }
    if (best === null || surfaceY > best) {
      best = surfaceY;
    }
  }
  return best;
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

// Planta de la carrosseria sencera per xocar amb les parets, amb un pèl de marge.
const BODY_HALF_L = R12.lengthM / 2 + 0.05;
const BODY_HALF_W = R12.widthM / 2 + 0.05;
const BODY_RAY_HEIGHT_M = 0.5;
// Cantonades en ordre de recorregut: davant-dreta, davant-esquerra, darrere-esquerra, darrere-dreta.
const BODY_CORNER_SIGNS: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
const bodyCorners = BODY_CORNER_SIGNS.map(() => new THREE.Vector3());

/**
 * Alguna paret talla el perímetre de la carrosseria posada a (x, z) amb aquesta orientació?
 * Es tira un raig per cada costat, seguint el contorn: si una cantonada ja és dins d'una casa,
 * el costat que hi arriba des de fora en troba la cara exterior.
 */
function bodyHitsWall(x: number, y: number, z: number, heading: number): boolean {
  if (wallMeshes.length === 0) {
    return false;
  }
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const rx = Math.cos(heading);
  const rz = -Math.sin(heading);
  const ry = y + BODY_RAY_HEIGHT_M;
  BODY_CORNER_SIGNS.forEach(([l, w], i) => {
    bodyCorners[i].set(
      x + fx * BODY_HALF_L * l + rx * BODY_HALF_W * w,
      ry,
      z + fz * BODY_HALF_L * l + rz * BODY_HALF_W * w,
    );
  });
  for (let i = 0; i < bodyCorners.length; i++) {
    const from = bodyCorners[i];
    const to = bodyCorners[(i + 1) % bodyCorners.length];
    rayDir.subVectors(to, from);
    const length = rayDir.length();
    raycaster.set(from, rayDir.divideScalar(length));
    raycaster.far = length;
    if (raycaster.intersectObjects(wallMeshes, false).length > 0) {
      return true;
    }
  }
  return false;
}

/** Hi ha algun edifici, mur o turó entre la càmera i el sol en aquesta direcció? */
function sunOccluded(origin: THREE.Vector3, dir: THREE.Vector3): boolean {
  raycaster.set(origin, dir);
  raycaster.far = 450;
  return raycaster.intersectObjects(wallMeshes, false).length > 0 || raycaster.intersectObjects(groundMeshes, false).length > 0;
}

/** Alçada del terra (calçada o terreny, el que quedi més amunt) sota (x, z); null fora del món. */
function groundY(x: number, z: number): number | null {
  raycaster.set(rayOrigin.set(x, 3000, z), down);
  raycaster.far = 6000;
  const hits = raycaster.intersectObjects(groundCellAt(x, z).ground, false);
  let y: number | null = null;
  for (const h of hits) {
    y = y === null ? h.point.y : Math.max(y, h.point.y);
  }
  return y;
}

function groundFloorY(x: number, z: number): number | null {
  const gy = groundY(x, z);
  return gy === null ? null : gy + state.wheelOffset;
}

type GroundPose = { y: number; pitch: number; roll: number; slope: number };

// Punts en coordenades locals del cotxe (x a l'esquerra, z endavant).
const WHEEL_TRACK_HALF = 0.7;
/** Distància del terra als baixos de la carrosseria (el model té els baixos a ~0,27 m). */
const BODY_CLEARANCE = 0.25;
/** Contorn de la carrosseria (4,35 × 1,64 m): cantonades, laterals i para-xocs. */
const BODY_POINTS: [number, number][] = [
  [0.8, 2.1], [-0.8, 2.1], [0, 2.15],
  [0.8, 0.6], [-0.8, 0.6],
  [0.8, -0.6], [-0.8, -0.6],
  [0.8, -2.1], [-0.8, -2.1], [0, -2.15],
];

/**
 * Alçada (m) d'un microrelleu de la calçada. Ones d'uns 15–25 m i pocs centímetres: el pendent
 * combinat no arriba a un grau. Només serveix per tombar el cotxe; no és el terra de debò.
 */
function roadMicroHeight(x: number, z: number): number {
  const slow = Math.sin(x * 0.28 + z * 0.11);
  const cross = Math.sin(x * 0.13 - z * 0.33);
  return slow * 0.022 + cross * 0.014;
}

/**
 * Posa el cotxe sobre les quatre rodes: el pla que passa per l'alçada del terra sota cada roda
 * dóna el capcineig i el balanceig. Si algun punt del contorn de la carrosseria quedaria per sota
 * del terra (un talús, un caramull), el cotxe s'aixeca com si quedés recolzat sobre els baixos.
 * A la calçada, un microrelleu suau varia aquesta inclinació perquè el cotxe no quedi sempre
 * paral·lel al pla del carrer. No entra a l'alçada ni al pendent que empeny el cotxe.
 */
function sampleGroundPose(x: number, z: number, heading: number): GroundPose | null {
  const center = groundY(x, z);
  if (center === null) {
    return null;
  }
  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  const at = (lx: number, lz: number): number =>
    groundY(x + lx * cosH + lz * sinH, z - lx * sinH + lz * cosH) ?? center;

  const frontZ = R12_FRONT_AXLE_Z;
  const rearZ = R12_REAR_AXLE_Z;
  const wb = frontZ - rearZ;
  const hFL = at(WHEEL_TRACK_HALF, frontZ);
  const hFR = at(-WHEEL_TRACK_HALF, frontZ);
  const hRL = at(WHEEL_TRACK_HALF, rearZ);
  const hRR = at(-WHEEL_TRACK_HALF, rearZ);
  const front = (hFL + hFR) / 2;
  const rear = (hRL + hRR) / 2;
  const left = (hFL + hRL) / 2;
  const right = (hFR + hRR) / 2;
  const gradZ = (front - rear) / wb;
  const gradX = (left - right) / (2 * WHEEL_TRACK_HALF);
  // A la calçada, el desnivell entre rodes del microrelleu se suma al pla real.
  // L'alçada i el pendent físic es queden amb el terra de debò.
  let tiltZ = gradZ;
  let tiltX = gradX;
  if (isOnRoad(x, z)) {
    const base = roadMicroHeight(x, z);
    const micro = (lx: number, lz: number): number =>
      roadMicroHeight(x + lx * cosH + lz * sinH, z - lx * sinH + lz * cosH) - base;
    const mFL = micro(WHEEL_TRACK_HALF, frontZ);
    const mFR = micro(-WHEEL_TRACK_HALF, frontZ);
    const mRL = micro(WHEEL_TRACK_HALF, rearZ);
    const mRR = micro(-WHEEL_TRACK_HALF, rearZ);
    tiltZ += ((mFL + mFR) / 2 - (mRL + mRR) / 2) / wb;
    tiltX += ((mFL + mRL) / 2 - (mFR + mRR) / 2) / (2 * WHEEL_TRACK_HALF);
  }
  const midZ = (frontZ + rearZ) / 2;
  const plane = (lx: number, lz: number): number => (front + rear) / 2 + (lz - midZ) * gradZ + lx * gradX;

  let lift = 0;
  for (const [lx, lz] of BODY_POINTS) {
    lift = Math.max(lift, at(lx, lz) - plane(lx, lz) - BODY_CLEARANCE);
  }
  const slope = Math.atan(gradZ);
  return {
    y: plane(0, 0) + lift,
    // Rotació X positiva abaixa el morro (+Z): si el davant és més alt, cal negativa.
    pitch: -Math.atan(tiltZ),
    roll: Math.atan(tiltX),
    slope,
  };
}

// --- Col·lisions amb arbres: troncs en una graella espacial, cotxe com a tres cercles ---

const TREE_GRID_M = 4;
const CAR_CIRCLE_R = 0.85;
const CAR_CIRCLE_OFFSETS = [1.4, 0, -1.4];
const treeTrunks = new Map<string, { x: number; z: number; r: number }[]>();

function addTreeTrunk(x: number, z: number, r: number): void {
  const key = `${Math.floor(x / TREE_GRID_M)},${Math.floor(z / TREE_GRID_M)}`;
  const list = treeTrunks.get(key);
  if (list) {
    list.push({ x, z, r });
  } else {
    treeTrunks.set(key, [{ x, z, r }]);
  }
}

function hitsTree(x: number, z: number, heading: number): boolean {
  if (treeTrunks.size === 0) {
    return false;
  }
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  for (const off of CAR_CIRCLE_OFFSETS) {
    const cx = x + fx * off;
    const cz = z + fz * off;
    const gx = Math.floor(cx / TREE_GRID_M);
    const gz = Math.floor(cz / TREE_GRID_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const t of treeTrunks.get(`${gx + dx},${gz + dz}`) ?? []) {
          if (Math.hypot(t.x - cx, t.z - cz) < CAR_CIRCLE_R + t.r) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/** Pot ser-hi el cotxe? Dins del món i sense tocar cap tronc (les parets van per raycast). */
function canOccupy(x: number, z: number, heading: number): boolean {
  const limit = terrainSizeM / 2 - 3;
  return Math.abs(x) < limit && Math.abs(z) < limit && !hitsTree(x, z, heading);
}

function tryHop(): void {
  if (state.verticalVelocity > 0.4) {
    return;
  }
  const floor = groundFloorY(kart.position.x, kart.position.z);
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
  state.accelPitch = 0;
  state.driftAngle = 0;
  clearImpact();
  autopilot?.reset();
  state.heading = THREE.MathUtils.degToRad(spawn.rotation_y_deg);
  kart.rotation.y = state.heading;
  const [sx, sz] = snapToDrivableRoad(spawn.position.x, spawn.position.z, state.heading);
  const y = sampleRoadY(sx, sz) ?? spawn.position.y;
  kart.position.set(sx, y + state.wheelOffset, sz);
  placeCameraBehindKart();
}

const worldSunDir = sunDirection(SUN_AZIMUTH.x, SUN_AZIMUTH.z, SUN_VISUAL_ELEVATION_DEG);
const worldMaterials = {
  building: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 }),
  tapia: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
  stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
  // Barrots i marcs. Amb reflex (rugositat 0,6) el sol recorre la barana i es llegeix com un arc,
  // encara que cada cara tingui una sola normal.
  prop: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
  // Formigó llis: l'arrebossat de les cases, a 2,5 m, es veia a un pal de 30 cm.
  pole: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.02 }),
  window: createWindowGlassMaterial(worldSunDir),
  green: new THREE.MeshStandardMaterial({ color: 0x62c872, roughness: 0.92 }),
  // Color per vèrtex: asfalt o terra segons l'ortofoto (vegeu _road_surface al pipeline).
  road: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84 }),
  // El camí de terra mostra la mateixa ortofoto que el terreny (la rep a sharedTerrainMaterials):
  // un color pla feia una taca uniforme amb la vora tallada en sec contra la foto del voltant.
  roadDirt: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97 }),
};
worldMaterials.roadDirt.onBeforeCompile = (shader) => injectOrthoShader(shader);
// Arrebossat amb antirepetició: les façanes són llises i grans i el patró de 2,5 m es veia repetit.
addWorldDetail(worldMaterials.building, { map: detailTextures.plaster, mode: "triplanar", scaleM: 2.5, strength: 0.35, fade: [30, 120], antiTile: true });
// Tàpies de totxo amb la junta de morter clar; la maçoneria de l'església, amb junta fosca.
addWorldDetail(worldMaterials.tapia, { map: detailTextures.brick, mode: "triplanar", scaleM: 3.15, strength: 1, fade: [30, 120], secondScale: 0.13, mortar: new THREE.Color(0xe2dccd) });
addWorldDetail(worldMaterials.stone, { map: detailTextures.stone, mode: "triplanar", scaleM: 3, strength: 1, fade: [30, 120], secondScale: 0.12 });
addWorldDetail(worldMaterials.green, { map: detailTextures.ground, mode: "top", scaleM: 3, strength: 0.8, secondScale: 0.11 });
addWorldDetail(worldMaterials.road, {
  map: detailTextures.asphalt,
  surface: detailTextures.asphaltSurface,
  mode: "top",
  scaleM: 4,
  strength: 0.82,
  relief: 0.85,
  fade: [45, 170],
});
addWorldDetail(worldMaterials.roadDirt, { map: detailTextures.dirt, mode: "top", scaleM: 2.2, strength: 1, secondScale: 0.12, fade: [40, 150] });
// Dins d'una casa, parets, teulada i accessoris d'aquella casa no es dibuixen.
installHouseHide(worldMaterials.building);
installHouseHide(worldMaterials.tapia);
installHouseHide(worldMaterials.stone);
installHouseHide(worldMaterials.prop);

/** Casa que la càmera té al voltant (0 = cap). El mateix uniform el llegeixen tots els materials. */
const hideHouseUniform = { value: 0 };

/**
 * Descarta els fragments de la casa `hideHouseUniform` (parets, teulada, finestres, portes).
 * L'atribut `houseId` el posa el pipeline; si la malla no en té, val 0 i no es descarta res.
 */
function installHouseHide(material: THREE.Material): void {
  houseHideMaterials.push(material);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uHideHouse = hideHouseUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float houseId;\nvarying float vHideHouse;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHideHouse = houseId;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vHideHouse;\nuniform float uHideHouse;")
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
#ifdef ABR_HIDE_HOUSE
if (uHideHouse > 0.5 && abs(vHideHouse - uHideHouse) < 0.5) discard;
#endif`,
      );
  };
  material.customProgramCacheKey = () =>
    `${previousKey}|hideHouse|${material.defines?.ABR_HIDE_HOUSE !== undefined ? 1 : 0}`;
}

/** Activa el descart només quan la càmera és dins d'una casa. Fora, el programa no té `discard`. */
function setHouseHide(id: number): void {
  hideHouseUniform.value = id;
  const hide = id > 0;
  if (hide === houseHideCompiled) {
    return;
  }
  houseHideCompiled = hide;
  for (const mat of houseHideMaterials) {
    mat.defines = mat.defines ?? {};
    if (hide) {
      mat.defines.ABR_HIDE_HOUSE = "";
    } else {
      delete mat.defines.ABR_HIDE_HOUSE;
    }
    mat.needsUpdate = true;
  }
}

/** Normal de la cara a cada triangle. Les caixes (barrots, marcs) comparteixen els vuit vèrtexs
 *  i la normal de la cantonada és la mitjana de les tres cares: la llum pinta el barrot com un
 *  cilindre i, en una barana, els reflexos s'alineen en un arc. `flatShading` del material no
 *  serveix: la normal surt de derivades de pantalla i, en un barrot d'un píxel, el bloc de 2×2
 *  barreja el veí. */
function flatFaceNormals(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const geom = geometry.index ? geometry.toNonIndexed() : geometry;
  geom.computeVertexNormals();
  return geom;
}

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
      computeOwnBoundsTree(mesh.geometry);
      if (mesh.name.toLowerCase().includes("pole")) {
        mesh.material = worldMaterials.pole;
        return;
      }
      houseShellMeshes.push(mesh);
      if (!mesh.geometry.attributes.color) {
        const plain = new THREE.MeshStandardMaterial({ color: 0xd9a088, roughness: 0.78 });
        installHouseHide(plain);
        mesh.material = plain;
      } else {
        mesh.material = /tapia|brick/.test(mesh.name.toLowerCase())
          ? worldMaterials.tapia
          : /stone/.test(mesh.name.toLowerCase())
            ? worldMaterials.stone
            : worldMaterials.building;
      }
      return;
    }
    if (kind === "prop") {
      const flat = flatFaceNormals(mesh.geometry);
      if (flat !== mesh.geometry) {
        mesh.geometry.dispose();
        mesh.geometry = flat;
      }
      mesh.material = mesh.name.toLowerCase().includes("windows") ? worldMaterials.window : worldMaterials.prop;
      mesh.layers.set(DETAIL_LAYER);
      return;
    }
    if (kind === "green") {
      mesh.material = worldMaterials.green;
      return;
    }
    if (kind === "water_volume") {
      applyWaterMaterial(mesh, "volume");
      return;
    }
    if (kind === "water") {
      // No és terra: el cotxe passa pel llit, per sota de la làmina.
      waterMeshes.push(mesh);
      mesh.userData.lazyBvh = true;
      applyWaterMaterial(mesh, "surface");
      return;
    }
    if (kind === "road") {
      roadMeshes.push(mesh);
      groundMeshes.push(mesh);
      mesh.userData.lazyBvh = true;
      mesh.material = mesh.name.toLowerCase().includes("dirt") ? worldMaterials.roadDirt : worldMaterials.road;
      return;
    }
    if (kind === "terrain") {
      groundMeshes.push(mesh);
      mesh.userData.lazyBvh = true;
      // El glTF exporta els atributs amb prefix _; el shader els vol sense.
      const bankAttr = mesh.geometry.getAttribute("_bank");
      const toneAttr = mesh.geometry.getAttribute("_tone");
      if (bankAttr) {
        mesh.geometry.setAttribute("bank", bankAttr);
        mesh.geometry.deleteAttribute("_bank");
      }
      if (toneAttr) {
        mesh.geometry.setAttribute("tone", toneAttr);
        mesh.geometry.deleteAttribute("_tone");
      }
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
  const res = await fetchOnce(`/trees.json?${assetCacheKey}`);
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
  /** Format compacte [x, y, z, r, g, b]. */
  plants: [number, number, number, number, number, number][];
  /** house_id → referència cadastral (mode DEV, hover). */
  houses?: Record<string, string>;
};

/** Fitxa breu del tooltip DEV (`house_cards.json`). */
type HouseCard = {
  street?: string;
  use?: string;
  year?: number;
  floors?: number;
  areaM2?: number;
  dwellings?: number;
  parts?: number;
  condition?: string;
  model?: string;
  photo?: string;
};

/** Color de la foto en sRGB; `gain` compensa que la foto inclou les ombres de dins la copa. */
function photoColor(c: [number, number, number] | number[], gain: number, target = new THREE.Color()): THREE.Color {
  return target.setRGB(
    Math.min(1, (c[0] / 255) * gain),
    Math.min(1, (c[1] / 255) * gain),
    Math.min(1, (c[2] / 255) * gain),
    THREE.SRGBColorSpace,
  );
}

// Arbres i plantes es parteixen en zones de 8×8: el frustum culling descarta les que queden
// fora de càmera, i les plantes (petites) només es dibuixen a prop.
const CHUNKS_PER_SIDE = 16;
const TREE_DRAW_DIST_M = 450;
const PLANT_DRAW_DIST_M = 140;
/** Zona de vegetació que es construeix la primera vegada que la càmera s'hi acosta. */
type LazyChunk = {
  x: number;
  z: number;
  reach: number;
  build: () => THREE.Object3D;
  obj: THREE.Object3D | null;
  /** performance.now() quan la zona ha aparegut (fade-in). */
  fadeStart?: number;
  /** Opacitat ja aplicada, per no recórrer la zona cada fotograma. */
  fadeAlpha?: number;
};
const lazyChunks: LazyChunk[] = [];
const vegetationRoot = new THREE.Group();
/** Zones noves que es poden construir per comprovació (cada 250 ms): sense estrebades. */
const CHUNK_BUILD_BUDGET = 3;
/** Apareixen en ~0,5 s; als últims metres del radi es desvaneixen en lloc de desaparèixer de cop. */
const CHUNK_FADE_IN_MS = 520;
const CHUNK_EDGE_FADE_M = 42;

function fadeMaterial(mat: THREE.Material): THREE.Material {
  const m = mat.clone();
  m.transparent = true;
  m.opacity = 0;
  return m;
}

function applyChunkFadeMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(fadeMaterial);
    } else {
      mesh.material = fadeMaterial(mesh.material);
    }
  });
}

function smoothFade(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function chunkCell(v: number): number {
  const size = terrainSizeM / CHUNKS_PER_SIDE;
  return THREE.MathUtils.clamp(Math.floor((v + terrainSizeM / 2) / size), 0, CHUNKS_PER_SIDE - 1);
}

function groupByChunk<T extends { x: number; z: number }>(items: T[]): T[][] {
  const groups = new Map<number, T[]>();
  for (const it of items) {
    const key = chunkCell(it.x) * CHUNKS_PER_SIDE + chunkCell(it.z);
    const list = groups.get(key);
    if (list) {
      list.push(it);
    } else {
      groups.set(key, [it]);
    }
  }
  return [...groups.values()];
}

function registerLazyChunk(x: number, z: number, maxDist: number, build: () => THREE.Object3D): void {
  // Radi de la zona (diagonal de mitja cel·la) perquè no desaparegui res a la vora.
  const reach = maxDist + (terrainSizeM / CHUNKS_PER_SIDE) * 0.71;
  lazyChunks.push({ x, z, reach, build, obj: null });
}

let lastCullCheck = -Infinity;

function cullByDistance(now: number, budget = CHUNK_BUILD_BUDGET, maxBuildDist = Infinity): void {
  if (budget !== Infinity && now - lastCullCheck < 250) {
    return;
  }
  lastCullCheck = now;
  const { x, z } = camera.position;
  // Primer les zones més properes: el que es veu de prop apareix abans.
  const order = lazyChunks
    .map((c) => ({ c, d: Math.hypot(c.x - x, c.z - z) }))
    .sort((a, b) => a.d - b.d);
  for (const { c, d } of order) {
    const near = d < c.reach;
    if (near && !c.obj && budget > 0 && d < maxBuildDist) {
      c.obj = c.build();
      applyChunkFadeMaterials(c.obj);
      c.fadeStart = now;
      vegetationRoot.add(c.obj);
      c.obj.updateMatrixWorld(true);
      freezeStatic(c.obj);
      budget--;
    }
    if (c.obj) {
      // Molt lluny: s'allibera (buffers de la GPU inclosos) i es tornarà a construir si cal.
      // Així la memòria no creix fins a tenir totes les zones del mapa construïdes.
      if (d > c.reach * 1.6) {
        disposeChunk(c.obj);
        vegetationRoot.remove(c.obj);
        c.obj = null;
        c.fadeStart = undefined;
      }
    }
  }
}

function updateVegetationFade(now: number): void {
  const { x, z } = camera.position;
  for (const c of lazyChunks) {
    if (!c.obj) {
      continue;
    }
    const d = Math.hypot(c.x - x, c.z - z);
    const edge = THREE.MathUtils.clamp((c.reach - d) / CHUNK_EDGE_FADE_M, 0, 1);
    const time =
      c.fadeStart === undefined ? 1 : smoothFade((now - c.fadeStart) / CHUNK_FADE_IN_MS);
    const alpha = time * smoothFade(edge);
    // Passos de 0,025: conduint, el valor gairebé no canvia i el recorregut de la zona és car.
    const q = Math.round(alpha * 40) / 40;
    if (c.fadeAlpha !== q) {
      c.fadeAlpha = q;
      c.obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) {
          return;
        }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          mat.opacity = q;
        }
      });
    }
    c.obj.visible = q > 0.02;
    if (alpha >= 0.999 && c.fadeStart !== undefined) {
      c.fadeStart = undefined;
    }
  }
}

/** Allibera els InstancedMesh d'una zona. Geometries i materials són compartits: no es toquen. */
function disposeChunk(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) {
      const mesh = o as THREE.InstancedMesh;
      mesh.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        mat.dispose();
      }
    }
  });
}

const treeTrunkGeo = new THREE.CylinderGeometry(0.1, 0.16, 1, 6).translate(0, 0.5, 0);
const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: barkMap(), roughness: 0.95 });
// El fullatge multiplica el color de la foto de cada arbre (mitjana ~0,85): fulles clares i fosques.
const treeCrownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: foliageMap(), roughness: 0.85, flatShading: true });
/** Planta d'hort / arbust: tres plans creuats a 60° amb textura de fulles retallada per alfa.
 * Les normals miren amunt perquè els plans no s'enfosqueixin segons l'angle de la llum. */
function crossedPlantGeometry(width: number, height: number): THREE.BufferGeometry {
  const planes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(width, height);
    g.translate(0, height / 2 - 0.03, 0);
    g.rotateY((i * Math.PI) / 3);
    planes.push(g);
  }
  const geo = mergeGeometries(planes)!;
  const normals = geo.attributes.normal;
  for (let i = 0; i < normals.count; i++) {
    normals.setXYZ(i, 0, 1, 0);
  }
  return geo;
}

const plantGeo = crossedPlantGeometry(0.7, 0.6);
const plantMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: plantSpriteMap(),
  alphaTest: 0.45,
  // Amb l'antialiàsing del canvas, les vores retallades queden suaus en lloc de serrades.
  alphaToCoverage: true,
  side: THREE.DoubleSide,
  roughness: 0.9,
});

// --- Espècies d'arbres ------------------------------------------------------------------------
//
// Street View, set. 2024: al fons de la vega, fileres de chopos alts i estrets (es queden).
// Als horts i patis, els altres arbres no són boles: fruiters baixos i oberts, amb el brancam
// a la vista, i algun frondós gran de copa irregular (noguer, freixe). Fora del poble, les
// copes fosques i aïllades són encines, amples i aixafades.

type TreeSpecies = "chopo" | "encina" | "frondos" | "fruiter";
type VillageTree = VillageFile["trees"][number];

const GROVE_LINK_M = 7;
// Amb aquests llindars, la meitat dels arbres són chopos (un 62% a l'est del terme).
const GROVE_MIN_TREES = 20;
const GROVE_MIN_TREES_EAST = 6;
const EAST_FROM_X = 150;
const VILLAGE_RADIUS_M = 300;
const ENCINA_MAX_LUMINANCE = 44;
// Per sota d'aquest radi de copa, l'arbre solitari del poble és un fruiter d'hort, no un frondós.
const FRUITER_MAX_RADIUS_M = 2.55;

/** Mida del grup de cada arbre (arbres enllaçats a menys de GROVE_LINK_M), amb una graella i union-find. */
function groveSizes(trees: VillageTree[]): number[] {
  const parent = trees.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const grid = new Map<string, number[]>();
  const key = (gx: number, gz: number) => `${gx},${gz}`;
  trees.forEach((t, i) => {
    const gx = Math.floor(t.x / GROVE_LINK_M);
    const gz = Math.floor(t.z / GROVE_LINK_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get(key(gx + dx, gz + dz)) ?? []) {
          if (Math.hypot(trees[j].x - t.x, trees[j].z - t.z) < GROVE_LINK_M) {
            parent[find(i)] = find(j);
          }
        }
      }
    }
    const k = key(gx, gz);
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const counts = new Map<number, number>();
  trees.forEach((_, i) => counts.set(find(i), (counts.get(find(i)) ?? 0) + 1));
  return trees.map((_, i) => counts.get(find(i)) ?? 1);
}

function classifyTrees(trees: VillageTree[]): TreeSpecies[] {
  const sizes = groveSizes(trees);
  return trees.map((t, i) => {
    const grove = sizes[i];
    if (grove >= GROVE_MIN_TREES || (t.x > EAST_FROM_X && grove >= GROVE_MIN_TREES_EAST)) {
      return "chopo";
    }
    const lum = (t.c[0] + t.c[1] + t.c[2]) / 3;
    if (Math.hypot(t.x, t.z) > VILLAGE_RADIUS_M && lum < ENCINA_MAX_LUMINANCE) {
      return "encina";
    }
    if (t.r < FRUITER_MAX_RADIUS_M) {
      return "fruiter";
    }
    return "frondos";
  });
}

/** Massa de fulles a l'espai de la copa (la bola unitat va de -1 a 1; el tronc hi arriba a y ≈ -0,2). */
function foliageLobe(radius: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, radius > 0.36 ? 1 : 0);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

/** Branca al mateix espai que la copa, perquè s'escali amb ella. */
function treeBranch(
  r0: number,
  r1: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): THREE.BufferGeometry {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(Math.max(0.012, r1), r0, len, 5);
  g.translate(0, len / 2, 0);
  dir.multiplyScalar(1 / len);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(ax, ay, az);
  return g;
}

/** Encina: paraigua fosc, més ample que alt, amb la vora desigual. El tronc curt queda a sota. */
function encinaCrownGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    foliageLobe(0.78, 0, 0.05, 0, 1.2, 0.38, 1.12),
    foliageLobe(0.48, 0.55, -0.02, 0.18, 1.05, 0.42, 0.9),
    foliageLobe(0.5, -0.5, 0.0, -0.25, 1.08, 0.4, 0.95),
    foliageLobe(0.42, 0.05, -0.04, 0.55, 0.95, 0.4, 1.05),
    foliageLobe(0.4, -0.15, 0.02, -0.52, 1, 0.42, 0.9),
    foliageLobe(0.3, 0.2, 0.22, 0.02, 0.9, 0.45, 0.85),
    foliageLobe(0.24, -0.32, 0.12, 0.28, 1, 0.38, 0.8),
  ])!;
}

/** Frondós de pati (noguer, freixe): una sola massa irregular, enganxada al tronc, no una bola. */
function frondosCrownGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    foliageLobe(0.62, 0.0, 0.12, 0.0, 1.15, 0.85, 1.05),
    foliageLobe(0.4, -0.38, 0.32, 0.08, 1, 0.9, 0.9),
    foliageLobe(0.42, 0.42, 0.08, 0.1, 1.05, 0.75, 0.95),
    foliageLobe(0.32, 0.08, 0.48, -0.06, 0.9, 0.85, 0.85),
    foliageLobe(0.34, 0.12, -0.08, 0.38, 1, 0.7, 0.9),
    foliageLobe(0.3, -0.15, 0.02, -0.4, 0.95, 0.75, 1),
    foliageLobe(0.26, -0.48, -0.05, 0.15, 0.9, 0.65, 0.85),
  ])!;
}

/** Branques del frondós: surten del capdamunt del tronc (y ≈ -0,2) i es fiquen a la copa. */
function frondosBranchGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    treeBranch(0.045, 0.028, 0, -0.42, 0, 0.02, 0.22, 0),
    treeBranch(0.03, 0.016, 0.0, -0.05, 0, -0.32, 0.48, 0.06),
    treeBranch(0.028, 0.014, 0.02, -0.02, 0, 0.42, 0.22, 0.08),
    treeBranch(0.022, 0.012, 0, 0.05, 0, 0.08, 0.62, -0.04),
    treeBranch(0.02, 0.01, 0.02, -0.08, 0.02, 0.14, 0.08, 0.38),
    treeBranch(0.02, 0.01, -0.02, 0.0, 0, -0.08, 0.32, -0.32),
  ])!;
}

/** Fruiter d'hort: baix i obert, amb les masses juntes però amb forats, com a la foto. */
function fruiterCrownGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    foliageLobe(0.38, 0.28, 0.22, 0.05, 1, 0.8, 0.9),
    foliageLobe(0.34, -0.32, 0.32, -0.08, 0.95, 0.85, 0.85),
    foliageLobe(0.28, 0.02, 0.48, -0.22, 0.85, 0.75, 0.8),
    foliageLobe(0.26, -0.05, 0.08, 0.36, 0.9, 0.7, 0.95),
    foliageLobe(0.22, 0.4, 0.12, -0.28, 0.85, 0.65, 0.75),
    foliageLobe(0.18, -0.22, 0.42, 0.22, 0.8, 0.7, 0.75),
  ])!;
}

function fruiterBranchGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    treeBranch(0.055, 0.03, 0, -0.72, 0, 0, 0.08, 0),
    treeBranch(0.032, 0.016, 0, -0.02, 0, 0.4, 0.32, 0.08),
    treeBranch(0.03, 0.014, 0, 0.0, 0, -0.36, 0.4, -0.1),
    treeBranch(0.026, 0.012, 0, 0.02, 0, 0.0, 0.52, -0.28),
    treeBranch(0.024, 0.012, 0, -0.08, 0, -0.06, 0.14, 0.38),
    treeBranch(0.02, 0.01, 0.04, 0.02, -0.02, 0.22, 0.22, -0.3),
  ])!;
}

type SpeciesLook = {
  crownGeo: THREE.BufferGeometry;
  /** Branques al mateix espai que la copa; escorça, sense el color de la foto. */
  branchGeo?: THREE.BufferGeometry;
  trunkMat: THREE.Material;
  colorGain: number;
  /** Mides de tronc i copa a partir del radi de copa vist a la foto. */
  shape: (r: number, h: number) => { height: number; girth: number; crownR: number; crownH: number; trunkR: number };
};

const barkTexture = barkMap();
const SPECIES: Record<TreeSpecies, SpeciesLook> = {
  // Pollancre de plantació: tronc alt, recte i clar; copa estreta i allargada a la part de dalt.
  chopo: {
    crownGeo: new THREE.IcosahedronGeometry(1, 1),
    trunkMat: new THREE.MeshStandardMaterial({ color: 0xe0dccf, map: barkTexture, roughness: 0.9 }),
    colorGain: 1.6,
    shape: (r) => {
      const height = THREE.MathUtils.clamp(10 + r * 3.5, 14, 26);
      const crownR = Math.max(1.5, r * 0.85);
      return { height, girth: THREE.MathUtils.clamp(height / 9, 1.6, 2.6), crownR, crownH: height * 0.33, trunkR: 0.25 };
    },
  },
  // Encina: tronc curt i fosc; la copa és un paraigua ample, no una bola.
  encina: {
    crownGeo: encinaCrownGeometry(),
    trunkMat: new THREE.MeshStandardMaterial({ color: 0x8a7a68, map: barkTexture, roughness: 0.95 }),
    colorGain: 1.45,
    shape: (r) => {
      const crownR = Math.max(2.2, r * 1.05);
      const crownH = crownR * 0.48;
      const height = 1.7 + 1.2 * crownH;
      return { height, girth: THREE.MathUtils.clamp(1.1 + r * 0.22, 1.3, 2.4), crownR, crownH, trunkR: 0.28 };
    },
  },
  // Frondós de pati: el tronc només es veu uns 2 m; la copa baixa fins a les branques.
  frondos: {
    crownGeo: frondosCrownGeometry(),
    branchGeo: frondosBranchGeometry(),
    trunkMat: treeTrunkMat,
    colorGain: 1.55,
    shape: (r) => {
      const crownR = r * 1.08;
      const crownH = crownR * 0.95;
      const trunkClear = THREE.MathUtils.clamp(1.5 + r * 0.18, 1.7, 2.6);
      const height = trunkClear + 1.2 * crownH;
      const girth = THREE.MathUtils.clamp(1.05 + r * 0.16, 1.25, 2.4);
      return { height, girth, crownR, crownH, trunkR: 0.22 };
    },
  },
  // Fruiter: més baix que l'alçada detectada, que allargava el tronc fins a fer una bola sobre un pal.
  fruiter: {
    crownGeo: fruiterCrownGeometry(),
    branchGeo: fruiterBranchGeometry(),
    trunkMat: treeTrunkMat,
    colorGain: 1.5,
    shape: (r) => {
      const height = THREE.MathUtils.clamp(2.6 + r * 0.85, 3.2, 5.4);
      const crownR = Math.max(1.35, r * 1.05);
      return {
        height,
        girth: THREE.MathUtils.clamp(0.75 + r * 0.12, 0.85, 1.45),
        crownR,
        crownH: crownR * 0.78,
        trunkR: 0.14,
      };
    },
  },
};

function buildTreeChunk(look: SpeciesLook, chunk: VillageTree[]): THREE.Object3D {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  const trunks = new THREE.InstancedMesh(treeTrunkGeo, look.trunkMat, chunk.length);
  const crowns = new THREE.InstancedMesh(look.crownGeo, treeCrownMat, chunk.length);
  const branches = look.branchGeo ? new THREE.InstancedMesh(look.branchGeo, look.trunkMat, chunk.length) : null;
  chunk.forEach((t, i) => {
    const sh = look.shape(t.r, t.h);
    quat.setFromAxisAngle(up, (t.x * 7.1 + t.z * 3.7) % (Math.PI * 2));
    const trunkH = Math.max(1, sh.height - sh.crownH * 1.2);
    trunks.setMatrixAt(i, m.compose(pos.set(t.x, t.y, t.z), quat, scale.set(sh.girth, trunkH, sh.girth)));
    crowns.setMatrixAt(i, m.compose(pos.set(t.x, t.y + sh.height - sh.crownH, t.z), quat, scale.set(sh.crownR, sh.crownH, sh.crownR)));
    branches?.setMatrixAt(i, m);
    crowns.setColorAt(i, photoColor(t.c, look.colorGain, color));
  });
  const group = new THREE.Group();
  for (const mesh of [trunks, crowns, branches]) {
    if (!mesh) {
      continue;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

/** Classifica les espècies, registra els troncs per a les col·lisions (tots, des del principi) i
 * deixa les malles per construir zona a zona quan la càmera s'hi acosti. */
function registerVillageTrees(trees: VillageFile["trees"]): void {
  const species = classifyTrees(trees);
  const counts: Record<TreeSpecies, number> = { chopo: 0, encina: 0, frondos: 0, fruiter: 0 };
  species.forEach((s) => counts[s]++);
  console.info("[arbres]", counts);
  trees.forEach((t, i) => addTreeTrunk(t.x, t.z, SPECIES[species[i]].shape(t.r, t.h).trunkR));
  for (const kind of Object.keys(SPECIES) as TreeSpecies[]) {
    const look = SPECIES[kind];
    for (const chunk of groupByChunk(trees.filter((_, i) => species[i] === kind))) {
      const cx = chunk.reduce((a, t) => a + t.x, 0) / chunk.length;
      const cz = chunk.reduce((a, t) => a + t.z, 0) / chunk.length;
      registerLazyChunk(cx, cz, TREE_DRAW_DIST_M, () => buildTreeChunk(look, chunk));
    }
  }
}

type PlantRow = VillageFile["plants"][number];

function buildPlantChunk(rows: PlantRow[]): THREE.Object3D {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  const mesh = new THREE.InstancedMesh(plantGeo, plantMat, rows.length);
  rows.forEach(([x, y, z, r, g, b], i) => {
    // Variació de mida i proporció: enciams i cols baixos, tomaqueres i mongeteres més altes.
    const r1 = ((((x + z) * 0.618) % 1) + 1) % 1;
    const r2 = ((((x * 0.37 - z * 0.71) * 1.3) % 1) + 1) % 1;
    const s = 0.65 + r1 * 0.6;
    const tall = 0.6 + r2 * 0.9;
    quat.setFromAxisAngle(up, (x * 1.7 + z) % (Math.PI * 2));
    mesh.setMatrixAt(i, m.compose(pos.set(x, y, z), quat, scale.set(s, s * tall, s)));
    mesh.setColorAt(i, photoColor([r, g, b], 1.35, color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.layers.set(DETAIL_LAYER);
  return mesh;
}

/** Plantes d'hort (centenars de milers): només es reparteixen per zones; cada zona es construeix
 * quan la càmera hi arriba a menys de PLANT_DRAW_DIST_M. */
function registerHortPlants(plants: PlantRow[]): void {
  const groups = new Map<number, PlantRow[]>();
  for (const row of plants) {
    const key = chunkCell(row[0]) * CHUNKS_PER_SIDE + chunkCell(row[2]);
    const list = groups.get(key);
    if (list) {
      list.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  for (const rows of groups.values()) {
    const cx = rows.reduce((a, r) => a + r[0], 0) / rows.length;
    const cz = rows.reduce((a, r) => a + r[2], 0) / rows.length;
    registerLazyChunk(cx, cz, PLANT_DRAW_DIST_M, () => buildPlantChunk(rows));
  }
}

async function loadVillage(): Promise<void> {
  const res = await fetchOnce(`/village.json?${assetCacheKey}`);
  if (!res.ok) {
    return;
  }
  const data = (await res.json()) as VillageFile;
  houseRefs = data.houses ?? {};
  if (data.trees?.length) {
    registerVillageTrees(data.trees);
  }
  if (data.plants?.length) {
    registerHortPlants(data.plants);
  }
  vegetationRoot.matrixAutoUpdate = false;
  worldRoot.add(vegetationRoot);
}

async function loadHouseCards(): Promise<void> {
  const res = await fetchOnce(`/house_cards.json?${assetCacheKey}`);
  if (!res.ok) {
    return;
  }
  houseCards = (await res.json()) as Record<string, HouseCard>;
  const ref = houseTooltip?.dataset.ref;
  if (ref && devHoverHouseId && houseTooltip && !houseTooltip.hasAttribute("hidden")) {
    renderHouseCard(ref);
  }
}

const shadowLook = new THREE.Vector3();

/** El mapa d'ombres segueix el cotxe, una mica endavant d'on mira la càmera, i ajustat a la
 * mida del texel perquè les vores no tremolin. */
function followSun(): void {
  const texel = (2 * SHADOW_HALF_M) / sun.shadow.mapSize.x;
  camera.getWorldDirection(shadowLook);
  shadowLook.y = 0;
  if (shadowLook.lengthSq() < 1e-4) {
    shadowLook.set(Math.sin(state.heading), 0, Math.cos(state.heading));
  } else {
    shadowLook.normalize();
  }
  const x = Math.round((kart.position.x + shadowLook.x * SHADOW_AHEAD_M) / texel) * texel;
  const z = Math.round((kart.position.z + shadowLook.z * SHADOW_AHEAD_M) / texel) * texel;
  const y = kart.position.y;
  sun.target.position.set(x, y, z);
  sun.position.set(x + SUN_OFFSET.x, y + SUN_OFFSET.y, z + SUN_OFFSET.z);
  sun.target.updateMatrixWorld();
}

async function loadWorld(): Promise<void> {
  const loader = new GLTFLoader();
  const buffer = await (await fetchOnce(`/world.glb?${assetCacheKey}`)).arrayBuffer();
  const gltf = await loader.parseAsync(buffer, "");
  const world = gltf.scene;
  tintWorld(world);
  prepareDevTint(world);
  worldRoot.add(world);
  world.updateMatrixWorld(true);
  freezeStatic(world);
  indexGroundMeshes();
}

/** El món no es mou: sense recalcular matrius a cada fotograma. */
function freezeStatic(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
  });
}

// --- Mode dev (Maj+D): cada model de casa d'un color diferent i el camí d'un color fix ---

/** Color del camí en mode dev; les cases eviten aquesta franja de to (vegeu houseDevMaterial). */
const DEV_ROAD_COLOR = 0xffd400;
const devBadge = document.getElementById("dev-badge");
const houseTooltip = document.getElementById("house-tooltip");
const houseTooltipPhoto = houseTooltip?.querySelector("img") ?? null;
const houseTooltipMissing = houseTooltip?.querySelector<HTMLElement>(".missing") ?? null;
const houseTooltipCredit = houseTooltip?.querySelector<HTMLElement>(".credit") ?? null;
const houseTooltipStreet = houseTooltip?.querySelector<HTMLElement>(".street") ?? null;
const houseTooltipFacts = houseTooltip?.querySelector("dl") ?? null;
const houseTooltipRef = houseTooltip?.querySelector<HTMLElement>(".ref") ?? null;
let devMode = false;
/** house_id → referència cadastral (village.json). */
let houseRefs: Record<string, string> = {};
/** Referència cadastral → fitxa breu (house_cards.json). */
let houseCards: Record<string, HouseCard> = {};
/** Malles amb atribut houseId: raycast del hover en mode DEV. */
const housePickMeshes: THREE.Object3D[] = [];
const housePickRaycaster = new THREE.Raycaster();
housePickRaycaster.firstHitOnly = true;
housePickRaycaster.layers.enable(DETAIL_LAYER);
const housePickNdc = new THREE.Vector2();
/** Centres 3D de cada casa (malla estàtica) per posar el tooltip DEV al mig de la casa. */
let houseCenters = new Map<number, THREE.Vector3>();
const houseTooltipProj = new THREE.Vector3();
let devHoverHouseId = 0;
let devTooltipCopyTimer: ReturnType<typeof setTimeout> | null = null;
let devTooltipHideTimer: ReturnType<typeof setTimeout> | null = null;
/** Foto que ja hem demanat, per no recarregar-la a cada fotograma. */
let houseTooltipPhotoUrl = "";
/** Malles que canvien de material en mode dev, amb el material normal per tornar-hi. */
const devTinted: { mesh: THREE.Mesh; normal: THREE.Material | THREE.Material[]; dev: THREE.Material }[] = [];

/**
 * Pinta cada vèrtex segons l'identificador de casa que hi posa el pipeline (atribut glTF `_HOUSE`,
 * vegeu village.py): totes les peces d'una casa (parets, teulada, façana, finestres) surten del
 * mateix color. `shade` enfosqueix teulades i detalls perquè es llegeixi la forma.
 */
function houseDevMaterial(shade: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setScalar(shade),
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHideHouse = hideHouseUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float houseId;\nvarying float vHouseId;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHouseId = houseId;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vHouseId;
uniform float uHideHouse;
vec3 abrHouseColor(float id) {
  id = floor(id + 0.5);
  if (id < 0.5) {
    return vec3(0.3); // no és cap casa
  }
  // Proporció àuria: identificadors consecutius (cases veïnes) queden amb tons ben separats.
  // Se salta la franja groga (0,10–0,20), que és la del camí.
  float h = fract(id * 0.61803399) * 0.9;
  h += step(0.1, h) * 0.1;
  float s = 0.55 + 0.4 * fract(id * 0.75487767);
  float v = 0.65 + 0.35 * fract(id * 0.56984029);
  vec3 rgb = v * mix(vec3(1.0), clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0), s);
  return pow(rgb, vec3(2.2));
}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
#ifdef ABR_HIDE_HOUSE
if (uHideHouse > 0.5 && abs(vHouseId - uHideHouse) < 0.5) discard;
#endif`,
      )
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= abrHouseColor(vHouseId);");
  };
  houseHideMaterials.push(mat);
  return mat;
}

/** Prepara els materials del mode dev de les cases (les que porten identificador) i de la calçada. */
function prepareDevTint(root: THREE.Object3D): void {
  const road = new THREE.MeshStandardMaterial({ color: DEV_ROAD_COLOR, roughness: 0.9 });
  const house = { building: houseDevMaterial(1), roof: houseDevMaterial(0.72), prop: houseDevMaterial(0.85) };
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const kind = surfaceKind(mesh);
    const houseIds = mesh.geometry.getAttribute("_house");
    let dev: THREE.Material | null = null;
    if (kind === "road") {
      dev = road;
    } else if (houseIds && (kind === "building" || kind === "roof" || kind === "prop")) {
      // El GLTFLoader el deixa com a `_house`; amb un nom normal per al shader.
      mesh.geometry.setAttribute("houseId", houseIds);
      mesh.geometry.deleteAttribute("_house");
      housePickMeshes.push(mesh);
      if (!mesh.geometry.boundsTree) {
        mesh.userData.lazyBvh = true;
      }
      dev = house[kind];
    }
    if (dev) {
      devTinted.push({ mesh, normal: mesh.material, dev });
    }
  });
  houseCenters = buildHouseCenters(housePickMeshes);
}

/** Durada del fade, igual que la transició d'opacitat de `#house-tooltip`. */
const HOUSE_TOOLTIP_FADE_MS = 180;
let houseTooltipFadeOut: ReturnType<typeof setTimeout> | null = null;
/** Cert mentre la fitxa s'ha de veure (inclou el fade-in). El fade-out el deixa a fals. */
let houseTooltipShown = false;

function showHouseTooltip(): void {
  if (!houseTooltip) {
    return;
  }
  if (houseTooltipFadeOut) {
    clearTimeout(houseTooltipFadeOut);
    houseTooltipFadeOut = null;
  }
  const start = !houseTooltipShown;
  houseTooltipShown = true;
  houseTooltip.toggleAttribute("hidden", false);
  if (!start) {
    houseTooltip.classList.add("visible");
    return;
  }
  // Un fotograma a opacitat 0, i després el fade-in. Si mentrestant s'amaga, no apareix.
  houseTooltip.classList.remove("visible");
  void houseTooltip.offsetWidth;
  requestAnimationFrame(() => {
    if (houseTooltipShown) {
      houseTooltip?.classList.add("visible");
    }
  });
}

function hideHouseTooltip(): void {
  if (!houseTooltip || !houseTooltipShown) {
    return;
  }
  houseTooltipShown = false;
  houseTooltip.classList.remove("copied");
  houseTooltip.classList.remove("visible");
  if (houseTooltipRef && houseTooltip.dataset.ref) {
    houseTooltipRef.textContent = houseTooltip.dataset.ref;
  }
  if (houseTooltipFadeOut) {
    clearTimeout(houseTooltipFadeOut);
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  houseTooltipFadeOut = setTimeout(() => {
    houseTooltipFadeOut = null;
    if (!houseTooltipShown) {
      houseTooltip?.toggleAttribute("hidden", true);
    }
  }, reduce ? 0 : HOUSE_TOOLTIP_FADE_MS);
}

function cancelDevTooltipHide(): void {
  if (devTooltipHideTimer) {
    clearTimeout(devTooltipHideTimer);
    devTooltipHideTimer = null;
  }
}

/** Deixa un instant per passar del model al requadre i poder-hi fer clic. */
function scheduleDevTooltipHide(): void {
  if (devTooltipHideTimer || !devHoverHouseId) {
    return;
  }
  devTooltipHideTimer = setTimeout(() => {
    devTooltipHideTimer = null;
    devHoverHouseId = 0;
    hideHouseTooltip();
  }, 280);
}

function clearDevHouseHover(): void {
  cancelDevTooltipHide();
  devHoverHouseId = 0;
  hideHouseTooltip();
}

function addHouseFact(label: string, value: string): void {
  if (!houseTooltipFacts) {
    return;
  }
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  houseTooltipFacts.append(dt, dd);
}

function showHousePhoto(ok: boolean): void {
  if (houseTooltipPhoto) {
    houseTooltipPhoto.hidden = !ok;
  }
  if (houseTooltipMissing) {
    houseTooltipMissing.hidden = ok;
  }
  if (houseTooltipCredit) {
    houseTooltipCredit.hidden = !ok;
  }
}

function setHousePhoto(photo: string, ref: string): void {
  if (!houseTooltipPhoto || photo === houseTooltipPhotoUrl) {
    return;
  }
  houseTooltipPhotoUrl = photo;
  if (!photo) {
    houseTooltipPhoto.removeAttribute("src");
    showHousePhoto(false);
    return;
  }
  const token = photo;
  houseTooltipPhoto.hidden = true;
  if (houseTooltipMissing) {
    houseTooltipMissing.hidden = true;
  }
  if (houseTooltipCredit) {
    houseTooltipCredit.hidden = true;
  }
  houseTooltipPhoto.alt = `Façana de ${ref}`;
  houseTooltipPhoto.onload = () => {
    if (houseTooltipPhotoUrl === token) {
      showHousePhoto(true);
    }
  };
  houseTooltipPhoto.onerror = () => {
    if (houseTooltipPhotoUrl === token) {
      showHousePhoto(false);
    }
  };
  houseTooltipPhoto.src = photo;
}

/** Omple la fitxa. No es torna a cridar mentre el ratolí segueix sobre la mateixa casa. */
function renderHouseCard(ref: string): void {
  if (!houseTooltip || !houseTooltipRef || !houseTooltipFacts || !houseTooltipStreet) {
    return;
  }
  houseTooltip.dataset.ref = ref;
  houseTooltip.classList.remove("copied");
  houseTooltipRef.textContent = ref;
  const card = houseCards[ref];
  houseTooltipStreet.textContent = card?.street ?? "";
  houseTooltipFacts.replaceChildren();
  if (card?.use) {
    addHouseFact("Ús", card.use);
  }
  if (card?.year) {
    addHouseFact("Any", String(card.year));
  }
  if (card?.floors) {
    addHouseFact("Plantes", String(card.floors));
  }
  if (card?.areaM2) {
    addHouseFact("Construïts", `${card.areaM2} m²`);
  }
  if (card?.dwellings != null) {
    addHouseFact("Habitatges", String(card.dwellings));
  }
  if (card?.parts) {
    addHouseFact("Parts", String(card.parts));
  }
  if (card?.condition) {
    addHouseFact("Estat", card.condition);
  }
  if (card?.model) {
    addHouseFact("Model", card.model);
  }
  setHousePhoto(card?.photo ?? "", ref);
}

/** Coloca la fitxa vora el centre projectat de la casa (no segueix el ratolí). */
function positionDevHouseTooltip(): void {
  if (!devMode || !devHoverHouseId || !houseTooltip) {
    return;
  }
  const ref = resolveHouseRef(houseRefs, devHoverHouseId);
  if (!ref) {
    clearDevHouseHover();
    return;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  const pos = houseCenterToClient(houseCenters, devHoverHouseId, camera, rect, houseTooltipProj);
  if (!pos) {
    hideHouseTooltip();
    return;
  }
  if (houseTooltip.dataset.ref !== ref) {
    renderHouseCard(ref);
  }
  showHouseTooltip();
  const w = houseTooltip.offsetWidth;
  const h = houseTooltip.offsetHeight;
  const margin = 12;
  // El HUD de baix (velocímetre, FPS i el rètol DEV) i el minimapa de dalt a la dreta.
  const bottomHud = 132;
  const miniLeft = window.innerWidth - 16 - 200;
  let left = pos.x - w / 2;
  let top = pos.y - h - 18;
  if (top < margin) {
    top = pos.y + 18;
  }
  const maxTop = Math.max(margin, window.innerHeight - h - bottomHud);
  top = Math.min(Math.max(top, margin), maxTop);
  if (top + h > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - h - margin);
  }
  left = Math.min(Math.max(left, margin), window.innerWidth - w - margin);
  if (top < 16 + 200 && left + w > miniLeft) {
    left = Math.max(margin, miniLeft - w - 8);
  }
  houseTooltip.style.left = `${Math.round(left)}px`;
  houseTooltip.style.top = `${Math.round(top)}px`;
}

function pickHouse(clientX: number, clientY: number): { ref: string; houseId: number } | null {
  if (!housePickMeshes.length) {
    return null;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  housePickNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  housePickRaycaster.setFromCamera(housePickNdc, camera);
  const hits = housePickRaycaster.intersectObjects(housePickMeshes, false);
  if (!hits.length) {
    return null;
  }
  const houseId = houseIdFromHit(hits[0]);
  const ref = resolveHouseRef(houseRefs, houseId);
  if (!ref) {
    return null;
  }
  return { ref, houseId };
}

function onDevHousePointerMove(e: PointerEvent): void {
  if (!devMode || bigMapOpen || optionsOpen) {
    clearDevHouseHover();
    return;
  }
  const hit = pickHouse(e.clientX, e.clientY);
  if (hit) {
    cancelDevTooltipHide();
    devHoverHouseId = hit.houseId;
    positionDevHouseTooltip();
  } else {
    scheduleDevTooltipHide();
  }
}

function onDevPointerLeaveCanvas(e: PointerEvent): void {
  const rel = e.relatedTarget;
  if (rel instanceof Node && houseTooltip?.contains(rel)) {
    return;
  }
  scheduleDevTooltipHide();
}

function onDevPointerLeaveTooltip(e: PointerEvent): void {
  const rel = e.relatedTarget;
  if (rel === renderer.domElement) {
    return;
  }
  scheduleDevTooltipHide();
}

async function copyDevHouseRef(): Promise<void> {
  if (!houseTooltip || !houseTooltipRef || houseTooltip.hasAttribute("hidden")) {
    return;
  }
  const ref = houseTooltip.dataset.ref;
  if (!ref) {
    return;
  }
  try {
    await navigator.clipboard.writeText(ref);
  } catch {
    return;
  }
  houseTooltipRef.textContent = "Copiat";
  houseTooltip.classList.add("copied");
  if (devTooltipCopyTimer) {
    clearTimeout(devTooltipCopyTimer);
  }
  devTooltipCopyTimer = setTimeout(() => {
    devTooltipCopyTimer = null;
    if (houseTooltipRef && houseTooltip?.dataset.ref === ref) {
      houseTooltipRef.textContent = ref;
      houseTooltip.classList.remove("copied");
    }
  }, 1200);
}

function setDevMode(on: boolean): void {
  devMode = on;
  for (const t of devTinted) {
    t.mesh.material = on ? t.dev : t.normal;
  }
  devBadge?.toggleAttribute("hidden", !on);
  if (!on) {
    clearDevHouseHover();
  }
  lastMinimapRender = -Infinity; // el minimapa també es pinta amb els colors del mode dev
}

renderer.domElement.addEventListener("pointermove", onDevHousePointerMove);
renderer.domElement.addEventListener("pointerleave", onDevPointerLeaveCanvas);
houseTooltip?.addEventListener("pointerenter", () => cancelDevTooltipHide());
houseTooltip?.addEventListener("pointerleave", onDevPointerLeaveTooltip);
houseTooltip?.addEventListener("click", () => {
  void copyDevHouseRef();
});

// --- Minimapa: vista cenital orientada amb el kart, zoom segons la velocitat ---

const MINIMAP_PX = 200;
const MINIMAP_MARGIN = 16;
const MINIMAP_HALF_SLOW = 45;
const MINIMAP_HALF_FAST = 110;
/** Velocitat (m/s) a partir de la qual el minimapa ja és al zoom més llunyà (~90 km/h). */
const MINIMAP_FAST_SPEED = 25;
const MINIMAP_BG = new THREE.Color(0x26302a);
const LABEL_SPACING_M = 35;

type WaterwayLine = { kind: string; width: number; points: [number, number][] };
type StreetsFile = {
  streets: { name: string; points: [number, number][] }[];
  roads?: [number, number][][];
  waterways?: WaterwayLine[];
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
const waterPolylines: WaterwayLine[] = [];
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
  const res = await fetchOnce(`/streets.json?${assetCacheKey}`);
  if (!res.ok) {
    return;
  }
  const data = (await res.json()) as StreetsFile;
  roadPolylines.push(...(data.roads ?? data.streets.map((s) => s.points)));
  waterPolylines.push(...(data.waterways ?? []));
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

function drawWaterways(
  ctx: CanvasRenderingContext2D,
  toPx: (x: number, z: number, out: THREE.Vector3) => THREE.Vector3,
  size: number,
  viewHalf: number,
  dpr: number,
): void {
  if (waterPolylines.length === 0) {
    return;
  }
  const mPerPx = (2 * viewHalf) / size;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const course of waterPolylines) {
    const pts = course.points;
    if (pts.length < 2) {
      continue;
    }
    // Traç fi i poc opac: només un indici, no un riu destacat sobre el terreny.
    const lw = Math.max(1.2 * dpr, course.width / mPerPx * 0.7);
    ctx.beginPath();
    pts.forEach(([px, pz], i) => {
      const q = toPx(px, pz, projB);
      if (i === 0) {
        ctx.moveTo(q.x, q.y);
      } else {
        ctx.lineTo(q.x, q.y);
      }
    });
    ctx.strokeStyle = "rgba(40, 90, 105, 0.35)";
    ctx.lineWidth = lw + 1 * dpr;
    ctx.stroke();
    ctx.strokeStyle = "rgba(90, 150, 170, 0.4)";
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.restore();
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
  drawWaterways(ctx, (x, z, out) => toMinimapPx(x, y, z, out, size), size, minimapHalf, dpr);

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
  // El canvas és circular (border-radius): el distintiu ha de cabre sencer a dins.
  const badgeR = 11 * dpr;

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

  const nx = Math.cos(north) * (ring - badgeR);
  const ny = Math.sin(north) * (ring - badgeR);
  ctx.beginPath();
  ctx.arc(nx, ny, badgeR, 0, Math.PI * 2);
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

/** Vista de mapa sense boira visible. No es pot posar `scene.fog = null`: Three reutilitza programes
 * sense uniforms de boira i el render següent petarà a `refreshFogUniforms`. */
function beginMapView(): () => void {
  const background = scene.background;
  scene.background = MINIMAP_BG;
  const fog = scene.fog;
  let restoreFog = () => {};
  if (fog && (fog as THREE.Fog).isFog) {
    const linear = fog as THREE.Fog;
    const near = linear.near;
    const far = linear.far;
    linear.near = 1e7;
    linear.far = 1e7 + 1;
    restoreFog = () => {
      linear.near = near;
      linear.far = far;
    };
  }
  return () => {
    restoreFog();
    scene.background = background;
  };
}

function renderMinimap(now: number): void {
  if (now - lastMinimapRender >= MINIMAP_INTERVAL_MS) {
    lastMinimapRender = now;
    const endMapView = beginMapView();
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(minimapTarget);
    renderer.render(scene, minimapCam);
    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = true;
    endMapView();
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
  // Vista cenital fixa com un mapa oficial: nord (−Z) sempre amunt, est (+X) a la dreta.
  // Es torna a renderitzar a cada zoom perquè es vegi nítid, no com una imatge ampliada.
  clampMapView();
  bigMapCam.left = -mapViewHalf;
  bigMapCam.right = mapViewHalf;
  bigMapCam.top = mapViewHalf;
  bigMapCam.bottom = -mapViewHalf;
  bigMapCam.position.set(mapViewX, 300, mapViewZ);
  // up = −Z → el nord queda al mig de la vora superior (no gira amb el kart).
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
  const endMapView = beginMapView();
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
  endMapView();
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

/** Rosa dels vents fixa al mig de dalt: el mapa gran sempre té el nord amunt. */
function drawBigMapNorth(ctx: CanvasRenderingContext2D, size: number, dpr: number): void {
  const cx = size / 2;
  // Deixa marge perquè el distintiu N no es talli amb la vora superior.
  const cy = 40 * dpr;
  const needle = 14 * dpr;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.shadowColor = "rgba(0,0,0,.75)";
  ctx.shadowBlur = 5 * dpr;

  // Agulla: meitat nord vermella, meitat sud blanca.
  ctx.beginPath();
  ctx.moveTo(0, -needle);
  ctx.lineTo(5.5 * dpr, 1 * dpr);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fillStyle = "#d8322b";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -needle);
  ctx.lineTo(-5.5 * dpr, 1 * dpr);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fillStyle = "#9a1e18";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, needle * 0.65);
  ctx.lineTo(5.5 * dpr, 1 * dpr);
  ctx.lineTo(-5.5 * dpr, 1 * dpr);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,.95)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -needle - 11 * dpr, 11 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = "#d8322b";
  ctx.fill();
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = "rgba(255,255,255,.95)";
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${12 * dpr}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", 0, -needle - 11 * dpr + 0.5 * dpr);
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
  drawWaterways(ctx, (x, z, out) => worldToMapPx(x, z, out), size, mapViewHalf, dpr);
  drawStreetLabels(ctx, worldToMapPx, dpr, (p, w) => p.x > w / 2 && p.x < size - w / 2 && p.y > 8 && p.y < size - 8, 13);

  const k = worldToMapPx(kart.position.x, kart.position.z, projA);
  drawArrow(ctx, k.x, k.y, state.heading, dpr * 1.2, "#f5c518");
  drawScaleBar(ctx, size, dpr);
  drawBigMapNorth(ctx, size, dpr);

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
  state.accelPitch = 0;
  state.driftAngle = 0;
  clearImpact();
  state.heading = pick.heading;
  kart.rotation.y = pick.heading;
  const y = sampleRoadY(pick.x, pick.z) ?? kart.position.y - state.wheelOffset;
  kart.position.set(pick.x, y + state.wheelOffset, pick.z);
  autopilot?.reset();
  // Càmera directament darrere el cotxe, sense travessar el poble lliscant.
  placeCameraBehindKart();
}

/** R: torna al punt conduïble més proper d'on és el cotxe (eix del carrer més proper, en el
 *  sentit de la marxa). Sense carrers carregats, el punt conduïble més proper al voltant. */
function respawnNearby(): void {
  const pick = nearestRoadPoint(kart.position.x, kart.position.z);
  const heading = pick?.heading ?? state.heading;
  const [x, z] = snapToDrivableRoad(pick?.x ?? kart.position.x, pick?.z ?? kart.position.z, heading);
  respawnAt({ x, z, heading, dist: 0 });
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

// --- Moviment: lliure pel terreny; només xoca amb models 3D (cases, tàpies, arbres) ---

// Desviacions (radians) provades quan el moviment recte xoca amb una paret o un tronc.
const SLIDE_OFFSETS = [0, 0.2, -0.2, 0.45, -0.45, 0.8, -0.8, 1.2, -1.2];
const STUCK_SECONDS = 1.0;
let stuckTime = 0;

/**
 * Cop contra una paret o un tronc. La carrosseria és una molla: el para-xocs clava,
 * el cul s'aixeca i trontolla, i un xoc de biaix fa sortir la cua.
 * Rotació X positiva abaixa el morro (el cul puja). `side` > 0 tomba cap a la dreta del cotxe.
 */
const impactBody = {
  pitch: 0,
  pitchVel: 0,
  roll: 0,
  rollVel: 0,
  /** Gir residual (rad/s) que continua desviant el morro després del cop. */
  yawRate: 0,
};
const IMPACT_PITCH_K = 68;
const IMPACT_PITCH_C = 3.6;
const IMPACT_ROLL_K = 110;
const IMPACT_ROLL_C = 4.4;
const IMPACT_MIN_SPEED = 2.4;
/** Segons amb el volant esponjós i el derrapatge que no s'agafa. */
let impactLoose = 0;
let impactCooldown = 0;
/** Ja estem en contacte: el següent fotograma frega, no és un cop nou. */
let impactContact = false;
/** Metres que el cotxe s'ha aixecat pel cop; no compten com a salt. */
let appliedBodyLift = 0;

function clearImpact(): void {
  impactBody.pitch = 0;
  impactBody.pitchVel = 0;
  impactBody.roll = 0;
  impactBody.rollVel = 0;
  impactBody.yawRate = 0;
  impactLoose = 0;
  impactCooldown = 0;
  impactContact = false;
  appliedBodyLift = 0;
}

/** +1 si el cop ha d'enviar la cua cap a la dreta (volant a la dreta, o ja derrapant). */
function impactSide(): number {
  if (Math.abs(state.steer) > 0.2) {
    return Math.sign(state.steer);
  }
  if (Math.abs(state.driftAngle) > 0.12) {
    return Math.sign(state.driftAngle);
  }
  return Math.random() < 0.5 ? -1 : 1;
}

/** Gira el morro sense ficar-lo dins la paret. El derrapatge es queda: el cotxe queda creuat. */
function applyImpactYaw(yaw: number): void {
  if (Math.abs(yaw) < 1e-5) {
    return;
  }
  const next = state.heading + yaw;
  const pos = kart.position;
  const embedded = bodyHitsWall(pos.x, pos.y, pos.z, state.heading);
  if (!embedded && bodyHitsWall(pos.x, pos.y, pos.z, next)) {
    return;
  }
  state.heading = next;
  state.driftAngle = THREE.MathUtils.clamp(state.driftAngle - yaw * 0.82, -1.2, 1.2);
}

/**
 * `headOn` 1 = de cara, ~0 = frec. `kind` "scrape" només fa trontollar, sense rebot ni gir.
 * Retorna si el cop ha agafat (prou velocitat i fora de la pausa entre cops).
 */
function kickImpact(speed: number, headOn: number, side: number, kind: "hit" | "scrape"): boolean {
  const v = Math.abs(speed);
  if (v < IMPACT_MIN_SPEED || impactCooldown > 0) {
    return false;
  }
  const strength = THREE.MathUtils.clamp((v - IMPACT_MIN_SPEED) / 12, 0, 1);
  const forward = Math.sign(speed) || 1;
  const shove = kind === "hit" ? 1 : 0.35;
  // De cara, el davant clava i el cul puja; marxa enrere, al revés.
  impactBody.pitchVel += forward * (0.8 + 2.6 * headOn) * strength * shove;
  impactBody.rollVel += side * (1.2 + 2.0 * headOn) * strength * shove;
  impactBody.rollVel += (Math.random() - 0.5) * strength * 1.5 * shove;
  impactBody.pitchVel += (Math.random() - 0.5) * strength * 0.7 * shove;

  if (kind === "hit" && headOn > 0.34) {
    const yawKick = side * strength * (headOn - 0.2) * 0.9;
    impactBody.yawRate += yawKick * 2.6;
    applyImpactYaw(yawKick * 0.25);
    impactLoose = Math.max(impactLoose, 0.25 + 0.7 * strength * headOn);
  }

  if (kind === "hit" && headOn >= 0.72) {
    // Rebot: se separa de la paret en lloc de quedar-hi enganxat.
    state.speed = -forward * Math.min(6.5, v * (0.14 + 0.26 * strength));
  } else if (kind === "hit" && headOn > 0.45) {
    state.speed *= 1 - 0.4 * strength * headOn;
  }

  impactCooldown = kind === "hit" ? 0.22 + 0.2 * headOn : 0.14;
  return true;
}

function springImpact(
  pos: "pitch" | "roll",
  vel: "pitchVel" | "rollVel",
  k: number,
  c: number,
  limit: number,
  dt: number,
): void {
  impactBody[vel] += (-k * impactBody[pos] - c * impactBody[vel]) * dt;
  impactBody[pos] += impactBody[vel] * dt;
  if (impactBody[pos] > limit) {
    impactBody[pos] = limit;
    impactBody[vel] = Math.min(0, impactBody[vel]);
  } else if (impactBody[pos] < -limit) {
    impactBody[pos] = -limit;
    impactBody[vel] = Math.max(0, impactBody[vel]);
  }
}

/** Metres que cal pujar el centre perquè el cap que baixa continuï tocant a terra. */
function impactBodyLift(): number {
  return (
    Math.sin(Math.abs(impactBody.pitch)) * (R12.lengthM * 0.5) +
    Math.sin(Math.abs(impactBody.roll)) * (R12.widthM * 0.5)
  );
}

function updateImpact(dt: number): void {
  impactCooldown = Math.max(0, impactCooldown - dt);
  impactLoose = Math.max(0, impactLoose - dt);
  springImpact("pitch", "pitchVel", IMPACT_PITCH_K, IMPACT_PITCH_C, 0.36, dt);
  springImpact("roll", "rollVel", IMPACT_ROLL_K, IMPACT_ROLL_C, 0.42, dt);
  if (Math.abs(impactBody.yawRate) < 1e-3) {
    impactBody.yawRate = 0;
    return;
  }
  applyImpactYaw(impactBody.yawRate * dt);
  impactBody.yawRate *= Math.exp(-2.2 * dt);
}

function moveCar(move: number, dt: number): number {
  if (Math.abs(move) < 1e-5) {
    impactContact = false;
    return 0;
  }
  const travelSign = Math.sign(move);
  const pos = kart.position;
  // Si la carrosseria ja és encastada (aparició, aterratge), només es vigila el centre perquè en pugui sortir.
  const embedded = bodyHitsWall(pos.x, pos.y, pos.z, state.heading);
  const dir = new THREE.Vector3();
  for (const off of SLIDE_OFFSETS) {
    // Derrapant, el cotxe avança cap on va la marxa però ocupa l'espai segons on mira el morro.
    const h = state.heading + off;
    const travel = h + state.driftAngle;
    dir.set(Math.sin(travel) * travelSign, 0, Math.cos(travel) * travelSign);
    const dist = Math.abs(move) * Math.cos(off);
    const nx = pos.x + dir.x * dist;
    const nz = pos.z + dir.z * dist;
    // Fregant, el morro només gira una part de la desviació en aquest fotograma.
    const nextHeading = state.heading + off * Math.min(1, 6 * dt);
    if (
      embedded
        ? blockedByWall(pos, dir, WALL_CHECK_M + dist * 1.2)
        : bodyHitsWall(nx, pos.y, nz, nextHeading)
    ) {
      continue;
    }
    if (!canOccupy(nx, nz, h)) {
      continue;
    }
    pos.x = nx;
    pos.z = nz;
    if (off === 0) {
      impactContact = false;
      return dist;
    }
    // Alinea el cotxe amb l'obstacle i frega una mica, en lloc d'aturar-lo en sec.
    state.heading = nextHeading;
    kart.rotation.y = state.heading;
    const scrape = Math.abs(Math.sin(off));
    state.speed *= Math.exp(-5 * scrape * dt);
    const deflect = Math.min(1, Math.abs(off) / 1.2);
    const side = Math.sign(off) || impactSide();
    if (!impactContact) {
      kickImpact(state.speed, 0.22 + 0.55 * deflect, side, "hit");
      impactContact = true;
    } else if (scrape > 0.15) {
      kickImpact(state.speed, 0.15, side, "scrape");
    }
    // Un frec lleuger assenta el derrapatge; un cop de biaix el deixa creuat.
    if (Math.abs(off) < 0.4) {
      state.driftAngle *= Math.exp(-4 * dt);
    }
    return dist;
  }
  const side = impactSide();
  const kicked = kickImpact(state.speed, impactContact ? 0.45 : 1, side, impactContact ? "scrape" : "hit");
  impactContact = true;
  if (!kicked) {
    state.speed *= 0.35;
    state.driftAngle *= 0.6;
  }
  return 0;
}

function unstick(direction: number): void {
  const pos = kart.position;
  if (!canOccupy(pos.x, pos.z, state.heading)) {
    const [sx, sz] = snapToDrivableRoad(pos.x, pos.z, state.heading);
    pos.x = sx;
    pos.z = sz;
  }
  // L'orientació lliure més propera a l'actual, en el sentit en què s'accelera.
  // Primer, una orientació on hi càpiga la carrosseria sencera; si no n'hi ha, n'hi ha prou amb el centre.
  const dir = new THREE.Vector3();
  for (const wholeBody of [true, false]) {
    for (let step = 1; step <= 12; step++) {
      for (const sign of [1, -1]) {
        const h = state.heading + sign * step * (Math.PI / 12);
        dir.set(Math.sin(h) * direction, 0, Math.cos(h) * direction);
        const nx = pos.x + dir.x * 1.5;
        const nz = pos.z + dir.z * 1.5;
        if (
          canOccupy(nx, nz, h) &&
          !blockedByWall(pos, dir, 2) &&
          !(wholeBody && bodyHitsWall(nx, pos.y, nz, h))
        ) {
          state.heading = h;
          state.driftAngle = 0;
          kart.rotation.y = h;
          return;
        }
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
const DRIVE_KEYS = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];

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
    brake: false,
  };
}

const speedometer = document.getElementById("speedometer");

let speedometerText = "";

function updateSpeedometer(): void {
  const kmh = Math.round(Math.abs(state.speed) * 3.6);
  const text = state.speed < -0.3 ? `R ${kmh} km/h` : `${kmh} km/h`;
  // Escriure el DOM a cada fotograma força recalcular estils i maquetació encara que no canviï.
  if (speedometer && text !== speedometerText) {
    speedometerText = text;
    speedometer.textContent = text;
  }
}

const hudEl = document.getElementById("hud");
const hudCoordsEl = document.getElementById("hud-coords");
let hudCoordsText = "";
let hudCoordsClipboard = "";
let hudCoordsCopiedUntil = 0;

/** Rumb geogràfic 0–360° (0 = nord UTM/−Z, 90 = est/+X). El heading del joc 0 apunta al sud (+Z). */
function geographicHeadingDeg(): number {
  const deg = THREE.MathUtils.radToDeg(Math.atan2(Math.sin(state.heading), -Math.cos(state.heading)));
  return ((deg % 360) + 360) % 360;
}

function formatHudCoords(): { display: string; clipboard: string } {
  const heading = geographicHeadingDeg();
  const headingLabel = `${heading.toFixed(0)}°`;
  if (worldOriginUtm) {
    const e = worldOriginUtm.x + kart.position.x;
    const n = worldOriginUtm.y - kart.position.z;
    const alt = kart.position.y;
    const display = `E ${e.toFixed(1)} · N ${n.toFixed(1)} · ${alt.toFixed(1)} m · ${headingLabel}`;
    const clipboard = `${e.toFixed(1)}, ${n.toFixed(1)}, ${alt.toFixed(1)}, ${heading.toFixed(0)}`;
    return { display, clipboard };
  }
  const { x, y, z } = kart.position;
  const display = `X ${x.toFixed(1)} · Z ${z.toFixed(1)} · Y ${y.toFixed(1)} m · ${headingLabel}`;
  const clipboard = `${x.toFixed(1)}, ${z.toFixed(1)}, ${y.toFixed(1)}, ${heading.toFixed(0)}`;
  return { display, clipboard };
}

function updateHudCoords(): void {
  if (!hudCoordsEl) {
    return;
  }
  const { display, clipboard } = formatHudCoords();
  hudCoordsClipboard = clipboard;
  if (performance.now() < hudCoordsCopiedUntil) {
    return;
  }
  if (display !== hudCoordsText) {
    hudCoordsText = display;
    hudCoordsEl.textContent = display;
  }
}

async function copyHudCoords(): Promise<void> {
  if (!hudCoordsClipboard || !hudCoordsEl) {
    return;
  }
  try {
    await navigator.clipboard.writeText(hudCoordsClipboard);
  } catch {
    return;
  }
  hudCoordsCopiedUntil = performance.now() + 1200;
  hudCoordsEl.textContent = "Copiat al porta-retalls";
  hudEl?.classList.add("copied");
  window.setTimeout(() => {
    hudEl?.classList.remove("copied");
    hudCoordsCopiedUntil = 0;
    hudCoordsText = "";
    updateHudCoords();
  }, 1200);
}

hudEl?.addEventListener("click", () => {
  void copyHudCoords();
});

// --- Càmera orbital: O/L amunt/avall, K/Ñ esquerra/dreta; en accelerar torna darrere el cotxe ---
// Z alterna la perspectiva (distància, inclinació i camp). L'òrbita és dins de la perspectiva activa.

const CAM_MIN_PITCH = 0.05; // gairebé arran de terra
const CAM_MAX_PITCH = 1.35; // gairebé zenital
// A marxa ràpida la càmera s'allunya, s'inclina (mira més avall) i eixampla una mica
// el camp. El centre es queda llegible; el desenfoc de la marxa va als marges.
// A ple efecte, cap a ~115 km/h.
const CAM_SPEED_MIN = 4;
const CAM_SPEED_FULL = 32;
/** Metres extres de distància a ple efecte. */
const CAM_SPEED_EXTRA_DIST = 4.2;
/** Inclinació extra (rad) a ple efecte, per damunt de la perspectiva. */
const CAM_SPEED_PITCH = 0.22;
/** Graus extra de camp vertical a ple efecte. */
const CAM_SPEED_FOV = 7;
const CAM_KEY_YAW_RATE = 1.8; // rad/s
const CAM_KEY_PITCH_RATE = 0.9;
// "Velocitat mitja" de retorn: ~80°/s de gir i ~35°/s d'inclinació.
const CAM_RECENTER_YAW_RATE = 1.4;
const CAM_RECENTER_PITCH_RATE = 0.6;
/** `yaw`: gir respecte de darrere el cotxe (negatiu = cap a l'esquerra del cotxe). */
const cameraOrbit = { yaw: 0, pitch: camPresetPitch() };
/** Mirada i camp que s'acosten a la perspectiva triada; la posició ja es interpola a part. */
const camBlend = {
  lookUp: camPreset().lookUp,
  lookAhead: camPreset().lookAhead,
  fov: camPreset().fov,
};

function approach(value: number, target: number, maxStep: number): number {
  return value + THREE.MathUtils.clamp(target - value, -maxStep, maxStep);
}

function updateCameraOrbit(dt: number, throttle: number): void {
  const left = keys.has("k");
  const right = keys.has("ñ") || keys.has("semicolon");
  const up = keys.has("l");
  const lower = keys.has("o");
  // K porta la càmera cap a la dreta del cotxe (yaw positiu) i Ñ cap a l'esquerra.
  if (left) cameraOrbit.yaw += CAM_KEY_YAW_RATE * dt;
  if (right) cameraOrbit.yaw -= CAM_KEY_YAW_RATE * dt;
  // L baixa la càmera cap a arran de terra (la vista "puja" cap a l'horitzó); O la puja cap a zenital.
  if (up) cameraOrbit.pitch -= CAM_KEY_PITCH_RATE * dt;
  if (lower) cameraOrbit.pitch += CAM_KEY_PITCH_RATE * dt;
  cameraOrbit.pitch = THREE.MathUtils.clamp(cameraOrbit.pitch, CAM_MIN_PITCH, CAM_MAX_PITCH);
  cameraOrbit.yaw = Math.atan2(Math.sin(cameraOrbit.yaw), Math.cos(cameraOrbit.yaw)); // dins (−π, π]
  if (throttle > 0 && !left && !right && !up && !lower) {
    cameraOrbit.yaw = approach(cameraOrbit.yaw, 0, CAM_RECENTER_YAW_RATE * dt);
    cameraOrbit.pitch = approach(cameraOrbit.pitch, camPresetPitch(), CAM_RECENTER_PITCH_RATE * dt);
  }
}

/** 0 aturat, 1 a partir de `CAM_SPEED_FULL`: distància, inclinació i camp de la persecució. */
function camSpeedT(): number {
  return THREE.MathUtils.smoothstep(Math.abs(state.speed), CAM_SPEED_MIN, CAM_SPEED_FULL);
}

/** Posició de la càmera respecte del cotxe segons l'òrbita, la perspectiva i la velocitat. */
function cameraOffset(heading: number, out: THREE.Vector3): THREE.Vector3 {
  const t = camSpeedT();
  const dist = camPresetDist() + CAM_SPEED_EXTRA_DIST * t;
  const pitch = THREE.MathUtils.clamp(cameraOrbit.pitch + CAM_SPEED_PITCH * t, CAM_MIN_PITCH, CAM_MAX_PITCH);
  const a = heading + cameraOrbit.yaw;
  const flat = Math.cos(pitch) * dist;
  return out.set(-Math.sin(a) * flat, Math.sin(pitch) * dist, -Math.cos(a) * flat);
}

const camOffset = new THREE.Vector3();
const camLook = new THREE.Vector3();
/** Material només per al raig: les parets es dibuixen per fora, però des de dins cal veure-hi la cara. */
const insideRayMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const insideHitNormal = new THREE.Vector3();
const INSIDE_RAYS: THREE.Vector3[] = [];
for (let i = 0; i < 8; i++) {
  const a = (i % 4) * (Math.PI / 2) + (i < 4 ? 0 : Math.PI / 4);
  INSIDE_RAYS.push(new THREE.Vector3(Math.cos(a), i < 4 ? 0 : -0.45, Math.sin(a)).normalize());
}
/** Casa dins la qual és la càmera; 0 si és al carrer. */
let insideHouseId = 0;

/**
 * Si la càmera és dins d'una casa, en torna l'identificador. Un raig que surt de dins
 * toca primer la cara interior (la normal mira cap on va el raig). Cal que diversos
 * raigs hi coincideixin: un de sol pot travessar una lògia i encertar la paret del fons.
 */
/** True si el centre de la càmera cau dins l'esfera de la malla (més grossa que la casa).
 *  L'esfera es calcula un sol cop: les cases no es mouen. */
function shellMayContainCamera(mesh: THREE.Mesh): boolean {
  let sphere = mesh.userData.shellSphere as THREE.Sphere | undefined;
  if (!sphere) {
    const geo = mesh.geometry;
    if (!geo.boundingSphere) {
      geo.computeBoundingSphere();
    }
    if (!geo.boundingSphere) {
      return false;
    }
    sphere = geo.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
    mesh.userData.shellSphere = sphere;
  }
  return sphere.containsPoint(camera.position);
}

function houseAroundCamera(): number {
  if (houseShellMeshes.length === 0) {
    return 0;
  }
  // Al carrer, cap esfera no conté la càmera: no es llença cap raig ni es toca cap material.
  const near: THREE.Mesh[] = [];
  for (const mesh of houseShellMeshes) {
    if (shellMayContainCamera(mesh)) {
      near.push(mesh);
    }
  }
  if (near.length === 0) {
    return 0;
  }
  const saved = near.map((mesh) => mesh.material);
  for (const mesh of near) {
    mesh.material = insideRayMat;
  }
  const votes = new Map<number, number>();
  try {
    for (const dir of INSIDE_RAYS) {
      raycaster.set(camera.position, dir);
      raycaster.far = 40;
      const hits = raycaster.intersectObjects(near, false);
      for (const hit of hits) {
        if (!hit.face) {
          break;
        }
        insideHitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (insideHitNormal.dot(dir) <= 0.25) {
          break;
        }
        const id = houseIdFromHit(hit);
        if (id >= 1) {
          votes.set(id, (votes.get(id) ?? 0) + 1);
          break;
        }
      }
    }
  } finally {
    near.forEach((mesh, i) => {
      mesh.material = saved[i];
    });
  }
  let bestId = 0;
  let bestVotes = 0;
  for (const [id, count] of votes) {
    if (count > bestVotes) {
      bestId = id;
      bestVotes = count;
    }
  }
  return bestVotes >= 3 ? bestId : 0;
}

function applyCamBlend(dt: number, snap = false): void {
  const preset = camPreset();
  if (snap) {
    camBlend.lookUp = preset.lookUp;
    camBlend.lookAhead = preset.lookAhead;
    camBlend.fov = preset.fov;
  } else {
    const k = 1 - Math.exp(-4 * dt);
    camBlend.lookUp += (preset.lookUp - camBlend.lookUp) * k;
    camBlend.lookAhead += (preset.lookAhead - camBlend.lookAhead) * k;
    camBlend.fov += (preset.fov - camBlend.fov) * k;
    if (Math.abs(preset.lookUp - camBlend.lookUp) < 0.01) {
      camBlend.lookUp = preset.lookUp;
    }
    if (Math.abs(preset.lookAhead - camBlend.lookAhead) < 0.02) {
      camBlend.lookAhead = preset.lookAhead;
    }
    if (Math.abs(preset.fov - camBlend.fov) < 0.05) {
      camBlend.fov = preset.fov;
    }
  }
  const fov = camBlend.fov + CAM_SPEED_FOV * camSpeedT();
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

function aimCamera(heading: number): void {
  camLook.set(
    kart.position.x + Math.sin(heading) * camBlend.lookAhead,
    kart.position.y + camBlend.lookUp,
    kart.position.z + Math.cos(heading) * camBlend.lookAhead,
  );
  camera.lookAt(camLook);
}

/** Z: normal → oberta → curses. Torna a quedar darrere el cotxe, amb la inclinació d'aquella vista. */
function cycleCameraPreset(): void {
  camPresetIndex = (camPresetIndex + 1) % CAM_PRESETS.length;
  cameraOrbit.yaw = 0;
  cameraOrbit.pitch = camPresetPitch();
  motionBlur.reset();
}

function placeCameraBehindKart(): void {
  cameraOrbit.yaw = 0;
  cameraOrbit.pitch = camPresetPitch();
  applyCamBlend(0, true);
  camera.position.copy(kart.position).add(cameraOffset(state.heading, camOffset));
  aimCamera(state.heading);
  motionBlur.reset();
}

// Fora de l'asfalt el cotxe roda pitjor i no hi pot anar gaire de pressa: al camp de terra una
// mica, i fora de camí (herba, rostolls, terra llaurada) bastant més.
const SURFACE_DRAG: Record<Surface, { drag: number; maxSpeed: number }> = {
  paved: { drag: 0, maxSpeed: Infinity },
  dirt: { drag: 0.5, maxSpeed: 25 }, // ~90 km/h
  offroad: { drag: 1.2, maxSpeed: 20 }, // ~70 km/h
};
const GRAVITY_ACCEL = 9.81;
/** rad per (m/s²): negatiu = morro amunt en accelerar. */
const ACCEL_PITCH_GAIN = 0.009;
const MAX_ACCEL_PITCH = 0.065;
/** Capcineig (rad per m/s d'impacte) quan el cotxe toca terra i rebota. */
const LANDING_PITCH_GAIN = 0.006;
const LANDING_PITCH_MAX = 0.06;
/** Frec dels pneumàtics de costat (1/s per sin de l'angle de derrapatge). */
const DRIFT_SCRUB = 1.2;
let lastSlope = 0;

/**
 * Frenar fort amb el volant girat i prou velocitat fa perdre les rodes del darrere: el morro
 * gira més que la marxa. En deixar-ho, les rodes tornen a agafar i la marxa s'alinea amb el morro.
 * Retorna si ara mateix està derrapant.
 */
function updateDrift(throttle: number, brake: boolean, dt: number): boolean {
  const v = state.speed;
  const braking = brake || (throttle < 0 && v > 0.1);
  const drifting =
    !autopilotOn &&
    state.verticalVelocity === 0 &&
    braking &&
    v > R12.driftMinSpeed &&
    Math.abs(state.steer) > 0.3;
  if (drifting) {
    // Com més ràpid, més es descontrola la cua, però les rodes la van tornant a agafar.
    const slip = THREE.MathUtils.clamp((v - R12.driftMinSpeed) / 6, 0.4, 1);
    const extra = R12.driftYawRate * state.steer * slip * dt;
    const held = state.driftAngle * Math.exp(-R12.driftGrip * dt);
    const next = THREE.MathUtils.clamp(held + extra, -R12.maxDriftAngle, R12.maxDriftAngle);
    // El morro gira; la marxa es manté on anava.
    state.heading -= next - state.driftAngle;
    state.driftAngle = next;
  } else {
    // Després d'un cop el cotxe triga a tornar a agafar.
    const recovery = R12.driftRecovery * (impactLoose > 0 ? 0.28 : 1);
    state.driftAngle *= Math.exp(-recovery * dt);
    if (Math.abs(state.driftAngle) < 1e-3) {
      state.driftAngle = 0;
    }
  }
  if (state.driftAngle !== 0) {
    state.speed *= Math.exp(-DRIFT_SCRUB * Math.abs(Math.sin(state.driftAngle)) * dt);
  }
  return drifting;
}

/** S (o el fre) amb el cotxe encara avançant, o accelerar endavant mentre va enrere. */
function updateBrakeLights(throttle: number, brake: boolean, speed: number): void {
  const on = brake || (throttle < -0.05 && speed > 0.2) || (throttle > 0.05 && speed < -0.2);
  if (!taillightMat || on === brakeLightsOn) {
    return;
  }
  brakeLightsOn = on;
  taillightMat.emissiveIntensity = on ? TAIL_BRAKE : TAIL_IDLE;
}

function applyTerrainForces(dt: number, brake: boolean): void {
  const v = state.speed;
  // Amb el fre premut i gairebé aturat, el cotxe aguanta a la costa.
  if (brake && Math.abs(v) < 0.5) {
    state.speed = 0;
    return;
  }
  if (Math.abs(v) < 0.05 && Math.abs(lastSlope) < 0.05) {
    return;
  }
  // La gravitat al llarg del pendent: frena en pujada i empeny en baixada.
  let a = -GRAVITY_ACCEL * Math.sin(lastSlope);
  const surface = SURFACE_DRAG[surfaceAt(kart.position.x, kart.position.z)];
  a -= Math.sign(v) * surface.drag;
  if (Math.abs(v) > surface.maxSpeed) {
    a -= Math.sign(v) * 3;
  }
  const next = v + a * dt;
  // La fricció no pot invertir la marxa; la gravitat sí (cotxe aturat en una costa).
  state.speed = Math.sign(next) !== Math.sign(v) && Math.abs(lastSlope) < 0.08 ? 0 : next;
  state.speed = THREE.MathUtils.clamp(state.speed, -R12.maxReverse * 2, R12.maxSpeed);
}

function update(dt: number): void {
  const { throttle, steer, brake } = readInput(dt);
  const speedBefore = state.speed;
  updateBrakeLights(throttle, brake, speedBefore);

  // Física d'un R12 a escala real (vegeu vehicle.ts). Aturat no gira: cal maniobrar.
  const headingBefore = state.heading;
  const drifting = updateDrift(throttle, brake, dt);
  const speedSliding = state.speed;
  state.speed = stepSpeed(state.speed, throttle, brake, dt);
  if (drifting) {
    state.speed = speedSliding + (state.speed - speedSliding) * R12.driftBrakeFactor;
  }
  state.steer = stepSteer(state.steer, steer, state.speed, dt);
  // Amb el cop acabat de rebre el volant mana menys: el cotxe se'n va de cul.
  const steerGrip = impactLoose > 0 ? 0.42 : 1;
  state.heading -= yawRate(state.speed, state.steer) * dt * steerGrip;
  // Girar arran d'una paret no pot ficar el morro ni la cua dins la casa.
  const p = kart.position;
  if (
    state.heading !== headingBefore &&
    bodyHitsWall(p.x, p.y, p.z, state.heading) &&
    !bodyHitsWall(p.x, p.y, p.z, headingBefore)
  ) {
    state.heading = headingBefore;
  }
  applyTerrainForces(dt, brake);
  const longAccel = (state.speed - speedBefore) / Math.max(dt, 1e-4);
  const targetAccelPitch = THREE.MathUtils.clamp(
    -longAccel * ACCEL_PITCH_GAIN,
    -MAX_ACCEL_PITCH,
    MAX_ACCEL_PITCH,
  );
  updateSpeedometer();

  const moved = moveCar(state.speed * dt, dt);
  updateImpact(dt);
  updateStuckWatchdog(throttle, moved, dt);
  animateWheels(Math.sign(state.speed) * moved);
  const forward = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));

  const pose = sampleGroundPose(kart.position.x, kart.position.z, state.heading);
  const floorY = pose ? pose.y + state.wheelOffset : null;
  // `appliedBodyLift` és el que ja hem sumat: el trontoll no s'ha de confondre amb un salt.
  const airborne =
    state.verticalVelocity !== 0 ||
    (floorY !== null && kart.position.y > floorY + appliedBodyLift + 0.08);
  if (pose && !airborne) {
    const k = Math.min(1, 15 * dt);
    state.pitch += (pose.pitch - state.pitch) * k;
    state.roll += (pose.roll - state.roll) * k;
    lastSlope = pose.slope;
  }
  const accelK = Math.min(1, (airborne ? 6 : 10) * dt);
  state.accelPitch += (targetAccelPitch - state.accelPitch) * accelK;
  kart.rotation.set(
    state.pitch + state.accelPitch + impactBody.pitch,
    state.heading,
    state.roll + impactBody.roll,
  );

  if (airborne) {
    appliedBodyLift = 0;
    state.verticalVelocity -= GRAVITY * dt;
    kart.position.y += state.verticalVelocity * dt;
    const landY = floorY ?? kart.position.y;
    if (floorY !== null && kart.position.y <= landY && state.verticalVelocity <= 0) {
      kart.position.y = landY;
      // Les molles tornen part del cop: un rebot petit (i un altre de més petit) abans d'assentar-se.
      const impact = -state.verticalVelocity;
      const bounces = impact > R12.minBounceSpeed;
      state.verticalVelocity = bounces ? impact * R12.landingRestitution : 0;
      if (bounces) {
        state.accelPitch += Math.min(LANDING_PITCH_MAX, impact * LANDING_PITCH_GAIN);
      }
    }
  } else if (floorY !== null) {
    appliedBodyLift = impactBodyLift();
    kart.position.y = floorY + appliedBodyLift;
  }

  if (kart.position.y < -20) {
    applySpawn();
  }

  updateCameraOrbit(dt, throttle);
  applyCamBlend(dt);
  // La càmera segueix la marxa, no el morro: derrapant es veu el cotxe creuat.
  const travel = state.heading + state.driftAngle;
  const camPos = kart.position.clone().add(cameraOffset(travel, camOffset));
  camera.position.lerp(camPos, 1 - Math.exp(-4 * dt));
  // Darrere d'un turó la càmera no pot quedar enterrada.
  const camGround = groundY(camera.position.x, camera.position.z);
  if (camGround !== null && camera.position.y < camGround + 1.5) {
    camera.position.y = camGround + 1.5;
  }
  aimCamera(travel);
  insideHouseId = houseAroundCamera();
  setHouseHide(insideHouseId);
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
const optMotionBlur = document.getElementById("opt-motion-blur") as HTMLInputElement | null;
const optAirParticles = document.getElementById("opt-air-particles") as HTMLInputElement | null;
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
    if (optMotionBlur) {
      optMotionBlur.checked = settings.motionBlur;
    }
    if (optAirParticles) {
      optAirParticles.checked = settings.airParticles;
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
optMotionBlur?.addEventListener("change", () => {
  settings.motionBlur = optMotionBlur.checked;
  saveSettings();
  if (!settings.motionBlur) {
    motionBlur.reset();
  }
});
optAirParticles?.addEventListener("change", () => {
  settings.airParticles = optAirParticles.checked;
  saveSettings();
  airParticles.setEnabled(settings.airParticles);
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
  if (down && !e.repeat && !bigMapOpen && fromKey === "escape") {
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
  // Maj+D: mode dev. No arriba a `keys`, perquè la D sola és girar a la dreta.
  if (down && !e.repeat && e.shiftKey && (fromKey === "d" || fromCode === "d")) {
    setDevMode(!devMode);
    e.preventDefault();
    return;
  }
  for (const k of [fromKey, fromCode]) {
    if (down) {
      keys.add(k);
    } else {
      keys.delete(k);
    }
  }
  if (down && !e.repeat && (fromKey === "r" || fromCode === "r")) {
    // R: carrer més proper; Maj+R: sortida del joc.
    if (e.shiftKey) {
      applySpawn();
    } else {
      respawnNearby();
    }
  }
  if (down && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (fromKey === "z" || fromCode === "z")) {
    cycleCameraPreset();
  }
  if (down && !e.repeat && (fromKey === "i" || fromCode === "i")) {
    setAutopilot(!autopilotOn);
  } else if (down && autopilotOn && (DRIVE_KEYS.includes(fromKey) || DRIVE_KEYS.includes(fromCode))) {
    setAutopilot(false);
  }
  if (down && !e.repeat && e.code === "Space") {
    tryHop();
  }
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(fromKey)) {
    e.preventDefault();
  }
}

window.addEventListener("keydown", (e) => trackKey(e, true));
window.addEventListener("keyup", (e) => trackKey(e, false));

// --- Rendiment: indicador de FPS i resolució adaptativa ---

const perfEl = document.getElementById("perf");
// 1,5× és el sostre: a 2× (retina nativa) el fotograma passa del refresc de 120 Hz i es nota
// l'estrebada, encara que la mitjana superi els 50 FPS. Per sota es baixa si cal.
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 1.5);
const MIN_PIXEL_RATIO = 0.6;
let perfFrames = 0;
let perfElapsed = 0;
let slowSamples = 0;
let fastSamples = 0;
/** Fotogrames de la finestra de mig segon, per mirar el pitjor i no només la mitjana. */
const perfTimes: number[] = [];
/** Període del refresc (ms). 8,33 a 120 Hz, 16,67 a 60 Hz; es dedueix dels fotogrames. */
let refreshMs = 16.67;
/** La compilació de shaders i la vegetació inicial fan fotogrames lents que no representen el joc. */
const ADAPT_WARMUP_MS = 5000;
let adaptWarmupUntil = 0;
/** Després de baixar, no es torna a pujar per sobre d'aquest sostre durant un temps: cada canvi
 *  realoca el framebuffer (una estrebada) i, sense això, la resolució oscil·la entre dos valors. */
let prCeiling = MAX_PIXEL_RATIO;
let prCeilingUntil = 0;
const PR_CEILING_MS = 20000;

/** Baixa la resolució si el fotograma pitjor no entra al refresc, i la recupera quan hi cap. */
function adaptResolution(fps: number, p95: number): void {
  const pr = renderer.getPixelRatio();
  const now = performance.now();
  if (now > prCeilingUntil) {
    prCeiling = MAX_PIXEL_RATIO;
  }
  // Un fotograma que es passa del refresc es veu com una estrebada, encara que la mitjana sigui alta.
  if (p95 > refreshMs * 1.35) {
    slowSamples++;
    fastSamples = 0;
  } else if (p95 <= refreshMs * 1.08 && fps >= (1000 / refreshMs) * 0.96) {
    fastSamples++;
    slowSamples = 0;
  } else {
    slowSamples = 0;
    fastSamples = 0;
  }
  let next = pr;
  if (slowSamples >= 2 && pr > MIN_PIXEL_RATIO) {
    next = Math.max(MIN_PIXEL_RATIO, Math.round((pr - 0.15) * 20) / 20);
    slowSamples = 0;
    prCeiling = next;
    prCeilingUntil = now + PR_CEILING_MS;
  } else if (fastSamples >= 6 && pr < Math.min(MAX_PIXEL_RATIO, prCeiling)) {
    next = Math.min(MAX_PIXEL_RATIO, prCeiling, Math.round((pr + 0.1) * 20) / 20);
    fastSamples = 0;
  }
  if (next !== pr) {
    renderer.setPixelRatio(next);
    motionBlur.setSizeFromRenderer(renderer);
    layoutMinimap();
  }
}

function updatePerf(frameMs: number): void {
  if (adaptWarmupUntil === 0) {
    adaptWarmupUntil = performance.now() + ADAPT_WARMUP_MS;
  }
  perfFrames++;
  perfElapsed += frameMs;
  // Una estrebada de compilació (desenes de ms) no és el refresc: no entra a la mostra.
  const sampleCap = Math.max(40, refreshMs * 3);
  if (frameMs < sampleCap) {
    perfTimes.push(frameMs);
    if (frameMs > 7.2 && frameMs < 9.4) {
      refreshMs = 1000 / 120;
    } else if (frameMs > 15.2 && frameMs < 18.2 && refreshMs > 12) {
      refreshMs = 1000 / 60;
    }
  }
  if (perfElapsed < 500) {
    return;
  }
  const fps = (perfFrames * 1000) / perfElapsed;
  const ms = perfElapsed / perfFrames;
  perfFrames = 0;
  perfElapsed = 0;
  const sorted = perfTimes.slice().sort((a, b) => a - b);
  perfTimes.length = 0;
  if (ms > 200) {
    return; // pestanya en segon pla: la mostra no és representativa
  }
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : ms;
  if (performance.now() >= adaptWarmupUntil) {
    adaptResolution(fps, p95);
  }
  if (perfEl) {
    const info = renderer.info.render;
    perfEl.textContent =
      `${Math.round(fps)} FPS · ${ms.toFixed(1)} ms · ${renderer.getPixelRatio().toFixed(2)}× · ` +
      `${info.calls} draws · ${Math.round(info.triangles / 1000)}k tri`;
    perfEl.classList.toggle("slow", fps < (1000 / refreshMs) * 0.9);
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
    updateVegetationFade(now);
    waterTime.value = now / 1000;
    sky.update(dt, camera, sunOccluded);
    craneFlocks.update(dt, camera);
    airParticles.syncFog(scene.fog);
    airParticles.update(dt, camera, {
      position: kart.position,
      heading: state.heading,
      speed: state.speed,
      driftAngle: state.driftAngle,
      surface: surfaceAt(kart.position.x, kart.position.z),
      waterY: waterOverWheels(kart.position.x, kart.position.y, kart.position.z),
    });
    // Un núvol davant del sol atenua la llum directa (i suavitza les ombres).
    sun.intensity = SUN_INTENSITY * (1 - 0.4 * sky.cloudOverSun);
    hideHouseUniform.value = insideHouseId;
    if (settings.motionBlur) {
      motionBlur.render(renderer, scene, camera, state.speed);
    } else {
      renderer.render(scene, camera);
    }
    // El minimapa i el mapa gran ensenyen la casa sencera.
    hideHouseUniform.value = 0;
    sky.renderFlare(renderer);
    renderMinimap(now);
    updateHudCoords();
    if (devMode && devHoverHouseId) {
      positionDevHouseTooltip();
    }
  }
  updatePerf(frameMs);
  requestAnimationFrame(loop);
}

async function boot(): Promise<void> {
  try {
    // Aquí i no a dalt: les constants del model (R12_*) es defineixen més avall del mòdul.
    markLoad("mòdul i textures procedurals");
    await Promise.all([loadSpawn(), loadWorldMeta()]);
    prefetchAssets();
    buildKartVisual(kart);
    mergeStaticParts(kart);
    markLoad("cotxe, spawn i meta");
    setLoading("Carregant el poble…");
    await nextPaint();
    await loadWorld();
    markLoad("món");
    setLoading("Plantant arbres i horts…");
    await nextPaint();
    await Promise.all([loadTrees(), loadVillage(), loadStreets(), loadHouseCards()]);
    markLoad("vegetació i carrers");
    layoutMinimap();
    applySpawn();
    markLoad("spawn");
    // La vegetació de prop del punt de sortida, ja; la resta es va construint mentre es juga.
    cullByDistance(performance.now(), Infinity, 160);
    markLoad("vegetació propera");
    await Promise.all(orthoLoads);
    markLoad("ortofotos");
    renderer.compile(scene, camera);
    markLoad("compilació de shaders");
    document.getElementById("loading")?.remove();
    const hud = document.getElementById("hud");
    if (hud) {
      hud.hidden = false;
    }
    document.getElementById("credit")?.removeAttribute("hidden");
    minimapCanvas?.removeAttribute("hidden");
    renderer.domElement.focus();
    requestAnimationFrame((t) => {
      loop(t);
      markLoad("primer fotograma");
      setTimeout(applyCarEnvironment, 0);
      loadTimings.total = Math.round(performance.now() - LOAD_T0);
      console.info("[càrrega]", JSON.stringify(loadTimings));
    });
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
(window as unknown as { __dbg: unknown }).__dbg = { scene, kart, state, camera, placeCameraBehindKart }; // TEMP
