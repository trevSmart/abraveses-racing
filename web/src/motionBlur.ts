// Desenfoc de moviment en una sola passada, a mitja resolució.
//
// El vel uniforme segueix només el gir de la càmera (òrbita o revolt): anar recte no
// desplaça el punt de mira, i un traç igual a tot el fotograma taparia la carretera.
// La marxa no obre aquesta passada: un vel a cada fotograma, encara que sigui curt, es menja
// el refresc. El canvas de sota es conserva on el vel del gir no arriba,
// així el centre no baixa a mitja resolució.
//
// L'escena es pinta al canvas. Parat i sense gir, no es fa cap passada extra.

import * as THREE from "three";

const SAMPLES = 6;
/** Límit del vector de gir en UV per fotograma (evita estrebades en respawn). */
const MAX_VELOCITY_UV = 0.028;
/** Desplaçament en UV a partir del qual el gir comença a desenfocar, i on arriba al màxim. */
const TURN_MIN_UV = 0.0025;
const TURN_FULL_UV = 0.01;
/** Traç del gir. Curt a propòsit: en orbitar, un vel fort tapa el que es mira. */
const TURN_INTENSITY = 0.5;
/** Per sota d'això el traç del gir no es veu. */
const MIN_BLUR_PX = 1.25;
/** El vel del gir arriba al màxim cap a aquest traç (px). */
const FULL_BLUR_PX = 8;
/** Marxa (m/s) on l'efecte radial comença i on arriba al màxim. */
const SPEED_MIN_MPS = 6;
const SPEED_FULL_MPS = 32;
/** El desenfoc es calcula a aquesta fracció del framebuffer. */
const BLUR_SCALE = 0.5;

const _dir = new THREE.Vector3();
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
uniform float uSpeed;
uniform float uAspect;
uniform float uPhase;
varying vec2 vUv;

void main() {
  vec2 center = vec2(0.5, 0.5);
  vec2 fromCenter = vUv - center;
  float r = length(fromCenter * vec2(uAspect, 1.0));

  vec2 v = velocity * intensity;
  float len = length(v);
  if (len > ${MAX_VELOCITY_UV.toFixed(5)}) {
    v *= ${MAX_VELOCITY_UV.toFixed(5)} / len;
  }
  vec3 dirColor = texture2D(tDiffuse, vUv).rgb;
  float n = 1.0;
  for (int i = 1; i < ${SAMPLES}; i++) {
    float t = float(i) / float(${SAMPLES - 1});
    dirColor += texture2D(tDiffuse, vUv - v * t).rgb;
    n += 1.0;
  }
  dirColor /= n;

  // La marxa només enfosqueix una mica els cantons, sense mostres de més.
  float vig = smoothstep(0.72, 1.3, r) * uSpeed * 0.22;
  float ang = atan(fromCenter.y, fromCenter.x * uAspect);
  float spoke = abs(fract(ang * 2.228) - 0.5);
  float along = fract(r * 5.0 - uPhase);
  float dash = smoothstep(0.0, 0.06, along) * (1.0 - smoothstep(0.28, 0.48, along));
  float line = smoothstep(0.035, 0.0, spoke) * dash;
  line *= smoothstep(0.88, 1.1, r) * uSpeed;

  float keep = (1.0 - uFade) * (1.0 - vig);
  vec3 src = dirColor * uFade * (1.0 - vig);
  src += vec3(0.86, 0.82, 0.74) * line * 0.08;
  gl_FragColor = vec4(src, 1.0 - keep);
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
  /** Desplaçament en UV degut només al gir de la càmera. */
  private readonly velocity = new THREE.Vector2();
  private readonly prevQuat = new THREE.Quaternion();
  private hasPrev = false;
  private bufW = 0;
  private bufH = 0;
  private lowW = 1;
  private lowH = 1;
  /** Framebuffer del target `low`, per al blit. Es refà quan canvia la mida. */
  private lowFbo: WebGLFramebuffer | null = null;
  /** null = encara no provat; false = el context no admet el blit escalat. */
  private blitOk: boolean | null = null;
  /** Fase de les ratlles, en cicles, avançada amb la distància recorreguda. */
  private streakPhase = 0;
  private lastMs = 0;
  private hasClock = false;

  constructor() {
    this.low = halfTarget();

    this.presentMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.low.texture },
        velocity: { value: this.velocity },
        intensity: { value: 0 },
        uFade: { value: 0 },
        uSpeed: { value: 0 },
        uAspect: { value: 1 },
        uPhase: { value: 0 },
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
  }

  private updateRotation(camera: THREE.PerspectiveCamera): void {
    camera.getWorldQuaternion(_quat);
    if (this.hasPrev) {
      // La mirada anterior, en coordenades de la càmera actual.
      _dir.set(0, 0, -1).applyQuaternion(this.prevQuat);
      _dir.applyQuaternion(_quatInv.copy(_quat).invert());
      if (_dir.z < -0.05) {
        const vFov = THREE.MathUtils.degToRad(camera.fov);
        const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * camera.aspect);
        const ndcX = _dir.x / -_dir.z / Math.tan(hFov * 0.5);
        const ndcY = _dir.y / -_dir.z / Math.tan(vFov * 0.5);
        this.velocity.set(ndcX * 0.5, ndcY * 0.5);
      } else {
        this.velocity.set(0, 0);
      }
    } else {
      this.velocity.set(0, 0);
    }
    this.prevQuat.copy(_quat);
    this.hasPrev = true;
  }

  /** Longitud del traç de gir en píxels del framebuffer, ja amb el sostre del shader. */
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
   * Dibuixa l'escena i, si la càmera gira, el vel a sobre.
   * Anar recte no obre la passada.
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
    this.updateRotation(camera);

    const now = performance.now();
    if (this.hasClock) {
      const dt = Math.min(0.05, (now - this.lastMs) / 1000);
      this.streakPhase = (this.streakPhase + Math.abs(speedMps) * dt * 0.12) % 1;
    }
    this.lastMs = now;
    this.hasClock = true;

    const turnT = THREE.MathUtils.smoothstep(this.velocity.length(), TURN_MIN_UV, TURN_FULL_UV);
    const intensity = turnT * TURN_INTENSITY;
    const rotFade = THREE.MathUtils.smoothstep(this.blurPixels(intensity), MIN_BLUR_PX, FULL_BLUR_PX);
    const speedT = THREE.MathUtils.smoothstep(Math.abs(speedMps), SPEED_MIN_MPS, SPEED_FULL_MPS);
    // Anar recte no obre la passada: el cost és el d'un fotograma sencer de mostres.
    if (rotFade <= 0 || !this.downsample(renderer)) {
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      return;
    }

    const uniforms = this.presentMaterial.uniforms;
    uniforms.intensity.value = intensity;
    uniforms.uFade.value = rotFade;
    uniforms.uSpeed.value = speedT;
    uniforms.uAspect.value = this.bufW / Math.max(1, this.bufH);
    uniforms.uPhase.value = this.streakPhase;
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
