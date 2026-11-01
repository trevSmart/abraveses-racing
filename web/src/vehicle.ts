// Dinàmica d'un Renault 12 (1.3 L, ~54 CV, ~900 kg) a escala real: el món va en metres i segons.

export const R12 = {
  lengthM: 4.35,
  widthM: 1.64,
  wheelbaseM: 2.44,
  /** ~130 km/h. */
  maxSpeed: 36,
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
  maxLateralAccel: 7.5,
  /** Adherència a baixa velocitat: deixa prendre els girs de ciutat més tancats. */
  lowSpeedLateralAccel: 9.5,
  /** Entre aquestes velocitats (m/s, ~15 i ~45 km/h) es passa del gir de maniobra al de marxa. */
  lowSpeedBlend: [4, 12] as const,
  /** Fracció del recorregut del volant per segon: de topall a topall en ~0,67 s. */
  steerRate: 3,
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

// --- Caixa de canvis de 4 marxes, com la del R12 ---

/** Relacions del R12: només fixen a quina velocitat arriba cada marxa al límit de voltes. */
const GEAR_RATIOS = [3.61, 2.26, 1.48, 1.03];
/**
 * Empenta màxima de cada marxa (m/s²). Ajustada al joc: 0–100 km/h ≈ 7,7 s, punta ~130 km/h. Cada
 * marxa ha d'empènyer menys que l'anterior al punt de canvi: si no, estirar-la no serviria de res.
 */
const GEAR_ACCEL = [6.4, 5.0, 4.1, 3.2];
/** Pèrdua d'empenta amb el gas (m/s² per (m/s)²): fa que l'últim tram cap a la punta costi. */
const DRIVE_LOSS = 0.0009;
/** Velocitat (m/s) de la marxa més llarga al límit de voltes. */
const TOP_GEAR_SPEED = 37;
export const GEAR_COUNT = GEAR_RATIOS.length;
export const IDLE_RPM = 850;
export const REDLINE_RPM = 6000;
/** Voltes a partir de les quals el comptavoltes avisa que toca canviar (manual). */
export const SHIFT_LIGHT_RPM = 5600;
/** Segons sense empenta mentre entra la marxa: es nota al capcineig del cotxe. */
const SHIFT_TIME = 0.18;
/** Pausa mínima entre dos canvis automàtics, perquè la caixa no dubti entre dues marxes. */
const AUTO_SHIFT_PAUSE = 0.4;
/** Per sota d'aquesta velocitat (m/s) torna a primera: el motor es caria en una marxa llarga. */
const FIRST_GEAR_SPEED = 1.2;
/** Voltes que agafa l'embragatge en sortir aturat, a gas a fons. */
const CLUTCH_SLIP_RPM = 2400;
/** Retenció del motor (m/s² per unitat de relació) amb les voltes al límit. */
const ENGINE_BRAKE = 0.15;

export type Gearbox = {
  /** Marxa endavant engranada: de 1 a `GEAR_COUNT`. La marxa enrere surt del signe de la velocitat. */
  gear: number;
  manual: boolean;
  /** Segons que falten perquè entri la marxa. */
  shift: number;
  /** Segons que falten perquè el canvi automàtic pugui tornar a canviar. */
  pause: number;
  rpm: number;
};

export function newGearbox(): Gearbox {
  return { gear: 1, manual: false, shift: 0, pause: 0, rpm: IDLE_RPM };
}

export function resetGearbox(box: Gearbox): void {
  box.gear = 1;
  box.shift = 0;
  box.pause = 0;
  box.rpm = IDLE_RPM;
}

/** Voltes del motor a velocitat `v` amb la marxa `gear` engranada. */
function rpmAt(v: number, gear: number): number {
  const top = (TOP_GEAR_SPEED * GEAR_RATIOS[GEAR_COUNT - 1]) / GEAR_RATIOS[gear - 1];
  return (Math.abs(v) / top) * REDLINE_RPM;
}

/** Corba de parell: el màxim a mig règim, i res a partir del límit de voltes. `r` = voltes / límit. */
function torque(r: number): number {
  const d = (r - 0.5) / 0.5;
  const curve = 1 - d * d * (d > 0 ? 0.15 : 0.4);
  const cut = Math.min(1, Math.max(0, (r - 0.95) / 0.05));
  return curve * (1 - cut * cut * (3 - 2 * cut));
}

/** Empenta a gas a fons (m/s²). En primera, l'embragatge deixa sortir amb el motor ja revolucionat. */
function driveAccel(v: number, gear: number): number {
  const r = Math.max(rpmAt(v, gear) / REDLINE_RPM, gear === 1 ? 0.3 : 0.15);
  return GEAR_ACCEL[gear - 1] * torque(r) - DRIVE_LOSS * v * v;
}

/** Com més gas, més tard puja de marxa. Sense gas no puja (fora que el motor es passi de voltes). */
function upshiftRpm(throttle: number): number {
  return 3200 + 2400 * throttle;
}

/** Trepitjar a fons abaixa marxes abans. Sempre queda prou lluny de `upshiftRpm` per no dubtar. */
function downshiftRpm(throttle: number): number {
  return 1700 + 1300 * throttle;
}

/**
 * Quant empeny el motor ara mateix, de 0 a 1. Zero si frena (accelerar en sentit contrari a la marxa
 * també és frenar) o mentre entra la marxa.
 */
export function engineLoad(v: number, throttle: number, brake: boolean, box: Gearbox): number {
  if (brake || box.shift > 0) {
    return 0;
  }
  if (v > 0.1) {
    return Math.max(0, throttle);
  }
  return v < -0.1 ? Math.max(0, -throttle) : Math.abs(throttle);
}

/** Fa avançar la caixa un fotograma: temporitzadors, canvi automàtic i voltes del motor. */
export function stepGearbox(box: Gearbox, v: number, throttle: number, dt: number): void {
  box.shift = Math.max(0, box.shift - dt);
  box.pause = Math.max(0, box.pause - dt);
  const forward = v > -0.3;
  if (Math.abs(v) < FIRST_GEAR_SPEED || !forward) {
    box.gear = 1;
  } else if (!box.manual && box.pause === 0) {
    const gas = Math.max(0, throttle);
    const rpm = rpmAt(v, box.gear);
    if (box.gear < GEAR_COUNT && (rpm >= REDLINE_RPM || (gas > 0 && rpm >= upshiftRpm(gas)))) {
      shiftTo(box, box.gear + 1);
    } else if (box.gear > 1 && rpm < downshiftRpm(gas)) {
      shiftTo(box, box.gear - 1);
    }
  }
  const driving = engineLoad(v, throttle, false, box);
  const wheelRpm = forward ? rpmAt(v, box.gear) : (Math.abs(v) / R12.maxReverse) * REDLINE_RPM;
  const slipRpm = box.gear === 1 ? IDLE_RPM + CLUTCH_SLIP_RPM * driving : IDLE_RPM;
  const target = Math.max(wheelRpm, slipRpm);
  // El motor no segueix les rodes a l'instant: així es veu baixar l'agulla a cada canvi.
  box.rpm += (target - box.rpm) * (1 - Math.exp(-12 * dt));
}

function shiftTo(box: Gearbox, gear: number): void {
  box.gear = gear;
  box.shift = SHIFT_TIME;
  box.pause = AUTO_SHIFT_PAUSE;
}

/** Canvi manual: `delta` +1 puja, −1 baixa. Reduir no entra si el motor es passaria de voltes. */
export function shiftGear(box: Gearbox, delta: number, v: number): boolean {
  const gear = box.gear + delta;
  if (gear < 1 || gear > GEAR_COUNT || v < -0.3 || (delta < 0 && rpmAt(v, gear) > REDLINE_RPM)) {
    return false;
  }
  shiftTo(box, gear);
  return true;
}

/**
 * Nova velocitat longitudinal. `throttle` > 0 accelera (o frena si va enrere);
 * `throttle` < 0 frena i, un cop aturat, fa marxa enrere. La marxa endavant la posa `box`.
 */
export function stepSpeed(v: number, throttle: number, brake: boolean, dt: number, box: Gearbox): number {
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
    a = (box.shift > 0 ? 0 : driveAccel(v, box.gear) * throttle) - R12.dragK * v * v;
  } else if (throttle < 0) {
    a = R12.reverseAccel * throttle * (1 - (v / R12.maxReverse) ** 2);
  } else {
    braking = true;
    // Endavant i amb la marxa engranada, el motor reté més com més curta és la marxa.
    const retention =
      v > 0 && box.shift === 0 ? ENGINE_BRAKE * GEAR_RATIOS[box.gear - 1] * Math.min(1, rpmAt(v, box.gear) / REDLINE_RPM) : 0;
    a = -Math.sign(v) * (R12.coastDecel + retention + R12.dragK * v * v);
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
