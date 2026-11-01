// Velocímetre d'agulla del HUD, dibuixat en un canvas: esfera de km/h, anell de voltes del motor i,
// al centre, la marxa. L'esfera només es pinta un cop; a cada canvi es torna a posar a sobre el que es mou.

import { IDLE_RPM, REDLINE_RPM, SHIFT_LIGHT_RPM } from "./vehicle";

/** Mida de disseny: tot es dibuixa en aquestes unitats i s'escala a la mida real del canvas. */
const SIZE = 148;
const CENTER = SIZE / 2;
/** L'escala comença a baix a l'esquerra (135°) i fa 270° en sentit horari. */
const START_ANGLE = (135 * Math.PI) / 180;
const SWEEP = (270 * Math.PI) / 180;
const MAX_KMH = 160;
const MAX_RPM = 7000;
const RING_R = 66;
const HUB_R = 17;

const ACCENT = "#f5c518";
const RED = "#ff4b34";
const FONT = "system-ui, sans-serif";

export type SpeedometerReading = {
  /** Velocitat en m/s: negativa, marxa enrere. */
  speed: number;
  rpm: number;
  gear: number;
  manual: boolean;
  shifting: boolean;
};

function kmhAngle(kmh: number): number {
  return START_ANGLE + (Math.min(kmh, MAX_KMH) / MAX_KMH) * SWEEP;
}

function rpmAngle(rpm: number): number {
  return START_ANGLE + (Math.min(rpm, MAX_RPM) / MAX_RPM) * SWEEP;
}

export class Speedometer {
  private readonly ctx: CanvasRenderingContext2D | null;
  private face: HTMLCanvasElement | null = null;
  private scale = 1;
  private lastKey = "";
  private lastLabel = "";

  constructor(private readonly canvas: HTMLCanvasElement | null) {
    this.ctx = canvas?.getContext("2d") ?? null;
    if (canvas) {
      // La mida canvia amb els controls tàctils i en girar el mòbil.
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
    }
  }

  update(reading: SpeedometerReading): void {
    const { ctx, canvas, face } = this;
    if (!ctx || !canvas || !face) {
      return;
    }
    const { speed, rpm, gear, manual, shifting } = reading;
    const reverse = speed < -0.3;
    const kmh = Math.abs(speed) * 3.6;
    const label = reverse ? "R" : `${manual ? "M" : "D"}${gear}`;
    const shiftLight = manual && !reverse && rpm >= SHIFT_LIGHT_RPM;
    // Mig km/h i 40 voltes ja no es veuen: si res no es mou, no cal repintar.
    const key = `${Math.round(kmh * 2)}|${Math.round(rpm / 40)}|${label}|${shifting}|${shiftLight}`;
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(face, 0, 0);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);

    this.drawRpm(ctx, rpm);
    this.drawReadout(ctx, kmh);
    this.drawNeedle(ctx, kmh);
    this.drawHub(ctx, label, reverse, shifting, shiftLight);

    // Com abans amb el text: el DOM només s'escriu quan canvia el que es diu.
    const spoken = `${Math.round(kmh)} km/h, ${label}`;
    if (spoken !== this.lastLabel) {
      this.lastLabel = spoken;
      canvas.setAttribute("aria-label", spoken);
    }
  }

  private resize(): void {
    const { canvas } = this;
    if (!canvas || !canvas.clientWidth) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pixels = Math.round(canvas.clientWidth * dpr);
    canvas.width = pixels;
    canvas.height = pixels;
    this.scale = pixels / SIZE;
    this.face = this.paintFace(pixels, canvas.clientWidth);
    this.lastKey = "";
  }

  /** La part que no es mou. Al mòbil l'esfera és més petita: només hi caben la meitat dels números. */
  private paintFace(pixels: number, cssSize: number): HTMLCanvasElement {
    const face = document.createElement("canvas");
    face.width = pixels;
    face.height = pixels;
    const ctx = face.getContext("2d");
    if (!ctx) {
      return face;
    }
    ctx.scale(this.scale, this.scale);

    const disc = ctx.createRadialGradient(CENTER, CENTER, 10, CENTER, CENTER, CENTER);
    disc.addColorStop(0, "rgba(26,28,34,.92)");
    disc.addColorStop(1, "rgba(6,7,10,.78)");
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, CENTER - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.28)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Anell de voltes: el fons i la zona vermella.
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(255,255,255,.14)";
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, RING_R, START_ANGLE, START_ANGLE + SWEEP);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,75,52,.55)";
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, RING_R, rpmAngle(REDLINE_RPM), START_ANGLE + SWEEP);
    ctx.stroke();

    // Escala de km/h.
    const labelStep = cssSize < 130 ? 40 : 20;
    ctx.lineCap = "butt";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 10px ${FONT}`;
    for (let kmh = 0; kmh <= MAX_KMH; kmh += 10) {
      const a = kmhAngle(kmh);
      const major = kmh % 20 === 0;
      const inner = major ? 53 : 56;
      ctx.strokeStyle = major ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.5)";
      ctx.lineWidth = major ? 1.8 : 1;
      ctx.beginPath();
      ctx.moveTo(CENTER + Math.cos(a) * inner, CENTER + Math.sin(a) * inner);
      ctx.lineTo(CENTER + Math.cos(a) * 60, CENTER + Math.sin(a) * 60);
      ctx.stroke();
      if (kmh % labelStep === 0) {
        ctx.fillStyle = "rgba(255,255,255,.92)";
        ctx.fillText(String(kmh), CENTER + Math.cos(a) * 43, CENTER + Math.sin(a) * 43);
      }
    }

    ctx.fillStyle = "rgba(255,255,255,.62)";
    ctx.font = `600 9px ${FONT}`;
    ctx.fillText("km/h", CENTER, 131);
    return face;
  }

  private drawRpm(ctx: CanvasRenderingContext2D, rpm: number): void {
    ctx.lineWidth = 5;
    ctx.lineCap = "butt";
    ctx.strokeStyle = rpm >= SHIFT_LIGHT_RPM ? RED : ACCENT;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, RING_R, START_ANGLE, rpmAngle(Math.max(rpm, IDLE_RPM)));
    ctx.stroke();
  }

  private drawReadout(ctx: CanvasRenderingContext2D, kmh: number): void {
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 21px ${FONT}`;
    ctx.fillText(String(Math.round(kmh)), CENTER, 115);
  }

  private drawNeedle(ctx: CanvasRenderingContext2D, kmh: number): void {
    const a = kmhAngle(kmh);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.moveTo(CENTER + dx * 57, CENTER + dy * 57);
    ctx.lineTo(CENTER - dy * 2.6, CENTER + dx * 2.6);
    ctx.lineTo(CENTER + dy * 2.6, CENTER - dx * 2.6);
    ctx.closePath();
    ctx.fill();
  }

  private drawHub(
    ctx: CanvasRenderingContext2D,
    label: string,
    reverse: boolean,
    shifting: boolean,
    shiftLight: boolean,
  ): void {
    ctx.fillStyle = shiftLight ? RED : "#14161b";
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, HUB_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = shifting ? 2.4 : 1.4;
    ctx.strokeStyle = shifting ? ACCENT : "rgba(255,255,255,.4)";
    ctx.stroke();
    ctx.fillStyle = shiftLight ? "#fff" : reverse ? RED : ACCENT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${label.length > 1 ? 15 : 19}px ${FONT}`;
    ctx.fillText(label, CENTER, CENTER + 1);
  }
}
