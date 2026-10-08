import type { BufferGeometry, Intersection } from "three";

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
