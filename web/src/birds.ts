// Bandades de grues (Grus grus) al cel: ocell característic de la vall del Tera i la plana de Zamora.
// Apareixen de tant en tant, molt per sobre del terreny, en silueta contra el cel.

import * as THREE from "three";

const BIRD_COLOR = 0x1a1816;
/** Altura sobre la càmera (no Y absoluta del món). */
const ALTITUDE_ABOVE_CAM_M = 55;
const ALTITUDE_JITTER = 22;
const CRUISE_SPEED = 32;
/** Envergadura exagerada perquè es llegeixin a distància de joc. */
const WING_SPAN_M = 4.2;
const WING_FLAP_HZ = 2.2;
const DESPAWN_DIST_M = 420;

type Flock = {
  root: THREE.Group;
  dir: THREE.Vector3;
  speed: number;
  phase: number;
  birds: THREE.LineSegments[];
};

function craneSilhouette(): THREE.BufferGeometry {
  const body = new THREE.Vector3(0, 0, 0);
  const head = new THREE.Vector3(0.55, 0.08, 0);
  const tail = new THREE.Vector3(-0.7, 0.02, 0);
  const wingL = new THREE.Vector3(-0.05, 0, WING_SPAN_M * 0.5);
  const wingR = new THREE.Vector3(-0.05, 0, -WING_SPAN_M * 0.5);
  const verts = new Float32Array([
    ...body.toArray(),
    ...head.toArray(),
    ...body.toArray(),
    ...tail.toArray(),
    ...body.toArray(),
    ...wingL.toArray(),
    ...body.toArray(),
    ...wingR.toArray(),
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  return geo;
}

const craneGeo = craneSilhouette();
// Sense boira: si no, a 150–300 m es fonen amb el color del cel i desapareixen.
const craneMat = new THREE.LineBasicMaterial({
  color: BIRD_COLOR,
  transparent: true,
  opacity: 0.9,
  fog: false,
  depthWrite: false,
});

function makeBird(offset: THREE.Vector3, lag: number): THREE.LineSegments {
  const mesh = new THREE.LineSegments(craneGeo, craneMat);
  mesh.position.copy(offset);
  mesh.userData.lag = lag;
  mesh.frustumCulled = false;
  return mesh;
}

export class CraneFlocks {
  private readonly scene: THREE.Scene;
  private readonly flocks: Flock[] = [];
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly nose = new THREE.Vector3(1, 0, 0);
  private elapsed = 0;
  private nextSpawn = 18 + Math.random() * 28;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private spawn(camera: THREE.PerspectiveCamera): void {
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) {
      this.forward.set(0, 0, -1);
    } else {
      this.forward.normalize();
    }
    this.right.crossVectors(this.forward, this.up).normalize();

    // Travessen el camp de visió: entren per un costat i surten per l'altre.
    const across = Math.random() < 0.5 ? 1 : -1;
    const dir = this.right.clone().multiplyScalar(across);
    dir.addScaledVector(this.forward, 0.15 + Math.random() * 0.25);
    // Lleuger rumb cap al nord-oest, com les migracions cap a Gallocanta / la plana.
    dir.x += 0.08;
    dir.z -= 0.05;
    dir.normalize();

    const pathRight = new THREE.Vector3(-dir.z, 0, dir.x);
    const count = 6 + Math.floor(Math.random() * 8);
    const root = new THREE.Group();
    const y = camera.position.y + ALTITUDE_ABOVE_CAM_M + (Math.random() - 0.5) * ALTITUDE_JITTER;
    const ahead = 90 + Math.random() * 70;
    const lateral = across * -(70 + Math.random() * 50);
    root.position
      .copy(camera.position)
      .addScaledVector(this.forward, ahead)
      .addScaledVector(this.right, lateral);
    root.position.y = y;

    const birds: THREE.LineSegments[] = [];
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) * 0.5) * (WING_SPAN_M * 1.15 + Math.random() * 0.5);
      const side = (Math.random() - 0.5) * 5;
      const bird = makeBird(
        new THREE.Vector3(
          -dir.x * along + pathRight.x * side,
          (Math.random() - 0.5) * 2.5,
          -dir.z * along + pathRight.z * side,
        ),
        i * 0.37,
      );
      root.add(bird);
      birds.push(bird);
    }
    // El cos de la silueta va sobre +X: l'alineem amb el rumb de vol.
    root.quaternion.setFromUnitVectors(this.nose, dir);
    this.scene.add(root);
    this.flocks.push({
      root,
      dir,
      speed: CRUISE_SPEED * (0.85 + Math.random() * 0.25),
      phase: Math.random() * Math.PI * 2,
      birds,
    });
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.elapsed += dt;
    if (this.flocks.length === 0 && this.elapsed >= this.nextSpawn) {
      this.spawn(camera);
      this.elapsed = 0;
      this.nextSpawn = 45 + Math.random() * 80;
    }

    const cam = camera.position;
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const f = this.flocks[i];
      f.root.position.addScaledVector(f.dir, f.speed * dt);
      f.phase += dt * WING_FLAP_HZ * Math.PI * 2;
      for (const bird of f.birds) {
        const lag = (bird.userData.lag as number) ?? 0;
        bird.rotation.z = Math.sin(f.phase + lag) * 0.35;
      }
      if (f.root.position.distanceTo(cam) > DESPAWN_DIST_M) {
        this.scene.remove(f.root);
        this.flocks.splice(i, 1);
      }
    }
  }
}
