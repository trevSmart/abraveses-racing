// Controls tàctils per jugar al mòbil: lliscant horitzontal de gir a l'esquerra, lliscant vertical
// d'accelerador i salt a la dreta i una fila de botons petits a dalt. Fan servir Pointer Events, de manera que cada dit va pel seu compte
// (es pot girar i accelerar alhora). L'HTML i el CSS són a `index.html`.

export type TouchActions = {
  hop(): void;
  camera(): void;
  respawn(): void;
  options(): void;
  autopilot(): void;
  /** S'ha tocat un control de conducció (surt de l'autopilot, com les tecles). */
  drive(): void;
  /** Canvi manual: +1 puja de marxa, −1 baixa. */
  shift(delta: number): void;
};

// Fracció de cada lliscant que no fa res: el polze mai no queda just al centre.
const STEER_DEADZONE = 0.1;
const THROTTLE_DEADZONE = 0.15;

type Axis = "x" | "y";

/** Lliscant que torna al centre en deixar-lo anar. El valor va de −1 a 1 (amunt i dreta, positiu). */
type Slider = {
  track: HTMLElement;
  knob: HTMLElement;
  axis: Axis;
  deadzone: number;
  pointer: number | null;
  onChange(value: number): void;
};

export class TouchControls {
  /** Gir analògic: −1 (esquerra) a 1 (dreta), com les tecles A i D. */
  steer = 0;
  /** Accelerador analògic: 1 (amunt, accelerar) a −1 (avall, frenar i marxa enrere), com W i S. */
  throttle = 0;
  /** Hi ha una pantalla tàctil en ús: es veuen els controls i l'HUD es reubica. */
  enabled = false;

  private ready = false;
  private readonly root = document.getElementById("touch");
  private readonly sliders: Slider[] = [];

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
    this.bindSlider("touch-steer", "x", STEER_DEADZONE, (v) => {
      this.steer = v;
    });
    this.bindSlider("touch-throttle", "y", THROTTLE_DEADZONE, (v) => {
      this.throttle = v;
    });
    document.getElementById("touch-hop")?.addEventListener("pointerdown", () => actions.hop());
    document.getElementById("touch-shift-up")?.addEventListener("pointerdown", () => actions.shift(1));
    document.getElementById("touch-shift-down")?.addEventListener("pointerdown", () => actions.shift(-1));
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

  /** El joc ja s'ha carregat: es poden ensenyar els controls. */
  show(): void {
    this.ready = true;
    this.syncVisible();
  }

  /** Deixa anar tots els controls. Cal tornar a tocar-los per reprendre'n l'ús. */
  reset(): void {
    for (const slider of this.sliders) {
      this.releaseSlider(slider);
    }
  }

  setAutopilot(on: boolean): void {
    document.getElementById("touch-autopilot")?.classList.toggle("on", on);
  }

  /** Els botons de marxes només surten amb el canvi manual. */
  setManualGears(on: boolean): void {
    document.getElementById("touch-shift-up")?.toggleAttribute("hidden", !on);
    document.getElementById("touch-shift-down")?.toggleAttribute("hidden", !on);
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

  /** Mou el lliscant sota el dit: tocar un extrem ja hi va del tot, sense haver d'arrossegar. */
  private moveSlider(slider: Slider, clientX: number, clientY: number): void {
    const { track, knob, axis } = slider;
    const rect = track.getBoundingClientRect();
    const travel =
      axis === "x" ? (rect.width - knob.offsetWidth) / 2 : (rect.height - knob.offsetHeight) / 2;
    const raw = axis === "x" ? clientX - (rect.left + rect.width / 2) : clientY - (rect.top + rect.height / 2);
    const offset = Math.max(-travel, Math.min(travel, raw));
    knob.style.transform = axis === "x" ? `translateX(${offset}px)` : `translateY(${offset}px)`;
    // A la pantalla, la y creix cap avall: amunt ha de ser positiu (accelerar).
    const v = (axis === "x" ? offset : -offset) / travel;
    const amount = Math.max(0, (Math.abs(v) - slider.deadzone) / (1 - slider.deadzone));
    this.setSlider(slider, Math.sign(v) * amount);
  }

  private setSlider(slider: Slider, value: number): void {
    slider.onChange(value);
    slider.track.setAttribute("aria-valuenow", value.toFixed(2));
    slider.track.classList.toggle("up", value > 0);
    slider.track.classList.toggle("down", value < 0);
  }

  private releaseSlider(slider: Slider): void {
    slider.pointer = null;
    slider.knob.style.transform = "";
    this.setSlider(slider, 0);
  }

  private bindSlider(id: string, axis: Axis, deadzone: number, onChange: (value: number) => void): void {
    const track = document.getElementById(id);
    const knob = track?.querySelector<HTMLElement>(".knob");
    if (!track || !knob) {
      return;
    }
    const slider: Slider = { track, knob, axis, deadzone, pointer: null, onChange };
    this.sliders.push(slider);
    track.addEventListener("pointerdown", (e) => {
      if (slider.pointer !== null) {
        return;
      }
      slider.pointer = e.pointerId;
      // Amb la captura, el dit pot sortir del lliscant sense deixar-lo anar.
      track.setPointerCapture(e.pointerId);
      this.actions.drive();
      this.moveSlider(slider, e.clientX, e.clientY);
    });
    track.addEventListener("pointermove", (e) => {
      if (e.pointerId === slider.pointer) {
        this.moveSlider(slider, e.clientX, e.clientY);
      }
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId === slider.pointer) {
        this.releaseSlider(slider);
      }
    };
    track.addEventListener("pointerup", release);
    track.addEventListener("pointercancel", release);
  }

  private bindTap(id: string, action: () => void): void {
    document.getElementById(id)?.addEventListener("click", () => action());
  }
}
