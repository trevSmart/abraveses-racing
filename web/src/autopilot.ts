// Autopilot: segueix l'eix dels carrers de l'OSM (pure pursuit) i tria camí a cada cruïlla.
// Condueix com un cotxe real: velocitats de poble i maniobra amb marxa enrere als carrerons.

import { turnRadius, type VehicleInput } from "./vehicle";

export type DriveInput = VehicleInput;

type GraphNode = { x: number; z: number; links: number[] };

/** ~45 km/h, velocitat de travessia de poble. */
const CRUISE_SPEED = 12.5;
/** ~16 km/h als revolts tancats i cruïlles. */
const MIN_CORNER_SPEED = 4.5;
/** A tot gir de volant, ~9 km/h. */
const MANEUVER_SPEED = 2.5;
/** Si l'objectiu queda més enrere que això (rad), s'atura i fa marxa enrere. */
const REVERSE_ANGLE = 1.75;
const REVERSE_DONE_ANGLE = 0.6;
const REVERSE_MAX_S = 3.5;
/** Desacceleració que fa servir per planificar la frenada abans dels revolts (m/s²). */
const PLAN_DECEL = 13;
const PLAN_AHEAD_M = 45;
const NODE_REACHED_M = 2.5;
const OFF_ROUTE_M = 10;

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export class Autopilot {
  private nodes: GraphNode[] = [];
  private prev = -1;
  private route: number[] = [];
  private visits = new Map<number, number>();
  private projX = 0;
  private projZ = 0;
  private reversing = false;
  private reverseTime = 0;

  constructor(polylines: [number, number][][]) {
    // Les vies de l'OSM comparteixen vèrtexs exactes a les cruïlles: el vèrtex és el node.
    const index = new Map<string, number>();
    const nodeAt = (x: number, z: number): number => {
      const key = `${Math.round(x * 10)},${Math.round(z * 10)}`;
      let i = index.get(key);
      if (i === undefined) {
        i = this.nodes.length;
        this.nodes.push({ x, z, links: [] });
        index.set(key, i);
      }
      return i;
    };
    for (const line of polylines) {
      for (let k = 1; k < line.length; k++) {
        const a = nodeAt(line[k - 1][0], line[k - 1][1]);
        const b = nodeAt(line[k][0], line[k][1]);
        if (a === b || this.nodes[a].links.includes(b)) {
          continue;
        }
        this.nodes[a].links.push(b);
        this.nodes[b].links.push(a);
      }
    }
  }

  get ready(): boolean {
    return this.nodes.length > 1;
  }

  reset(): void {
    this.prev = -1;
    this.route = [];
    this.reversing = false;
  }

  /** Camí previst des del kart, per dibuixar-lo al minimapa. */
  plannedPath(): [number, number][] {
    if (this.prev < 0) {
      return [];
    }
    return [[this.projX, this.projZ], ...this.route.map((i) => [this.nodes[i].x, this.nodes[i].z] as [number, number])];
  }

  update(x: number, z: number, heading: number, speed: number, dt: number): DriveInput {
    if (!this.ready) {
      return { throttle: 0, steer: 0, brake: true };
    }
    if (this.prev < 0 || this.route.length === 0) {
      this.acquire(x, z, heading);
    }
    this.advance(x, z);
    if (this.distanceToSegment(x, z) > OFF_ROUTE_M) {
      this.acquire(x, z, heading);
      this.advance(x, z);
    }
    this.extendRoute();

    const path = this.plannedPath();
    const v = Math.abs(speed);
    const lookahead = Math.max(4, 3 + v * 0.5);
    const [tx, tz] = this.pointAlong(path, lookahead);
    const diff = wrapAngle(Math.atan2(tx - x, tz - z) - heading);

    if (this.reversing) {
      // Marxa enrere amb el volant cap al costat contrari: el morro gira cap a l'objectiu.
      this.reverseTime += dt;
      if (Math.abs(diff) > REVERSE_DONE_ANGLE && this.reverseTime < REVERSE_MAX_S) {
        return { throttle: speed > -MANEUVER_SPEED ? -0.6 : 0, steer: diff > 0 ? 1 : -1, brake: false };
      }
      this.reversing = false;
    }
    if (Math.abs(diff) > REVERSE_ANGLE) {
      if (v < 0.3) {
        this.reversing = true;
        this.reverseTime = 0;
      }
      return { throttle: 0, steer: 0, brake: true };
    }

    // Pure pursuit: curvatura 2·sin(α)/L, convertida a volant amb el radi de gir a aquesta velocitat.
    // Al joc, girar a la dreta (steer > 0) fa baixar el heading.
    const curvature = (2 * Math.sin(diff)) / lookahead;
    const steer = clamp(-curvature * turnRadius(speed), -1, 1);

    // Mira prou lluny per frenar a temps abans del revolt.
    const bend = this.bendAhead(path, 8 + v + (v * v) / (2 * PLAN_DECEL));
    let target = CRUISE_SPEED + (MIN_CORNER_SPEED - CRUISE_SPEED) * clamp(bend / (Math.PI / 2), 0, 1);
    if (Math.abs(diff) > REVERSE_DONE_ANGLE) {
      target = Math.min(target, MANEUVER_SPEED);
    }
    if (speed < target - 0.3) {
      return { throttle: clamp((target - speed) * 0.6, 0.25, 1), steer, brake: false };
    }
    return { throttle: 0, steer, brake: speed > target + 1 };
  }

  private acquire(x: number, z: number, heading: number): void {
    let best = Infinity;
    let bestA = -1;
    let bestB = -1;
    this.nodes.forEach((n, a) => {
      for (const b of n.links) {
        const d = this.pointSegmentDistance(x, z, a, b);
        if (d < best) {
          best = d;
          bestA = a;
          bestB = b;
        }
      }
    });
    if (bestA < 0) {
      return;
    }
    const A = this.nodes[bestA];
    const B = this.nodes[bestB];
    const forward = (B.x - A.x) * Math.sin(heading) + (B.z - A.z) * Math.cos(heading) >= 0;
    this.prev = forward ? bestA : bestB;
    this.route = [forward ? bestB : bestA];
  }

  private advance(x: number, z: number): void {
    while (this.route.length > 0) {
      const a = this.nodes[this.prev];
      const b = this.nodes[this.route[0]];
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const len2 = vx * vx + vz * vz || 1;
      const t = ((x - a.x) * vx + (z - a.z) * vz) / len2;
      if (t < 1 && Math.hypot(x - b.x, z - b.z) > NODE_REACHED_M) {
        const tc = clamp(t, 0, 1);
        this.projX = a.x + vx * tc;
        this.projZ = a.z + vz * tc;
        return;
      }
      this.prev = this.route.shift()!;
      this.visits.set(this.prev, (this.visits.get(this.prev) ?? 0) + 1);
      this.extendRoute();
    }
  }

  private extendRoute(): void {
    let length = 0;
    let from = this.prev;
    for (const i of this.route) {
      length += Math.hypot(this.nodes[i].x - this.nodes[from].x, this.nodes[i].z - this.nodes[from].z);
      from = i;
    }
    while (length < PLAN_AHEAD_M) {
      const at = this.route.length > 0 ? this.route[this.route.length - 1] : this.prev;
      const before = this.route.length > 1 ? this.route[this.route.length - 2] : this.prev;
      const next = this.chooseNext(before === at ? -1 : before, at);
      if (next < 0) {
        return;
      }
      length += Math.hypot(this.nodes[next].x - this.nodes[at].x, this.nodes[next].z - this.nodes[at].z);
      this.route.push(next);
    }
  }

  private chooseNext(from: number, at: number): number {
    const node = this.nodes[at];
    const options = node.links.filter((l) => l !== from);
    if (options.length === 0) {
      return from >= 0 ? from : -1; // carreró sense sortida: mitja volta
    }
    if (options.length === 1) {
      return options[0];
    }
    // Preferim seguir recte i els carrers poc visitats, amb una mica d'atzar. Els girs molt
    // tancats (gairebé enrere) penalitzen molt: amb el radi de gir real obliguen a maniobrar.
    const inX = from >= 0 ? node.x - this.nodes[from].x : 0;
    const inZ = from >= 0 ? node.z - this.nodes[from].z : 0;
    const inLen = Math.hypot(inX, inZ) || 1;
    const weights = options.map((o) => {
      const ox = this.nodes[o].x - node.x;
      const oz = this.nodes[o].z - node.z;
      const cos = (inX * ox + inZ * oz) / (inLen * (Math.hypot(ox, oz) || 1));
      return (1.3 + cos) ** 2 / (1 + (this.visits.get(o) ?? 0));
    });
    let r = Math.random() * weights.reduce((s, w) => s + w, 0);
    for (let i = 0; i < options.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        return options[i];
      }
    }
    return options[options.length - 1];
  }

  private pointAlong(path: [number, number][], dist: number): [number, number] {
    let left = dist;
    for (let i = 1; i < path.length; i++) {
      const [ax, az] = path[i - 1];
      const [bx, bz] = path[i];
      const seg = Math.hypot(bx - ax, bz - az);
      if (seg >= left && seg > 0) {
        const t = left / seg;
        return [ax + (bx - ax) * t, az + (bz - az) * t];
      }
      left -= seg;
    }
    return path[path.length - 1] ?? [this.projX, this.projZ];
  }

  /** Suma dels canvis de direcció del camí en els propers `dist` metres. */
  private bendAhead(path: [number, number][], dist: number): number {
    let total = 0;
    let travelled = 0;
    let prevAngle: number | null = null;
    for (let i = 1; i < path.length && travelled < dist; i++) {
      const dx = path[i][0] - path[i - 1][0];
      const dz = path[i][1] - path[i - 1][1];
      const seg = Math.hypot(dx, dz);
      if (seg < 0.01) {
        continue;
      }
      const angle = Math.atan2(dx, dz);
      if (prevAngle !== null) {
        total += Math.abs(wrapAngle(angle - prevAngle));
      }
      prevAngle = angle;
      travelled += seg;
    }
    return total;
  }

  private distanceToSegment(x: number, z: number): number {
    return this.route.length > 0 ? this.pointSegmentDistance(x, z, this.prev, this.route[0]) : Infinity;
  }

  private pointSegmentDistance(x: number, z: number, a: number, b: number): number {
    const A = this.nodes[a];
    const B = this.nodes[b];
    const vx = B.x - A.x;
    const vz = B.z - A.z;
    const len2 = vx * vx + vz * vz;
    const t = len2 > 0 ? clamp(((x - A.x) * vx + (z - A.z) * vz) / len2, 0, 1) : 0;
    return Math.hypot(x - (A.x + vx * t), z - (A.z + vz * t));
  }
}
