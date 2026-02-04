/**
 * Test setup for jsdom environment.
 * Polyfills APIs that jsdom doesn't implement.
 */

// CSS.escape is not implemented in jsdom
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as any).CSS = {};
}
if (typeof globalThis.CSS.escape !== 'function') {
  // Simple polyfill — escapes characters that have special meaning in CSS selectors
  globalThis.CSS.escape = function (value: string): string {
    const str = String(value);
    const result: string[] = [];
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      // Null character
      if (ch === 0x0000) {
        result.push('\uFFFD');
        continue;
      }
      if (
        (ch >= 0x0001 && ch <= 0x001F) ||
        ch === 0x007F ||
        (i === 0 && ch >= 0x0030 && ch <= 0x0039) ||
        (i === 1 && ch >= 0x0030 && ch <= 0x0039 && str.charCodeAt(0) === 0x002D)
      ) {
        result.push('\\' + ch.toString(16) + ' ');
        continue;
      }
      if (
        ch >= 0x0080 ||
        ch === 0x002D ||
        ch === 0x005F ||
        (ch >= 0x0030 && ch <= 0x0039) ||
        (ch >= 0x0041 && ch <= 0x005A) ||
        (ch >= 0x0061 && ch <= 0x007A)
      ) {
        result.push(str.charAt(i));
        continue;
      }
      result.push('\\' + str.charAt(i));
    }
    return result.join('');
  };
}

// PointerEvent is not implemented in jsdom — use MouseEvent as a stand-in
if (typeof globalThis.PointerEvent === 'undefined') {
  (globalThis as any).PointerEvent = class PointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly width: number;
    readonly height: number;
    readonly pressure: number;
    readonly tiltX: number;
    readonly tiltY: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init?: PointerEventInit & MouseEventInit) {
      super(type, init);
      this.pointerId = init?.pointerId ?? 0;
      this.width = init?.width ?? 1;
      this.height = init?.height ?? 1;
      this.pressure = init?.pressure ?? 0;
      this.tiltX = init?.tiltX ?? 0;
      this.tiltY = init?.tiltY ?? 0;
      this.pointerType = init?.pointerType ?? 'mouse';
      this.isPrimary = init?.isPrimary ?? true;
    }
  };
}

// HTMLFormElement.requestSubmit() is not implemented in jsdom
if (typeof HTMLFormElement.prototype.requestSubmit === 'undefined') {
  HTMLFormElement.prototype.requestSubmit = function (submitter?: HTMLElement) {
    if (submitter) {
      if (!(submitter instanceof HTMLElement)) {
        throw new TypeError('The specified element is not a submit button');
      }
      // Dispatch submit event
      const event = new Event('submit', { bubbles: true, cancelable: true });
      this.dispatchEvent(event);
    } else {
      const event = new Event('submit', { bubbles: true, cancelable: true });
      this.dispatchEvent(event);
    }
  };
}

// HTMLInputElement.select() is not fully implemented in jsdom
if (typeof HTMLInputElement.prototype.select === 'undefined') {
  HTMLInputElement.prototype.select = function () {
    // No-op in jsdom — real browsers select all text
  };
}

// Element.scrollIntoView() is not implemented in jsdom
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = function () {
    // No-op in jsdom — no viewport to scroll
  };
}

// jsdom validates that MouseEvent/PointerEvent `view` is its own internal Window type.
// When content-handlers.ts uses `view: window`, jsdom rejects it because the module's
// `window` reference doesn't pass jsdom's instanceof check. We patch both constructors
// to strip the `view` property.
const OrigMouseEvent = globalThis.MouseEvent;
(globalThis as any).MouseEvent = class PatchedMouseEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly buttons: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly detail: number;

  constructor(type: string, init?: MouseEventInit & { detail?: number }) {
    const { view, ...rest } = (init || {}) as any;
    super(type, rest);
    this.clientX = init?.clientX ?? 0;
    this.clientY = init?.clientY ?? 0;
    this.button = init?.button ?? 0;
    this.buttons = init?.buttons ?? 0;
    this.altKey = init?.altKey ?? false;
    this.ctrlKey = init?.ctrlKey ?? false;
    this.metaKey = init?.metaKey ?? false;
    this.shiftKey = init?.shiftKey ?? false;
    this.detail = init?.detail ?? 0;
  }
};

(globalThis as any).PointerEvent = class PatchedPointerEvent extends (globalThis as any).MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, init?: any) {
    super(type, init);
    this.pointerId = init?.pointerId ?? 0;
    this.pointerType = init?.pointerType ?? 'mouse';
    this.isPrimary = init?.isPrimary ?? true;
  }
};
