// Dinàmica d'un Renault 12 (1.3 L, ~54 CV, ~900 kg) a escala real: el món va en metres i segons.

export const R12 = {
  lengthM: 4.35,
  widthM: 1.64,
  wheelbaseM: 2.44,
  /** ~155 km/h (un R12 una mica alegre, tipus TS). */
  maxSpeed: 43,
  /** m/s² a baixa velocitat; amb la caiguda quadràtica, 0–100 km/h ≈ 13 s. */
  engineAccel: 2.6,
  reverseAccel: 1.5,
  /** ~16 km/h. */
  maxReverse: 4.5,
  /** ~0,7 g. */
  brakeDecel: 7,
  /** Fre motor + rodolament a velocitat baixa (m/s²). */
  coastDecel: 0.35,
  /** Arrossegament aerodinàmic: decel = k·v². */
  dragK: 0.0005,
  /** Radi de gir mínim a l'eix (~10,4 m de paret a paret). */
  minTurnRadius: 5.2,
  /** Límit d'adherència en corba (m/s²): per sobre, el cotxe subvira. */
  maxLateralAccel: 6.5,
  /** Fracció del recorregut del volant per segon: de topall a topall en ~0,8 s. */
  steerRate: 2.5,
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

/** Volant amb inèrcia: s'acosta a l'entrada a `steerRate` per segon. */
export function stepSteer(current: number, target: number, dt: number): number {
  const maxStep = R12.steerRate * dt;
  return current + Math.min(maxStep, Math.max(-maxStep, target - current));
}

/**
 * Velocitat de gir (rad/s) segons el model de bicicleta, limitada per l'adherència.
 * Positiu = gira a la dreta (el heading del joc baixa).
 */
export function yawRate(v: number, steer: number): number {
  const rate = (v * steer) / R12.minTurnRadius;
  const gripLimit = R12.maxLateralAccel / Math.max(Math.abs(v), 0.1);
  return Math.min(gripLimit, Math.max(-gripLimit, rate));
}
