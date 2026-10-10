// Pols i motes a l'aire: atmosfera de plana seca (vall del Tera), pols de rodes en terra,
// esquitxades i escuma quan el cotxe va per l'aigua, i fum de les rodes del darrere quan derrapa.

import * as THREE from "three";

/** Per sobre del cel (sky.dome renderOrder 1000): sense depthWrite, el cel tapava les motes. */
const RENDER_ORDER = 1001;

const AMBIENT_COUNT = 28;
/** Caixa davant de la càmera (metres, espai local: −Z = endavant). Curta: només l'aire del voltant. */
const BOX_X = 8;
const BOX_Z_NEAR = 1.4;
const BOX_Z_FAR = 18;
const BOX_Y_MIN = -2.5;
const BOX_Y_MAX = 5;
/** S'esvaeixen abans del final de la caixa, perquè no es vegin al fons del carrer. */
const FADE_START = 7;
const FADE_END = 14;
/** Vent lleuger cap al sud-oest, com el cel (sky.ts). */
const WIND = new THREE.Vector3(-0.45, 0.02, 0.28);

const DUST_COUNT = 160;
const DUST_LIFE_S = 1.35;

/** Fum fosc de les rodes del darrere mentre derrapa. Curt i menut. */
const SMOKE_COUNT = 180;
const SMOKE_LIFE_S = 0.32;
/** Eixos del R12, en local (+Z endavant, +X a la dreta). */
const REAR_AXLE_Z = -1.12;
const FRONT_AXLE_Z = 1.32;
const NOSE_Z = 2.05;
const REAR_TRACK = 0.72;

/** Gotes i escuma de les rodes dins l'aigua. Més curtes que la pols: cauen de seguida. */
const SPRAY_COUNT = 360;
const SPRAY_GRAVITY = 16;

type DustSlot = {
  life: number;
  maxLife: number;
};

type SpraySlot = {
  life: number;
  maxLife: number;
  /** 0 gota (puja i cau), 1 escuma (s'estén sobre la làmina). */
  kind: number;
  floorY: number;
};

const ambientVert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vDist;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mvPosition.xyz);
  // Mota petita, no el disc de diversos metres d'abans. El sostre evita taques enganxades a la lent.
  float sz = aSize * (260.0 / max(vDist, 0.6));
  gl_PointSize = clamp(sz, 0.0, 9.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const ambientFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uFadeStart;
uniform float uFadeEnd;
varying float vDist;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;
  float soft = 1.0 - smoothstep(0.2, 0.5, d);
  float nearFade = smoothstep(0.5, 1.8, vDist);
  float farFade = 1.0 - smoothstep(uFadeStart, uFadeEnd, vDist);
  float alpha = soft * uOpacity * vAlpha * nearFade * farFade;
  if (alpha < 0.012) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const dustVert = /* glsl */ `
attribute float aLife;
attribute float aSize;
varying float vLife;
varying float vDepth;
void main() {
  vLife = aLife;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mvPosition.z;
  float sz = aSize * (260.0 / max(-mvPosition.z, 1.0));
  gl_PointSize = clamp(sz, 0.0, 72.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const dustFrag = /* glsl */ `
uniform vec3 uDustColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying float vLife;
varying float vDepth;
void main() {
  if (vLife < 0.01) discard;
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;
  float soft = 1.0 - smoothstep(0.08, 0.5, d);
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  vec3 col = mix(uDustColor, uFogColor, fog * 0.7);
  float alpha = soft * vLife * 0.62 * (1.0 - fog * 0.45);
  gl_FragColor = vec4(col, alpha);
}
`;

const smokeVert = /* glsl */ `
attribute float aLife;
attribute float aSize;
varying float vLife;
varying float vDepth;
void main() {
  vLife = aLife;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mvPosition.z;
  // Punt menut: un rastre, no un núvol.
  float grow = mix(1.2, 0.7, vLife);
  float sz = aSize * grow * (58.0 / max(vDepth, 1.6));
  gl_PointSize = clamp(sz, 0.0, 18.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const smokeFrag = /* glsl */ `
uniform vec3 uSmokeColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying float vLife;
varying float vDepth;
void main() {
  if (vLife < 0.02) discard;
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;
  float soft = 1.0 - smoothstep(0.05, 0.48, d);
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  vec3 col = mix(uSmokeColor, uFogColor, fog * 0.35);
  // Neix visible i cau de cop, perquè el rastre no quedi enganxat al carrer.
  float alpha = soft * pow(vLife, 2.2) * 0.84 * (1.0 - fog * 0.35);
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

const sprayVert = /* glsl */ `
attribute float aLife;
attribute float aSize;
attribute float aKind;
varying float vLife;
varying float vKind;
void main() {
  vLife = aLife;
  vKind = aKind;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float distScale = 210.0 / max(-mvPosition.z, 1.3);
  float sz = aSize * distScale;
  gl_PointSize = clamp(sz, 0.0, aKind > 0.5 ? 22.0 : 16.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const sprayFrag = /* glsl */ `
varying float vLife;
varying float vKind;
void main() {
  if (vLife < 0.015) discard;
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;
  if (vKind > 0.5) {
    float soft = 1.0 - smoothstep(0.05, 0.48, d);
    float alpha = soft * pow(vLife, 0.65) * 0.42;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(0.78, 0.90, 0.90, alpha);
    return;
  }
  float core = 1.0 - smoothstep(0.0, 0.2, d);
  float soft = 1.0 - smoothstep(0.02, 0.38, d);
  vec3 col = mix(vec3(0.62, 0.84, 0.92), vec3(0.96, 0.99, 0.99), core);
  float alpha = soft * (0.72 + 0.28 * vLife);
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

type DriveSurface = "paved" | "dirt" | "offroad";

export type AirParticlesDrive = {
  position: THREE.Vector3;
  heading: number;
  speed: number;
  /** Angle entre el morro i la marxa (rad). En surt el fum de les rodes del darrere. */
  driftAngle: number;
  surface: DriveSurface;
  /** Làmina per damunt de les rodes. Null si el cotxe va per terra eixuta. */
  waterY: number | null;
};

export class AirParticles {
  /** La caixa segueix la càmera; les motes es desen en local però es mouen al món.
   *  No es pot penjar de `camera` perquè no es recorre en el render. */
  private readonly ambientAnchor = new THREE.Group();
  private readonly camPos = new THREE.Vector3();
  private readonly camQuat = new THREE.Quaternion();
  private readonly prevCamPos = new THREE.Vector3();
  private readonly prevCamQuat = new THREE.Quaternion();
  private readonly invCamQuat = new THREE.Quaternion();
  private readonly scratch = new THREE.Vector3();
  private readonly worldScratch = new THREE.Vector3();
  private camReady = false;
  private readonly ambientPos: Float32Array;
  private readonly ambientVel: Float32Array;
  private readonly ambientPhase: Float32Array;
  private readonly ambientSize: Float32Array;
  private readonly ambientAlpha: Float32Array;
  private readonly ambientPoints: THREE.Points;
  private readonly ambientMat: THREE.ShaderMaterial;
  private enabled = true;

  private readonly dustPos: Float32Array;
  private readonly dustVel: Float32Array;
  private readonly dustLife: Float32Array;
  private readonly dustSize: Float32Array;
  private readonly dustSlots: DustSlot[];
  private readonly dustPoints: THREE.Points;
  private readonly dustMat: THREE.ShaderMaterial;
  private dustCursor = 0;

  private readonly smokePos: Float32Array;
  private readonly smokeVel: Float32Array;
  private readonly smokeLife: Float32Array;
  private readonly smokeSize: Float32Array;
  private readonly smokeSlots: DustSlot[];
  private readonly smokePoints: THREE.Points;
  private readonly smokeMat: THREE.ShaderMaterial;
  private smokeCursor = 0;

  private readonly sprayPos: Float32Array;
  private readonly sprayVel: Float32Array;
  private readonly sprayLife: Float32Array;
  private readonly spraySize: Float32Array;
  private readonly sprayKind: Float32Array;
  private readonly spraySlots: SpraySlot[];
  private readonly sprayPoints: THREE.Points;
  private sprayCursor = 0;
  private elapsed = 0;

  constructor(scene: THREE.Scene, _camera: THREE.PerspectiveCamera, _sunDir: THREE.Vector3, layer: number) {
    this.ambientAnchor.frustumCulled = false;
    scene.add(this.ambientAnchor);

    this.ambientPos = new Float32Array(AMBIENT_COUNT * 3);
    this.ambientVel = new Float32Array(AMBIENT_COUNT * 3);
    this.ambientPhase = new Float32Array(AMBIENT_COUNT);
    this.ambientSize = new Float32Array(AMBIENT_COUNT);
    this.ambientAlpha = new Float32Array(AMBIENT_COUNT);

    for (let i = 0; i < AMBIENT_COUNT; i++) {
      this.respawnAmbient(i, true);
    }

    const ambGeo = new THREE.BufferGeometry();
    ambGeo.setAttribute("position", new THREE.BufferAttribute(this.ambientPos, 3));
    ambGeo.setAttribute("aSize", new THREE.BufferAttribute(this.ambientSize, 1));
    ambGeo.setAttribute("aAlpha", new THREE.BufferAttribute(this.ambientAlpha, 1));

    this.ambientMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xf2e6d4) },
        uOpacity: { value: 0.85 },
        uFadeStart: { value: FADE_START },
        uFadeEnd: { value: FADE_END },
      },
      vertexShader: ambientVert,
      fragmentShader: ambientFrag,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });

    this.ambientPoints = new THREE.Points(ambGeo, this.ambientMat);
    this.ambientPoints.frustumCulled = false;
    this.ambientPoints.renderOrder = RENDER_ORDER;
    this.ambientPoints.layers.set(layer);
    this.ambientAnchor.add(this.ambientPoints);

    this.dustPos = new Float32Array(DUST_COUNT * 3);
    this.dustVel = new Float32Array(DUST_COUNT * 3);
    this.dustLife = new Float32Array(DUST_COUNT);
    this.dustSize = new Float32Array(DUST_COUNT);
    this.dustSlots = Array.from({ length: DUST_COUNT }, () => ({ life: 0, maxLife: 1 }));

    for (let i = 0; i < DUST_COUNT; i++) {
      this.dustLife[i] = 0;
      this.dustSize[i] = 0;
      this.dustPos[i * 3 + 1] = -999;
    }

    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(this.dustPos, 3));
    dustGeo.setAttribute("aLife", new THREE.BufferAttribute(this.dustLife, 1));
    dustGeo.setAttribute("aSize", new THREE.BufferAttribute(this.dustSize, 1));

    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uDustColor: { value: new THREE.Color(0xc4b8a4) },
        uFogColor: { value: new THREE.Color(0xc8dae8) },
        uFogNear: { value: 140 },
        uFogFar: { value: 560 },
      },
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });

    this.dustPoints = new THREE.Points(dustGeo, this.dustMat);
    this.dustPoints.frustumCulled = false;
    this.dustPoints.renderOrder = RENDER_ORDER;
    this.dustPoints.layers.set(layer);
    scene.add(this.dustPoints);

    this.smokePos = new Float32Array(SMOKE_COUNT * 3);
    this.smokeVel = new Float32Array(SMOKE_COUNT * 3);
    this.smokeLife = new Float32Array(SMOKE_COUNT);
    this.smokeSize = new Float32Array(SMOKE_COUNT);
    this.smokeSlots = Array.from({ length: SMOKE_COUNT }, () => ({ life: 0, maxLife: 1 }));
    for (let i = 0; i < SMOKE_COUNT; i++) {
      this.smokeLife[i] = 0;
      this.smokeSize[i] = 0;
      this.smokePos[i * 3 + 1] = -999;
    }

    const smokeGeo = new THREE.BufferGeometry();
    smokeGeo.setAttribute("position", new THREE.BufferAttribute(this.smokePos, 3));
    smokeGeo.setAttribute("aLife", new THREE.BufferAttribute(this.smokeLife, 1));
    smokeGeo.setAttribute("aSize", new THREE.BufferAttribute(this.smokeSize, 1));

    this.smokeMat = new THREE.ShaderMaterial({
      uniforms: {
        uSmokeColor: { value: new THREE.Color(0x1c1a17) },
        uFogColor: { value: new THREE.Color(0xc8dae8) },
        uFogNear: { value: 140 },
        uFogFar: { value: 560 },
      },
      vertexShader: smokeVert,
      fragmentShader: smokeFrag,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });

    this.smokePoints = new THREE.Points(smokeGeo, this.smokeMat);
    this.smokePoints.frustumCulled = false;
    this.smokePoints.renderOrder = RENDER_ORDER;
    this.smokePoints.layers.set(layer);
    scene.add(this.smokePoints);

    this.sprayPos = new Float32Array(SPRAY_COUNT * 3);
    this.sprayVel = new Float32Array(SPRAY_COUNT * 3);
    this.sprayLife = new Float32Array(SPRAY_COUNT);
    this.spraySize = new Float32Array(SPRAY_COUNT);
    this.sprayKind = new Float32Array(SPRAY_COUNT);
    this.spraySlots = Array.from({ length: SPRAY_COUNT }, () => ({ life: 0, maxLife: 1, kind: 0, floorY: 0 }));
    for (let i = 0; i < SPRAY_COUNT; i++) {
      this.sprayLife[i] = 0;
      this.spraySize[i] = 0;
      this.sprayPos[i * 3 + 1] = -999;
    }

    const sprayGeo = new THREE.BufferGeometry();
    sprayGeo.setAttribute("position", new THREE.BufferAttribute(this.sprayPos, 3));
    sprayGeo.setAttribute("aLife", new THREE.BufferAttribute(this.sprayLife, 1));
    sprayGeo.setAttribute("aSize", new THREE.BufferAttribute(this.spraySize, 1));
    sprayGeo.setAttribute("aKind", new THREE.BufferAttribute(this.sprayKind, 1));

    const sprayMat = new THREE.ShaderMaterial({
      vertexShader: sprayVert,
      fragmentShader: sprayFrag,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });

    this.sprayPoints = new THREE.Points(sprayGeo, sprayMat);
    this.sprayPoints.frustumCulled = false;
    this.sprayPoints.renderOrder = RENDER_ORDER;
    this.sprayPoints.layers.set(layer);
    scene.add(this.sprayPoints);
  }

  setSunDirection(_dir: THREE.Vector3): void {
    // Reservat per un eventual parpelleig direccional.
  }

  /** Les motes i la pols de les rodes. En apagar-les no es simulen. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) {
      return;
    }
    this.enabled = on;
    this.ambientPoints.visible = on;
    this.dustPoints.visible = on;
    this.smokePoints.visible = on;
    this.sprayPoints.visible = on;
    if (!on) {
      return;
    }
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      this.respawnAmbient(i, true);
    }
    // El fotograma següent les torna a situar respecte de la càmera d'ara.
    this.camReady = false;
    const geo = this.ambientPoints.geometry;
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
  }

  syncFog(fog: THREE.Fog | THREE.FogExp2 | null): void {
    if (!fog) {
      return;
    }
    const u = this.dustMat.uniforms;
    u.uFogColor.value.copy(fog.color);
    const smokeFog = this.smokeMat.uniforms;
    smokeFog.uFogColor.value.copy(fog.color);
    if (fog instanceof THREE.Fog) {
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
      smokeFog.uFogNear.value = fog.near;
      smokeFog.uFogFar.value = fog.far;
    }
  }

  private respawnAmbient(i: number, initial: boolean): void {
    const x = (Math.random() - 0.5) * BOX_X * 2;
    const y = THREE.MathUtils.lerp(BOX_Y_MIN, BOX_Y_MAX, Math.random());
    // Més motes a prop que al final de la caixa, que ja queda esvaït.
    const along = Math.pow(Math.random(), 1.7);
    const z = -THREE.MathUtils.lerp(BOX_Z_NEAR, BOX_Z_FAR, along);
    this.ambientPos[i * 3] = x;
    this.ambientPos[i * 3 + 1] = y;
    this.ambientPos[i * 3 + 2] = z;

    const drift = 0.15 + Math.random() * 0.35;
    this.ambientVel[i * 3] = WIND.x * drift + (Math.random() - 0.5) * 0.1;
    this.ambientVel[i * 3 + 1] = (Math.random() - 0.5) * 0.05;
    this.ambientVel[i * 3 + 2] = WIND.z * drift + (Math.random() - 0.5) * 0.06;

    this.ambientSize[i] = 0.2 + Math.random() * 0.14;
    this.ambientAlpha[i] = 0.4 + Math.random() * 0.6;
    this.ambientPhase[i] = Math.random() * Math.PI * 2;

    if (!initial) {
      this.ambientPhase[i] += this.elapsed;
    }
  }

  /** Fora de la caixa davant la càmera (−Z = endavant). */
  private outsideAmbientBox(i: number): boolean {
    const x = this.ambientPos[i * 3];
    const y = this.ambientPos[i * 3 + 1];
    const z = this.ambientPos[i * 3 + 2];
    return (
      Math.abs(x) > BOX_X ||
      z > -BOX_Z_NEAR ||
      z < -BOX_Z_FAR ||
      y < BOX_Y_MIN - 1 ||
      y > BOX_Y_MAX + 2
    );
  }

  /** Offset local de la càmera → món. */
  private ambientToWorld(i: number, origin: THREE.Vector3, quat: THREE.Quaternion, out: THREE.Vector3): void {
    out.set(this.ambientPos[i * 3], this.ambientPos[i * 3 + 1], this.ambientPos[i * 3 + 2]);
    out.applyQuaternion(quat).add(origin);
  }

  /** Món → offset local de la càmera d'aquest fotograma. */
  private ambientFromWorld(i: number, world: THREE.Vector3): void {
    this.scratch.copy(world).sub(this.camPos).applyQuaternion(this.invCamQuat);
    this.ambientPos[i * 3] = this.scratch.x;
    this.ambientPos[i * 3 + 1] = this.scratch.y;
    this.ambientPos[i * 3 + 2] = this.scratch.z;
  }

  private burstCount(rate: number, dt: number, cap: number): number {
    const emit = rate * dt;
    const whole = Math.floor(emit);
    return Math.min(cap, whole + (Math.random() < emit - whole ? 1 : 0));
  }

  private emitDroplet(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
    floorY: number,
  ): void {
    const i = this.sprayCursor;
    this.sprayCursor = (this.sprayCursor + 1) % SPRAY_COUNT;
    const slot = this.spraySlots[i];
    slot.life = life;
    slot.maxLife = life;
    slot.kind = 0;
    slot.floorY = floorY;
    this.sprayPos[i * 3] = x;
    this.sprayPos[i * 3 + 1] = y;
    this.sprayPos[i * 3 + 2] = z;
    this.sprayVel[i * 3] = vx;
    this.sprayVel[i * 3 + 1] = vy;
    this.sprayVel[i * 3 + 2] = vz;
    this.spraySize[i] = size;
    this.sprayKind[i] = 0;
    this.sprayLife[i] = 1;
  }

  private emitFoam(
    x: number,
    z: number,
    vx: number,
    vz: number,
    size: number,
    life: number,
    floorY: number,
  ): void {
    const i = this.sprayCursor;
    this.sprayCursor = (this.sprayCursor + 1) % SPRAY_COUNT;
    const slot = this.spraySlots[i];
    slot.life = life;
    slot.maxLife = life;
    slot.kind = 1;
    slot.floorY = floorY;
    this.sprayPos[i * 3] = x;
    this.sprayPos[i * 3 + 1] = floorY + 0.06;
    this.sprayPos[i * 3 + 2] = z;
    this.sprayVel[i * 3] = vx;
    this.sprayVel[i * 3 + 1] = 0;
    this.sprayVel[i * 3 + 2] = vz;
    this.spraySize[i] = size;
    this.sprayKind[i] = 1;
    this.sprayLife[i] = 1;
  }

  /** Gotes que surten de la làmina i escuma que es queda al rastre. */
  private emitSpray(drive: AirParticlesDrive, dt: number, waterY: number): void {
    const speed = Math.abs(drive.speed);
    if (speed < 1.1) {
      return;
    }
    const depth = THREE.MathUtils.clamp(waterY - drive.position.y + 0.06, 0.05, 1.1);
    const depthK = THREE.MathUtils.clamp(depth / 0.4, 0.3, 1);
    const kick = THREE.MathUtils.clamp((speed - 1.1) / 9, 0.2, 1.35) * depthK;
    const fx = Math.sin(drive.heading);
    const fz = Math.cos(drive.heading);
    const rx = Math.cos(drive.heading);
    const rz = -Math.sin(drive.heading);
    const outside = drive.driftAngle > 0.08 ? -1 : drive.driftAngle < -0.08 ? 1 : 0;

    const drops = this.burstCount(10 + kick * 55, dt, 5);
    for (let n = 0; n < drops; n++) {
      const rear = Math.random() < 0.72;
      const axle = rear ? REAR_AXLE_Z : FRONT_AXLE_Z;
      const side = Math.random() < 0.5 ? 1 : -1;
      const bias = outside === 0 ? side : Math.random() < 0.75 ? outside : -outside;
      const wx = drive.position.x + fx * axle + rx * bias * REAR_TRACK;
      const wz = drive.position.z + fz * axle + rz * bias * REAR_TRACK;
      const back = (1.2 + Math.random() * 2.4) * (0.45 + kick);
      const out = bias * (0.6 + Math.random() * 1.6) * (0.5 + kick);
      const up = (3.4 + Math.random() * 4.6) * (0.5 + kick * 0.65);
      this.emitDroplet(
        wx + (Math.random() - 0.5) * 0.2,
        waterY + Math.random() * 0.06,
        wz + (Math.random() - 0.5) * 0.2,
        -fx * back + rx * out,
        up,
        -fz * back + rz * out,
        2.4 + kick * 2.2 + Math.random() * 1.6,
        0.28 + Math.random() * 0.18,
        waterY,
      );
    }

    const bow = this.burstCount(kick * 16, dt, 2);
    for (let n = 0; n < bow; n++) {
      const side = n % 2 === 0 ? 1 : -1;
      const wx = drive.position.x + fx * NOSE_Z + rx * side * 0.32;
      const wz = drive.position.z + fz * NOSE_Z + rz * side * 0.32;
      const fwd = (1.4 + Math.random() * 2.0) * kick;
      const out = side * (1.5 + Math.random() * 2.2) * (0.45 + kick);
      this.emitDroplet(
        wx,
        waterY + 0.02,
        wz,
        fx * fwd + rx * out,
        (2.0 + Math.random() * 2.8) * (0.5 + kick * 0.55),
        fz * fwd + rz * out,
        1.8 + Math.random() * 1.2,
        0.22 + Math.random() * 0.12,
        waterY,
      );
    }

    const foam = this.burstCount(4 + kick * 14, dt, 3);
    for (let n = 0; n < foam; n++) {
      const back = 1.2 + Math.random() * (1.6 + kick);
      const side = (Math.random() - 0.5) * 0.7;
      this.emitFoam(
        drive.position.x - fx * back + rx * side,
        drive.position.z - fz * back + rz * side,
        -fx * (0.3 + Math.random() * 0.5),
        -fz * (0.3 + Math.random() * 0.5),
        4.2 + kick * 2.2 + Math.random() * 2.2,
        0.4 + Math.random() * 0.35,
        waterY,
      );
    }
  }

  private emitDust(
    x: number,
    y: number,
    z: number,
    fx: number,
    fz: number,
    rx: number,
    rz: number,
    strength: number,
  ): void {
    const i = this.dustCursor;
    this.dustCursor = (this.dustCursor + 1) % DUST_COUNT;
    const slot = this.dustSlots[i];
    slot.life = DUST_LIFE_S * (0.7 + Math.random() * 0.5);
    slot.maxLife = slot.life;

    this.dustPos[i * 3] = x + (Math.random() - 0.5) * 0.35;
    this.dustPos[i * 3 + 1] = y + 0.05 + Math.random() * 0.15;
    this.dustPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.35;

    const back = strength * (2.2 + Math.random() * 2.5);
    const lift = 0.6 + Math.random() * 1.4;
    this.dustVel[i * 3] = -fx * back + rx * (Math.random() - 0.5) * 1.2;
    this.dustVel[i * 3 + 1] = lift;
    this.dustVel[i * 3 + 2] = -fz * back + rz * (Math.random() - 0.5) * 1.2;

    this.dustSize[i] = 6 + Math.random() * 12;
    this.dustLife[i] = 1;
  }

  /** Una bafarada a la roda del darrere. `back` és enrere del morro; `out` cap al costat de fora. */
  private emitSmoke(
    x: number,
    y: number,
    z: number,
    backX: number,
    backZ: number,
    outX: number,
    outZ: number,
    intensity: number,
  ): void {
    const i = this.smokeCursor;
    this.smokeCursor = (this.smokeCursor + 1) % SMOKE_COUNT;
    const slot = this.smokeSlots[i];
    slot.life = SMOKE_LIFE_S * (0.75 + Math.random() * 0.45);
    slot.maxLife = slot.life;

    this.smokePos[i * 3] = x + (Math.random() - 0.5) * 0.18;
    this.smokePos[i * 3 + 1] = y + Math.random() * 0.2;
    this.smokePos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.18;

    const back = 0.8 + Math.random() * 1.6;
    const side = (0.6 + intensity * 1.2) * (0.4 + Math.random() * 0.5);
    this.smokeVel[i * 3] = backX * back + outX * side;
    this.smokeVel[i * 3 + 1] = 0.35 + Math.random() * (0.4 + intensity * 0.6);
    this.smokeVel[i * 3 + 2] = backZ * back + outZ * side;
    this.smokeSize[i] = 1.7 + intensity * 1.0 + Math.random() * 0.7;
    this.smokeLife[i] = 1;
  }

  /** Punts foscos a les rodes del darrere, més espessos com més creuat va el cotxe. */
  private emitDriftSmoke(drive: AirParticlesDrive, dt: number): void {
    const slip = drive.driftAngle;
    const mag = Math.abs(slip);
    if (mag < 0.13 || drive.speed < 8) {
      return;
    }
    const intensity = THREE.MathUtils.clamp((mag - 0.13) / 0.42, 0, 1);
    const rate = intensity * (110 + Math.min(drive.speed, 24) * 4.5);
    const emit = rate * dt;
    const bursts = Math.min(8, Math.floor(emit) + (Math.random() < emit - Math.floor(emit) ? 1 : 0));
    if (bursts <= 0) {
      return;
    }

    const fx = Math.sin(drive.heading);
    const fz = Math.cos(drive.heading);
    const rx = Math.cos(drive.heading);
    const rz = -Math.sin(drive.heading);
    // slip > 0: la marxa va a la dreta del morro i la cua surt per l'esquerra.
    const outside = slip > 0 ? -1 : 1;

    for (let n = 0; n < bursts; n++) {
      const wheel = Math.random() < 0.72 ? outside : -outside;
      const wx = drive.position.x + fx * REAR_AXLE_Z + rx * wheel * REAR_TRACK;
      const wy = drive.position.y + 0.22;
      const wz = drive.position.z + fz * REAR_AXLE_Z + rz * wheel * REAR_TRACK;
      this.emitSmoke(wx, wy, wz, -fx, -fz, rx * outside, rz * outside, intensity);
    }

    (this.smokeMat.uniforms.uSmokeColor.value as THREE.Color).setHex(
      drive.surface === "paved" ? 0x161412 : 0x221c16,
    );
  }

  update(dt: number, camera: THREE.PerspectiveCamera, drive?: AirParticlesDrive): void {
    if (!this.enabled) {
      return;
    }
    this.elapsed += dt;
    this.ambientMat.uniforms.uOpacity.value = 0.78 + 0.07 * Math.sin(this.elapsed * 0.9);

    this.camPos.copy(camera.position);
    this.camQuat.copy(camera.quaternion);
    this.invCamQuat.copy(this.camQuat).invert();
    this.ambientAnchor.position.copy(this.camPos);
    this.ambientAnchor.quaternion.copy(this.camQuat);
    this.ambientAnchor.updateMatrix();
    this.ambientAnchor.updateMatrixWorld(true);

    const posAttr = this.ambientPoints.geometry.getAttribute("position") as THREE.BufferAttribute;

    // Les motes queden al món (vent inclòs). La caixa només les torna a emmarcar:
    // si no, en girar o avançar deriven en eixos de la càmera i no del carrer.
    const jumped = this.camReady && this.prevCamPos.distanceToSquared(this.camPos) > BOX_Z_FAR * BOX_Z_FAR;
    const origin = this.camReady && !jumped ? this.prevCamPos : this.camPos;
    const quat = this.camReady && !jumped ? this.prevCamQuat : this.camQuat;
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      if (jumped) {
        this.respawnAmbient(i, false);
        continue;
      }
      this.ambientToWorld(i, origin, quat, this.worldScratch);
      this.worldScratch.x += this.ambientVel[i * 3] * dt;
      this.worldScratch.y += this.ambientVel[i * 3 + 1] * dt;
      this.worldScratch.z += this.ambientVel[i * 3 + 2] * dt;
      this.ambientFromWorld(i, this.worldScratch);
      this.ambientPhase[i] += dt * (0.6 + (i % 7) * 0.08);
      if (this.outsideAmbientBox(i)) {
        this.respawnAmbient(i, false);
      }
    }
    this.prevCamPos.copy(this.camPos);
    this.prevCamQuat.copy(this.camQuat);
    this.camReady = true;
    posAttr.needsUpdate = true;
    (this.ambientPoints.geometry.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
    (this.ambientPoints.geometry.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;

    const dustPosAttr = this.dustPoints.geometry.getAttribute("position") as THREE.BufferAttribute;
    const dustLifeAttr = this.dustPoints.geometry.getAttribute("aLife") as THREE.BufferAttribute;
    const dustSizeAttr = this.dustPoints.geometry.getAttribute("aSize") as THREE.BufferAttribute;

    for (let i = 0; i < DUST_COUNT; i++) {
      const slot = this.dustSlots[i];
      if (slot.life <= 0) {
        this.dustLife[i] = 0;
        this.dustSize[i] = 0;
        continue;
      }
      slot.life -= dt;
      this.dustLife[i] = Math.max(0, slot.life / slot.maxLife);
      this.dustPos[i * 3] += this.dustVel[i * 3] * dt;
      this.dustPos[i * 3 + 1] += this.dustVel[i * 3 + 1] * dt;
      this.dustPos[i * 3 + 2] += this.dustVel[i * 3 + 2] * dt;
      this.dustVel[i * 3 + 1] -= 1.8 * dt;
      this.dustVel[i * 3] *= 1 - 1.2 * dt;
      this.dustVel[i * 3 + 2] *= 1 - 1.2 * dt;
    }
    dustPosAttr.needsUpdate = true;
    dustLifeAttr.needsUpdate = true;
    dustSizeAttr.needsUpdate = true;

    const smokePosAttr = this.smokePoints.geometry.getAttribute("position") as THREE.BufferAttribute;
    const smokeLifeAttr = this.smokePoints.geometry.getAttribute("aLife") as THREE.BufferAttribute;
    const smokeSizeAttr = this.smokePoints.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const slot = this.smokeSlots[i];
      if (slot.life <= 0) {
        this.smokeLife[i] = 0;
        this.smokeSize[i] = 0;
        continue;
      }
      slot.life -= dt;
      this.smokeLife[i] = Math.max(0, slot.life / slot.maxLife);
      this.smokePos[i * 3] += this.smokeVel[i * 3] * dt;
      this.smokePos[i * 3 + 1] += this.smokeVel[i * 3 + 1] * dt;
      this.smokePos[i * 3 + 2] += this.smokeVel[i * 3 + 2] * dt;
      this.smokeVel[i * 3] *= 1 - 1.6 * dt;
      this.smokeVel[i * 3 + 1] *= 1 - 1.1 * dt;
      this.smokeVel[i * 3 + 2] *= 1 - 1.6 * dt;
    }
    smokePosAttr.needsUpdate = true;
    smokeLifeAttr.needsUpdate = true;
    smokeSizeAttr.needsUpdate = true;

    const sprayPosAttr = this.sprayPoints.geometry.getAttribute("position") as THREE.BufferAttribute;
    const sprayLifeAttr = this.sprayPoints.geometry.getAttribute("aLife") as THREE.BufferAttribute;
    const spraySizeAttr = this.sprayPoints.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const sprayKindAttr = this.sprayPoints.geometry.getAttribute("aKind") as THREE.BufferAttribute;
    for (let i = 0; i < SPRAY_COUNT; i++) {
      const slot = this.spraySlots[i];
      if (slot.life <= 0) {
        this.sprayLife[i] = 0;
        this.spraySize[i] = 0;
        continue;
      }
      slot.life -= dt;
      if (slot.kind === 0) {
        this.sprayVel[i * 3 + 1] -= SPRAY_GRAVITY * dt;
        this.sprayVel[i * 3] *= 1 - 1.1 * dt;
        this.sprayVel[i * 3 + 2] *= 1 - 1.1 * dt;
        this.sprayPos[i * 3] += this.sprayVel[i * 3] * dt;
        this.sprayPos[i * 3 + 1] += this.sprayVel[i * 3 + 1] * dt;
        this.sprayPos[i * 3 + 2] += this.sprayVel[i * 3 + 2] * dt;
        if (this.sprayPos[i * 3 + 1] <= slot.floorY + 0.04 && this.sprayVel[i * 3 + 1] < 0) {
          slot.life = 0;
          this.sprayLife[i] = 0;
          this.spraySize[i] = 0;
          continue;
        }
      } else {
        this.sprayVel[i * 3] *= 1 - 0.9 * dt;
        this.sprayVel[i * 3 + 2] *= 1 - 0.9 * dt;
        this.sprayPos[i * 3] += this.sprayVel[i * 3] * dt;
        this.sprayPos[i * 3 + 1] = slot.floorY + 0.06;
        this.sprayPos[i * 3 + 2] += this.sprayVel[i * 3 + 2] * dt;
      }
      this.sprayLife[i] = Math.max(0, slot.life / slot.maxLife);
    }
    sprayPosAttr.needsUpdate = true;
    sprayLifeAttr.needsUpdate = true;
    spraySizeAttr.needsUpdate = true;
    sprayKindAttr.needsUpdate = true;

    if (!drive) {
      return;
    }
    if (drive.waterY !== null) {
      this.emitSpray(drive, dt, drive.waterY);
      return;
    }
    this.emitDriftSmoke(drive, dt);
    const v = Math.abs(drive.speed);
    if (v < 2.5 || drive.surface === "paved") {
      return;
    }

    const fx = Math.sin(drive.heading);
    const fz = Math.cos(drive.heading);
    const rx = Math.cos(drive.heading);
    const rz = -Math.sin(drive.heading);
    const strength = drive.surface === "offroad" ? 1 : 0.65;
    const rate = THREE.MathUtils.clamp(v * 0.35, 2, 28) * strength;
    const emit = rate * dt;
    const bursts = Math.min(4, Math.floor(emit) + (Math.random() < emit - Math.floor(emit) ? 1 : 0));

    for (let n = 0; n < bursts; n++) {
      const side = n % 2 === 0 ? 1 : -1;
      const wx = drive.position.x - fx * 1.05 + rx * side * 0.55;
      const wy = drive.position.y + 0.12;
      const wz = drive.position.z - fz * 1.05 + rz * side * 0.55;
      this.emitDust(wx, wy, wz, fx, fz, rx, rz, strength * (0.5 + v * 0.04));
    }

    (this.dustMat.uniforms.uDustColor.value as THREE.Color).setHex(
      drive.surface === "offroad" ? 0xb8a88c : 0xc8beb0,
    );
  }
}
