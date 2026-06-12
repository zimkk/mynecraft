/**
 * Keyboard + mouse input with Pointer Lock. Mouse movement accumulates into a
 * delta that the consumer reads-and-clears each tick; "just pressed" sets are
 * cleared at the end of each render frame via endFrame().
 */
export class Input {
  private keys = new Set<string>();
  private keysJustPressed = new Set<string>();
  private buttons = new Set<number>();
  private buttonsJustPressed = new Set<number>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  readonly element: HTMLElement;
  /** When false, clicks don't request pointer lock (e.g. menu open). */
  lockEnabled = true;

  constructor(element: HTMLElement) {
    this.element = element;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.keysJustPressed.add(e.code);
      // Keep browser shortcuts from stealing game keys while locked.
      if (this.isLocked && ['Space', 'Tab', 'F3'].includes(e.code)) e.preventDefault();
      if (e.code === 'F3') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    element.addEventListener('mousedown', (e) => {
      if (!this.isLocked && this.lockEnabled) {
        element.requestPointerLock();
        return; // don't register the focusing click as a game action
      }
      this.buttons.add(e.button);
      this.buttonsJustPressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    });
  }

  get isLocked(): boolean {
    return document.pointerLockElement === this.element;
  }

  unlock(): void {
    if (this.isLocked) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  justPressed(code: string): boolean {
    return this.keysJustPressed.has(code);
  }

  buttonJustPressed(button: number): boolean {
    return this.buttonsJustPressed.has(button);
  }

  buttonDown(button: number): boolean {
    return this.buttons.has(button);
  }

  /** Read and reset accumulated mouse movement. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  /** Read and reset accumulated wheel steps (+1 per notch down). */
  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /**
   * Call at the end of every FIXED update tick (not per rendered frame):
   * the fixed-timestep loop can run twice in one frame, and clearing only
   * per-frame made a single press fire in both ticks (e.g. one Space press
   * reading as a double-tap).
   */
  endFrame(): void {
    this.keysJustPressed.clear();
    this.buttonsJustPressed.clear();
  }

  /** Drop all buffered one-shot input (called when pausing/resuming so
   * presses made while a menu was open don't fire on the first live tick). */
  clearTransient(): void {
    this.keysJustPressed.clear();
    this.buttonsJustPressed.clear();
    this.buttons.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  /**
   * Safely request pointer lock. Browsers throw/reject during the ~1 s
   * cooldown after Esc releases the lock — report that via onFail instead
   * of an unhandled rejection, so the caller can fall back to the menu.
   */
  requestLock(onFail?: () => void): void {
    try {
      const result = this.element.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => onFail?.());
    } catch {
      onFail?.();
    }
  }
}
