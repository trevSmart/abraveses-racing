import {
  type BufferGeometry,
  type Camera,
  type Intersection,
  Box3,
  type Mesh,
  type Object3D,
  Vector3,
} from "three";

/** Identificador de casa al vèrtex de la cara colpejada (0 = no és cap casa). */
export function houseIdFromHit(hit: Intersection): number {
  const geom = (hit.object as { geometry?: BufferGeometry }).geometry;
  if (!geom || hit.faceIndex == null) {
    return 0;
  }
  const attr = geom.getAttribute("houseId");
  if (!attr) {
    return 0;
  }
  const index = geom.index;
  const vert = index ? index.getX(hit.faceIndex * 3) : hit.faceIndex * 3;
  return Math.round(attr.getX(vert));
}

/** Referència cadastral del mapa exportat a village.json, o null si no n'hi ha. */
export function resolveHouseRef(houses: Record<string, string>, houseId: number): string | null {
  if (houseId < 1) {
    return null;
  }
  return houses[String(houseId)] ?? null;
}

/** Centre 3D (món) de cada casa, per ancorar el tooltip DEV sense seguir el ratolí. */
export function buildHouseCenters(meshes: Object3D[]): Map<number, Vector3> {
  const boxes = new Map<number, Box3>();
  const v = new Vector3();
  for (const obj of meshes) {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) {
      continue;
    }
    const geom = mesh.geometry as BufferGeometry;
    const houseIdAttr = geom.getAttribute("houseId");
    const posAttr = geom.getAttribute("position");
    if (!houseIdAttr || !posAttr) {
      continue;
    }
    mesh.updateWorldMatrix(true, false);
    const mw = mesh.matrixWorld;
    for (let i = 0; i < houseIdAttr.count; i++) {
      const id = Math.round(houseIdAttr.getX(i));
      if (id < 1) {
        continue;
      }
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mw);
      let box = boxes.get(id);
      if (!box) {
        box = new Box3();
        boxes.set(id, box);
      }
      box.expandByPoint(v);
    }
  }
  const centers = new Map<number, Vector3>();
  for (const [id, box] of boxes) {
    centers.set(id, box.getCenter(new Vector3()));
  }
  return centers;
}

/** Projecta el centre d'una casa a coordenades de pantalla (CSS px). */
export function houseCenterToClient(
  centers: Map<number, Vector3>,
  houseId: number,
  camera: Camera,
  rect: DOMRect,
  scratch: Vector3,
): { x: number; y: number } | null {
  const center = centers.get(houseId);
  if (!center) {
    return null;
  }
  scratch.copy(center).project(camera);
  if (scratch.z < -1 || scratch.z > 1) {
    return null;
  }
  return {
    x: rect.left + (scratch.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-scratch.y * 0.5 + 0.5) * rect.height,
  };
}
