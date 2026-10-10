// Dinàmica d'un Renault 12 (1.3 L, ~54 CV, ~900 kg) a escala real: el món va en metres i segons.

export const R12 = {
  lengthM: 4.35,
  widthM: 1.64,
  wheelbaseM: 2.44,
  /** ~130 km/h. */
  maxSpeed: 36,
  /** m/s² a baixa velocitat; amb la caiguda quadràtica cap a la punta, 0–100 km/h ≈ 7,4 s. */
  engineAccel: 5,
  reverseAccel: 5,
  /** ~43 km/h: prou ràpida per maniobrar pels carrers, sense arribar a la de marxa endavant. */
  maxReverse: 12,
  /** ~2 g: de 50 km/h a 0 en uns 0,7 s (~5 m). */
  brakeDecel: 20,
  /** Fre motor + rodolament a velocitat baixa (m/s²). */
  coastDecel: 0.35,
  /** Arrossegament aerodinàmic: decel = k·v². */
  dragK: 0.0005,
  /** Radi de gir mínim a l'eix en marxa (~8 m de paret a paret). */
  minTurnRadius: 3.8,
  /** Radi de gir maniobrant a poc a poc: més tancat per sortir-se'n a les cruïlles estretes. */
  lowSpeedTurnRadius: 2.5,
  /** Límit d'adherència en corba (m/s²): per sobre, el cotxe subvira. */
  maxLateralAccel: 6.5,
  /** Adherència a baixa velocitat: deixa prendre els girs de ciutat més tancats. */
  lowSpeedLateralAccel: 8.5,
  /** Entre aquestes velocitats (m/s, ~15 i ~45 km/h) es passa del gir de maniobra al de marxa. */
  lowSpeedBlend: [4, 12] as const,
  /** Fracció del recorregut del volant per segon: de topall a topall en ~0,8 s. */
  steerRate: 2.5,
  /** Volant a baixa velocitat: de topall a topall en ~0,4 s. */
  lowSpeedSteerRate: 5,
  /** Velocitat (m/s, ~40 km/h) a partir de la qual una frenada amb el volant girat fa derrapar. */
  driftMinSpeed: 11,
  /** Gir extra de la carrosseria (rad/s) amb el volant a topall mentre derrapa. */
  driftYawRate: 1.65,
  /** Angle màxim entre el morro i la direcció de la marxa (~34°). */
  maxDriftAngle: 0.59,
  /** Mentre derrapa, les rodes encara agafen: ritme (1/s) amb què es tanca l'angle. */
  driftGrip: 2.1,
  /** Ritme (1/s) amb què, en deixar el fre, la marxa s'alinea amb el morro. */
  driftRecovery: 4,
  /** Frenant de costat les rodes llisquen: fan aquesta fracció de la frenada normal. */
  driftBrakeFactor: 0.55,
  /** Fracció de la velocitat vertical que retorna en tocar terra després d'un salt. */
  landingRestitution: 0.32,
  /** Per sota d'aquesta velocitat d'impacte (m/s) el cotxe ja no rebota. */
  minBounceSpeed: 3.5,
} as const;

export type VehicleInput = { throttle: number; steer: number; brake: boolean };

/**
 * Nova velocitat longitudinal. `throttle` > 0 accelera (o frena si va enrere);
 * `throttle` < 0 frena i, un cop aturat, fa marxa enrere.
 */
export function stepSpeed(v: number, throttle: number, brake: boolean, dt: number): number {
  let a = 0;
  let braking = false;
  if (brake) {
    braking = true;
    a = -Math.sign(v) * R12.brakeDecel;
  } else if (throttle > 0 && v < -0.1) {
    braking = true;
    a = R12.brakeDecel * throttle;
  } else if (throttle < 0 && v > 0.1) {
    braking = true;
    a = R12.brakeDecel * throttle;
  } else if (throttle > 0) {
    a = R12.engineAccel * throttle * (1 - (v / R12.maxSpeed) ** 2);
  } else if (throttle < 0) {
    a = R12.reverseAccel * throttle * (1 - (v / R12.maxReverse) ** 2);
  } else {
    braking = true;
    a = -Math.sign(v) * (R12.coastDecel + R12.dragK * v * v);
  }
  const next = v + a * dt;
  // Frenar o deixar anar mai inverteix el sentit de la marxa.
  if (braking && Math.sign(next) !== Math.sign(v)) {
    return 0;
  }
  return Math.min(R12.maxSpeed, Math.max(-R12.maxReverse, next));
}

/** 0 maniobrant a poc a poc, 1 en marxa; transició suau entre els dos extrems de `lowSpeedBlend`. */
function cruiseFactor(v: number): number {
  const [lo, hi] = R12.lowSpeedBlend;
  const t = Math.min(1, Math.max(0, (Math.abs(v) - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Radi de gir a l'eix amb el volant a topall, segons la velocitat. */
export function turnRadius(v: number): number {
  return mix(R12.lowSpeedTurnRadius, R12.minTurnRadius, cruiseFactor(v));
}

/** Volant amb inèrcia: s'acosta a l'entrada més de pressa com més a poc a poc es va. */
export function stepSteer(current: number, target: number, v: number, dt: number): number {
  const maxStep = mix(R12.lowSpeedSteerRate, R12.steerRate, cruiseFactor(v)) * dt;
  return current + Math.min(maxStep, Math.max(-maxStep, target - current));
}

/**
 * Velocitat de gir (rad/s) segons el model de bicicleta, limitada per l'adherència.
 * Positiu = gira a la dreta (el heading del joc baixa).
 */
export function yawRate(v: number, steer: number): number {
  const t = cruiseFactor(v);
  const rate = (v * steer) / turnRadius(v);
  const gripLimit = mix(R12.lowSpeedLateralAccel, R12.maxLateralAccel, t) / Math.max(Math.abs(v), 0.1);
  return Math.min(gripLimit, Math.max(-gripLimit, rate));
}
