// Pols i motes a l'aire: atmosfera de plana seca (vall del Tera) i pols de rodes en terra.

import * as THREE from "three";

/** Per sobre del cel (sky.dome renderOrder 1000): sense depthWrite, el cel tapava les motes. */
const RENDER_ORDER = 1001;

const AMBIENT_COUNT = 520;
/** Caixa davant de la càmera (metres, espai local: −Z = endavant). */
const BOX_X = 44;
const BOX_Z_NEAR = 2;
const BOX_Z_FAR = 72;
const BOX_Y_MIN = -2;
const BOX_Y_MAX = 18;
/** Vent lleuger cap al sud-oest, com el cel (sky.ts). */
const WIND = new THREE.Vector3(-0.45, 0.02, 0.28);

const DUST_COUNT = 160;
const DUST_LIFE_S = 1.35;

type DustSlot = {
  life: number;
  maxLife: number;
};

let moteSprite: THREE.Texture | null = null;

function softSpriteMap(): THREE.Texture {
  if (moteSprite) {
    return moteSprite;
  }
  const s = 64;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(s * 0.5, s * 0.5, 0, s * 0.5, s * 0.5, s * 0.5);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.35, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  moteSprite = new THREE.CanvasTexture(canvas);
  moteSprite.minFilter = THREE.LinearFilter;
  moteSprite.magFilter = THREE.LinearFilter;
  moteSprite.generateMipmaps = false;
  return moteSprite;
}

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

export type DriveSurface = "paved" | "dirt" | "offroad";

export type AirParticlesDrive = {
  position: THREE.Vector3;
  heading: number;
  speed: number;
  surface: DriveSurface;
};

export class AirParticles {
  /** Segueix la càmera (posició i rumb); no es pot penjar de `camera` perquè no es recorre en el render. */
  private readonly ambientAnchor = new THREE.Group();
  private readonly windLocal = new THREE.Vector3();
  private readonly ambientPos: Float32Array;
  private readonly ambientVel: Float32Array;
  private readonly ambientPhase: Float32Array;
  private readonly ambientPoints: THREE.Points;
  private readonly ambientMat: THREE.PointsMaterial;

  private readonly dustPos: Float32Array;
  private readonly dustVel: Float32Array;
  private readonly dustLife: Float32Array;
  private readonly dustSize: Float32Array;
  private readonly dustSlots: DustSlot[];
  private readonly dustPoints: THREE.Points;
  private readonly dustMat: THREE.ShaderMaterial;
  private dustCursor = 0;
  private elapsed = 0;

  constructor(scene: THREE.Scene, _camera: THREE.PerspectiveCamera, _sunDir: THREE.Vector3, layer: number) {
    this.ambientAnchor.frustumCulled = false;
    scene.add(this.ambientAnchor);

    this.ambientPos = new Float32Array(AMBIENT_COUNT * 3);
    this.ambientVel = new Float32Array(AMBIENT_COUNT * 3);
    this.ambientPhase = new Float32Array(AMBIENT_COUNT);

    for (let i = 0; i < AMBIENT_COUNT; i++) {
      this.respawnAmbient(i, true);
    }

    const ambGeo = new THREE.BufferGeometry();
    ambGeo.setAttribute("position", new THREE.BufferAttribute(this.ambientPos, 3));

    this.ambientMat = new THREE.PointsMaterial({
      map: softSpriteMap(),
      color: 0xf2e6d4,
      size: 3.8,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.52,
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
  }

  setSunDirection(_dir: THREE.Vector3): void {
    // Reservat per un eventual parpelleig direccional.
  }

  syncFog(fog: THREE.Fog | THREE.FogExp2 | null): void {
    if (!fog) {
      return;
    }
    const u = this.dustMat.uniforms;
    u.uFogColor.value.copy(fog.color);
    if (fog instanceof THREE.Fog) {
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
    }
  }

  private respawnAmbient(i: number, initial: boolean): void {
    const x = (Math.random() - 0.5) * BOX_X * 2;
    const y = THREE.MathUtils.lerp(BOX_Y_MIN, BOX_Y_MAX, Math.random());
    const z = -THREE.MathUtils.lerp(BOX_Z_NEAR, BOX_Z_FAR, Math.random());
    this.ambientPos[i * 3] = x;
    this.ambientPos[i * 3 + 1] = y;
    this.ambientPos[i * 3 + 2] = z;

    const drift = 0.15 + Math.random() * 0.35;
    this.ambientVel[i * 3] = WIND.x * drift + (Math.random() - 0.5) * 0.1;
    this.ambientVel[i * 3 + 1] = (Math.random() - 0.5) * 0.05;
    this.ambientVel[i * 3 + 2] = WIND.z * drift + (Math.random() - 0.5) * 0.06;

    this.ambientPhase[i] = Math.random() * Math.PI * 2;

    if (!initial) {
      this.ambientPhase[i] += this.elapsed;
    }
  }

  private wrapAmbient(i: number, camera: THREE.PerspectiveCamera): void {
    const x = this.ambientPos[i * 3];
    const y = this.ambientPos[i * 3 + 1];
    const z = this.ambientPos[i * 3 + 2];
    if (
      Math.abs(x) > BOX_X ||
      z > -BOX_Z_NEAR ||
      z < -BOX_Z_FAR ||
      y < BOX_Y_MIN - 1 ||
      y > BOX_Y_MAX + 2
    ) {
      this.respawnAmbient(i, false);
      return;
    }
    // El vent és al món; el passem a l'espai de la càmera perquè el moviment quadri en girar.
    this.windLocal.copy(WIND).applyQuaternion(camera.quaternion);
    const drift = 0.2 + (i % 5) * 0.04;
    this.ambientVel[i * 3] += this.windLocal.x * drift * 0.02;
    this.ambientVel[i * 3 + 2] += this.windLocal.z * drift * 0.02;
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

  update(dt: number, camera: THREE.PerspectiveCamera, drive?: AirParticlesDrive): void {
    this.elapsed += dt;
    this.ambientMat.opacity = 0.46 + 0.08 * Math.sin(this.elapsed * 0.9);

    this.ambientAnchor.position.copy(camera.position);
    this.ambientAnchor.quaternion.copy(camera.quaternion);
    this.ambientAnchor.updateMatrixWorld(true);

    const posAttr = this.ambientPoints.geometry.getAttribute("position") as THREE.BufferAttribute;

    for (let i = 0; i < AMBIENT_COUNT; i++) {
      this.ambientPos[i * 3] += this.ambientVel[i * 3] * dt;
      this.ambientPos[i * 3 + 1] += this.ambientVel[i * 3 + 1] * dt;
      this.ambientPos[i * 3 + 2] += this.ambientVel[i * 3 + 2] * dt;
      this.ambientPhase[i] += dt * (0.6 + (i % 7) * 0.08);
      this.wrapAmbient(i, camera);
    }
    posAttr.needsUpdate = true;

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

    if (!drive) {
      return;
    }
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
