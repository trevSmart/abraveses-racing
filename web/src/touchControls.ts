// Controls tàctils per jugar al mòbil: palanca de gir a l'esquerra, pedals i salt a la dreta i una
// fila de botons petits a dalt. Fan servir Pointer Events, de manera que cada dit va pel seu compte
// (es pot girar i accelerar alhora). L'HTML i el CSS són a `index.html`.

export type TouchActions = {
  hop(): void;
  camera(): void;
  respawn(): void;
  options(): void;
  autopilot(): void;
  /** S'ha tocat un control de conducció (surt de l'autopilot, com les tecles). */
  drive(): void;
};

// Fracció de la palanca que no gira: el polze mai no queda just al centre.
const STEER_DEADZONE = 0.1;

export class TouchControls {
  /** Gir analògic: −1 (esquerra) a 1 (dreta), com les tecles A i D. */
  steer = 0;
  /** Hi ha una pantalla tàctil en ús: es veuen els controls i l'HUD es reubica. */
  enabled = false;

  private gas = false;
  private brake = false;
  private ready = false;
  private steerPointer: number | null = null;
  private readonly root = document.getElementById("touch");
  private readonly steerTrack = document.getElementById("touch-steer");
  private readonly steerKnob = document.getElementById("touch-steer-knob");
  private readonly pressed = new Map<HTMLElement, number>();

  constructor(private readonly actions: TouchActions) {
    // Un portàtil amb pantalla tàctil té ratolí: els controls no surten fins que es toca la pantalla.
    if (window.matchMedia("(pointer: coarse)").matches) {
      this.enable();
    } else {
      window.addEventListener(
        "pointerdown",
        (e) => {
          if (e.pointerType === "touch") {
            this.enable();
          }
        },
        { capture: true },
      );
    }
    this.bindSteer();
    this.bindHold("touch-gas", (on) => {
      this.gas = on;
    });
    this.bindHold("touch-brake", (on) => {
      this.brake = on;
    });
    document.getElementById("touch-hop")?.addEventListener("pointerdown", () => actions.hop());
    this.bindTap("touch-options", actions.options);
    this.bindTap("touch-camera", actions.camera);
    this.bindTap("touch-respawn", actions.respawn);
    this.bindTap("touch-autopilot", actions.autopilot);
    // La pulsació llarga obriria el menú contextual a Android, i iOS fa zoom amb el pessic.
    this.root?.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    // Si l'app passa a segon pla, el `pointerup` no arriba i el cotxe seguiria accelerant.
    window.addEventListener("blur", () => this.reset());
    document.addEventListener("visibilitychange", () => this.reset());
  }

  /** Com les tecles W i S. Si es trepitgen tots dos pedals, mana el fre. */
  get throttle(): number {
    if (this.brake) {
      return -1;
    }
    return this.gas ? 1 : 0;
  }

  /** El joc ja s'ha carregat: es poden ensenyar els controls. */
  show(): void {
    this.ready = true;
    this.syncVisible();
  }

  /** Deixa anar tots els controls. Cal tornar a tocar-los per reprendre'n l'ús. */
  reset(): void {
    this.gas = false;
    this.brake = false;
    this.setSteer(0);
    this.steerPointer = null;
    for (const el of this.pressed.keys()) {
      el.classList.remove("on");
    }
    this.pressed.clear();
  }

  setAutopilot(on: boolean): void {
    document.getElementById("touch-autopilot")?.classList.toggle("on", on);
  }

  private enable(): void {
    if (this.enabled) {
      return;
    }
    this.enabled = true;
    document.documentElement.classList.add("touch");
    this.syncVisible();
    // L'HUD canvia de lloc i la mida de la pantalla es pot haver mogut amb la barra del navegador.
    window.dispatchEvent(new Event("resize"));
  }

  private syncVisible(): void {
    if (this.root) {
      this.root.hidden = !(this.enabled && this.ready);
    }
  }

  private setSteer(value: number): void {
    this.steer = value;
    if (this.steerKnob && value === 0) {
      this.steerKnob.style.transform = "";
    }
  }

  /** Mou la palanca sota el dit: tocar un extrem ja gira del tot, sense haver d'arrossegar. */
  private moveSteer(clientX: number): void {
    if (!this.steerTrack || !this.steerKnob) {
      return;
    }
    const rect = this.steerTrack.getBoundingClientRect();
    const travel = (rect.width - this.steerKnob.offsetWidth) / 2;
    const offset = Math.max(-travel, Math.min(travel, clientX - (rect.left + rect.width / 2)));
    this.steerKnob.style.transform = `translateX(${offset}px)`;
    const x = offset / travel;
    const amount = Math.max(0, (Math.abs(x) - STEER_DEADZONE) / (1 - STEER_DEADZONE));
    this.steer = Math.sign(x) * amount;
  }

  private bindSteer(): void {
    const track = this.steerTrack;
    if (!track) {
      return;
    }
    track.addEventListener("pointerdown", (e) => {
      if (this.steerPointer !== null) {
        return;
      }
      this.steerPointer = e.pointerId;
      // Amb la captura, el dit pot sortir de la palanca sense deixar de girar.
      track.setPointerCapture(e.pointerId);
      this.actions.drive();
      this.moveSteer(e.clientX);
    });
    track.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.steerPointer) {
        this.moveSteer(e.clientX);
      }
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId === this.steerPointer) {
        this.steerPointer = null;
        this.setSteer(0);
      }
    };
    track.addEventListener("pointerup", release);
    track.addEventListener("pointercancel", release);
  }

  /** Botó que actua mentre es manté premut. */
  private bindHold(id: string, onChange: (on: boolean) => void): void {
    const el = document.getElementById(id);
    if (!el) {
      return;
    }
    el.addEventListener("pointerdown", (e) => {
      this.pressed.set(el, e.pointerId);
      el.classList.add("on");
      this.actions.drive();
      onChange(true);
    });
    const release = (e: PointerEvent): void => {
      if (this.pressed.get(el) === e.pointerId) {
        this.pressed.delete(el);
        el.classList.remove("on");
        onChange(false);
      }
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
  }

  private bindTap(id: string, action: () => void): void {
    document.getElementById(id)?.addEventListener("click", () => action());
  }
}
