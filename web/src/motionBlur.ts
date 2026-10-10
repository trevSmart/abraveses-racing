// Motion blur lleuger: mostres al llarg del desplaçament en pantalla de la càmera (velocitat + gir).
//
// L'escena es pinta al canvas (camí ràpid de la GPU). El desenfoc és una sola passada a pantalla
// completa que llegeix una còpia a mitja resolució: a 120 Hz un segon render de l'escena feia
// perdre el fotograma. Parat, o amb un traç de menys d'un píxel, no es fa cap passada extra.

import * as THREE from "three";

const SAMPLES = 6;
const PROBE_M = 18;
/** Velocitat (m/s) a partir de la qual el desenfoc arriba al màxim. */
const SPEED_FULL_MPS = 26;
/** Intensitat màxima del desenfoc (0 = off). */
const MAX_INTENSITY = 0.42;
/** Límit del vector de velocitat en UV per fotograma (evita estrebades en respawn). */
const MAX_VELOCITY_UV = 0.028;
/** Desplaçament en UV a partir del qual el gir de la càmera comença a desenfocar, i on arriba al màxim. */
const TURN_MIN_UV = 0.0025;
const TURN_FULL_UV = 0.01;
/** Traç del gir (òrbita o revolt). Curt a propòsit: en orbitar, un vel fort tapa el que es mira. */
const TURN_INTENSITY = 0.5;
/** Per sota d'això el traç no es veu: no val la pena copiar el framebuffer. */
const MIN_BLUR_PX = 1.25;
/** El vel arriba al màxim cap a aquest traç (px), perquè no aparegui de cop. */
const FULL_BLUR_PX = 8;
/** El desenfoc es calcula a aquesta fracció del framebuffer. */
const BLUR_SCALE = 0.5;

const _dir = new THREE.Vector3();
const _ndcPrev = new THREE.Vector3();
const _ndcCurr = new THREE.Vector3();
const _viewProj = new THREE.Matrix4();
const _bufSize = new THREE.Vector2();
const _quat = new THREE.Quaternion();
const _quatInv = new THREE.Quaternion();

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const presentFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 velocity;
uniform float intensity;
uniform float uFade;
varying vec2 vUv;
void main() {
  vec4 acc = texture2D(tDiffuse, vUv);
  vec2 v = velocity * intensity;
  float len = length(v);
  if (len > ${MAX_VELOCITY_UV.toFixed(5)}) {
    v *= ${MAX_VELOCITY_UV.toFixed(5)} / len;
  }
  float n = 1.0;
  for (int i = 1; i < ${SAMPLES}; i++) {
    float t = float(i) / float(${SAMPLES - 1});
    acc += texture2D(tDiffuse, vUv - v * t);
    n += 1.0;
  }
  vec3 c = (acc / n).rgb;
  // Premultiplicat: el canvas ja ho és, i així el vel no enfosqueix.
  gl_FragColor = vec4(c * uFade, uFade);
}
`;

function halfTarget(): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

export class MotionBlur {
  /** Còpia a mitja resolució del canvas (imatge final, ja amb to i sRGB). */
  private readonly low: THREE.WebGLRenderTarget;
  private readonly presentScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly presentMaterial: THREE.ShaderMaterial;
  private readonly velocity = new THREE.Vector2();
  /** Desplaçament en UV degut només al gir de la càmera (òrbita o revolt). */
  private readonly rotVelocity = new THREE.Vector2();
  private readonly viewProjPrev = new THREE.Matrix4();
  private readonly prevQuat = new THREE.Quaternion();
  /** Punt al món que es projecta per estimar el desplaçament en pantalla. */
  private readonly probeWorld = new THREE.Vector3();
  private hasPrev = false;
  private bufW = 0;
  private bufH = 0;
  private lowW = 1;
  private lowH = 1;
  /** Framebuffer del target `low`, per al blit. Es refà quan canvia la mida. */
  private lowFbo: WebGLFramebuffer | null = null;
  /** null = encara no provat; false = el context no admet el blit escalat. */
  private blitOk: boolean | null = null;

  constructor() {
    this.low = halfTarget();

    this.presentMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.low.texture },
        velocity: { value: this.velocity },
        intensity: { value: 0 },
        uFade: { value: 0 },
      },
      vertexShader: quadVert,
      fragmentShader: presentFrag,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const presentQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.presentMaterial);
    presentQuad.frustumCulled = false;
    this.presentScene.add(presentQuad);
  }

  /** Aliniar els targets amb el renderer (inclou pixel ratio). */
  setSizeFromRenderer(renderer: THREE.WebGLRenderer): void {
    renderer.getDrawingBufferSize(_bufSize);
    const w = Math.max(1, Math.floor(_bufSize.x));
    const h = Math.max(1, Math.floor(_bufSize.y));
    if (w === this.bufW && h === this.bufH) {
      return;
    }
    this.bufW = w;
    this.bufH = h;
    this.lowW = Math.max(1, Math.floor(w * BLUR_SCALE));
    this.lowH = Math.max(1, Math.floor(h * BLUR_SCALE));
    this.low.setSize(this.lowW, this.lowH);
    this.lowFbo = null;
    this.blitOk = null;
    this.reset();
  }

  /** Després d'un salt de càmera (respawn): sense barrejar amb el fotograma anterior. */
  reset(): void {
    this.hasPrev = false;
    this.velocity.set(0, 0);
    this.rotVelocity.set(0, 0);
  }

  private updateVelocity(camera: THREE.PerspectiveCamera): void {
    _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    camera.getWorldQuaternion(_quat);
    if (this.hasPrev) {
      _ndcCurr.copy(this.probeWorld).applyMatrix4(_viewProj);
      _ndcPrev.copy(this.probeWorld).applyMatrix4(this.viewProjPrev);
      this.velocity.set((_ndcCurr.x - _ndcPrev.x) * 0.5, (_ndcCurr.y - _ndcPrev.y) * 0.5);
      // La vista anterior, en coordenades de la càmera actual: l'òrbita gira al voltant
      // del punt de mira i el punt de prova (just allà) gairebé no es mou.
      _dir.set(0, 0, -1).applyQuaternion(this.prevQuat);
      _dir.applyQuaternion(_quatInv.copy(_quat).invert());
      if (_dir.z < -0.05) {
        const vFov = THREE.MathUtils.degToRad(camera.fov);
        const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * camera.aspect);
        const ndcX = _dir.x / -_dir.z / Math.tan(hFov * 0.5);
        const ndcY = _dir.y / -_dir.z / Math.tan(vFov * 0.5);
        this.rotVelocity.set(ndcX * 0.5, ndcY * 0.5);
      } else {
        this.rotVelocity.set(0, 0);
      }
    } else {
      this.velocity.set(0, 0);
      this.rotVelocity.set(0, 0);
    }
    camera.getWorldDirection(_dir);
    this.probeWorld.copy(camera.position).addScaledVector(_dir, PROBE_M);
    this.viewProjPrev.copy(_viewProj);
    this.prevQuat.copy(_quat);
    this.hasPrev = true;
  }

  /** Longitud del traç en píxels del framebuffer, ja amb el sostre del shader. */
  private blurPixels(intensity: number): number {
    let len = this.velocity.length() * intensity;
    if (len > MAX_VELOCITY_UV) {
      len = MAX_VELOCITY_UV;
    }
    return len * Math.max(this.bufW, this.bufH);
  }

  /** Copia el canvas a `low` reduint-lo. Torna false si el context no pot fer el blit. */
  private downsample(renderer: THREE.WebGLRenderer): boolean {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.blitFramebuffer !== "function" || this.blitOk === false) {
      return false;
    }
    if (!this.lowFbo) {
      renderer.setRenderTarget(this.low);
      renderer.setRenderTarget(null);
      const props = renderer.properties.get(this.low) as { __webglFramebuffer?: WebGLFramebuffer };
      this.lowFbo = props.__webglFramebuffer ?? null;
      if (!this.lowFbo) {
        return false;
      }
    }
    const state = renderer.state;
    state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.lowFbo);
    if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      this.lowFbo = null;
      state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      return false;
    }
    gl.blitFramebuffer(
      0,
      0,
      this.bufW,
      this.bufH,
      0,
      0,
      this.lowW,
      this.lowH,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR,
    );
    if (this.blitOk === null) {
      // getError força una sincronització: només el primer fotograma.
      this.blitOk = gl.getError() === gl.NO_ERROR;
    }
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    return this.blitOk === true;
  }

  /**
   * Dibuixa l'escena i, si el cotxe es mou o la càmera gira, un vel de desenfoc a sobre.
   * `speedMps` és la marxa; el gir (òrbita o revolt) es mesura pel desplaçament en pantalla.
   */
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    speedMps: number,
  ): void {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    renderer.render(scene, camera);

    this.setSizeFromRenderer(renderer);
    this.updateVelocity(camera);

    const speed = Math.abs(speedMps);
    const speedAmount = THREE.MathUtils.smoothstep(speed, 2.5, SPEED_FULL_MPS) * MAX_INTENSITY;
    const turnT = THREE.MathUtils.smoothstep(this.rotVelocity.length(), TURN_MIN_UV, TURN_FULL_UV);
    const turnAmount = turnT * TURN_INTENSITY;
    const intensity = Math.max(speedAmount, turnAmount);
    if (turnAmount > speedAmount) {
      this.velocity.copy(this.rotVelocity);
    }
    const blurPx = this.blurPixels(intensity);
    const fade = THREE.MathUtils.smoothstep(blurPx, MIN_BLUR_PX, FULL_BLUR_PX);
    if (fade <= 0 || !this.downsample(renderer)) {
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      return;
    }

    this.presentMaterial.uniforms.intensity.value = intensity;
    this.presentMaterial.uniforms.uFade.value = fade;
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    renderer.render(this.presentScene, this.quadCam);

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.low.dispose();
    this.presentMaterial.dispose();
  }
}
