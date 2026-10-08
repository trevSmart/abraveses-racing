// Bandades de grues (Grus grus) al cel: ocell característic de la vall del Tera i la plana de Zamora.
// Apareixen de tant en tant, molt per sobre del terreny, en silueta contra el cel.

import * as THREE from "three";

const BIRD_COLOR = 0x1a1816;
const ALTITUDE_M = 95;
const ALTITUDE_JITTER = 18;
const CRUISE_SPEED = 38;
const WING_SPAN_M = 2.1;
const WING_FLAP_HZ = 2.4;

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
const craneMat = new THREE.LineBasicMaterial({ color: BIRD_COLOR, transparent: true, opacity: 0.82 });

function makeBird(offset: THREE.Vector3, lag: number): THREE.LineSegments {
  const mesh = new THREE.LineSegments(craneGeo, craneMat);
  mesh.position.copy(offset);
  mesh.userData.lag = lag;
  return mesh;
}

function randomFlockDirection(): THREE.Vector3 {
  const angle = Math.random() * Math.PI * 2;
  const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();
  // Lleuger rumb cap al nord oest, com les migracions cap a Gallocanta / la plana.
  dir.x += 0.12;
  dir.z -= 0.08;
  return dir.normalize();
}

export class CraneFlocks {
  private readonly scene: THREE.Scene;
  private readonly flocks: Flock[] = [];
  private elapsed = 0;
  private nextSpawn = 55 + Math.random() * 90;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private spawn(camera: THREE.PerspectiveCamera): void {
    const count = 5 + Math.floor(Math.random() * 9);
    const dir = randomFlockDirection();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const root = new THREE.Group();
    const y = ALTITUDE_M + (Math.random() - 0.5) * ALTITUDE_JITTER;
    const ahead = 280 + Math.random() * 120;
    const lateral = (Math.random() - 0.5) * 180;
    root.position
      .copy(camera.position)
      .addScaledVector(dir, ahead)
      .addScaledVector(right, lateral);
    root.position.y = y;

    const birds: THREE.LineSegments[] = [];
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) * 0.5) * (WING_SPAN_M * 1.35 + Math.random() * 0.4);
      const side = (Math.random() - 0.5) * 4;
      const bird = makeBird(new THREE.Vector3(-dir.x * along + right.x * side, (Math.random() - 0.5) * 2, -dir.z * along + right.z * side), i * 0.37);
      root.add(bird);
      birds.push(bird);
    }
    root.lookAt(root.position.clone().add(dir));
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
      this.nextSpawn = 70 + Math.random() * 130;
    }

    const cam = camera.position;
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const f = this.flocks[i];
      f.root.position.addScaledVector(f.dir, f.speed * dt);
      f.phase += dt * WING_FLAP_HZ * Math.PI * 2;
      for (const bird of f.birds) {
        const lag = (bird.userData.lag as number) ?? 0;
        const flap = Math.sin(f.phase + lag) * 0.35;
        bird.rotation.z = flap;
      }
      if (f.root.position.distanceTo(cam) > 520) {
        this.scene.remove(f.root);
        this.flocks.splice(i, 1);
      }
    }
  }
}
