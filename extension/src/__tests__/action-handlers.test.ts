/**
 * @vitest-environment jsdom
 */
import './setup.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveRef,
  handleClick,
  handleType,
  handlePressKey,
  handleHover,
  handleFillForm,
  handleSelectOption,
  handleEvaluate,
  handleWaitFor,
  handlePageContent,
  buildAccessibilityTree,
  resetRefState,
  refMap,
  keyToCode,
  isContentRequest,
  makeResponse,
  processRequest,
} from '../content-handlers.js';

/**
 * Helper: build a snapshot so refMap gets populated, then return the ref
 * for an element with the given id.
 */
function snapshotAndGetRef(id: string): string {
  buildAccessibilityTree();
  for (const [ref, el] of refMap.entries()) {
    if (el instanceof HTMLElement && el.id === id) return ref;
  }
  throw new Error(`No ref found for element with id="${id}"`);
}

beforeEach(() => {
  document.body.innerHTML = '';
  resetRefState();
  vi.restoreAllMocks();
});

// ============================================================
// resolveRef
// ============================================================

describe('resolveRef', () => {
  it('resolves a valid ref to the correct element', () => {
    document.body.innerHTML = '<button id="btn">OK</button>';
    const ref = snapshotAndGetRef('btn');
    const el = resolveRef(ref);
    expect(el).toBeDefined();
    expect((el as HTMLElement).id).toBe('btn');
  });

  it('throws for unknown ref', () => {
    expect(() => resolveRef('e999')).toThrow('not found');
  });

  it('throws for stale ref (element removed from DOM)', () => {
    document.body.innerHTML = '<button id="btn">OK</button>';
    const ref = snapshotAndGetRef('btn');
    // Remove the element from DOM
    document.getElementById('btn')!.remove();
    expect(() => resolveRef(ref)).toThrow('stale');
  });

  it('cleans up stale ref from refMap', () => {
    document.body.innerHTML = '<button id="btn">OK</button>';
    const ref = snapshotAndGetRef('btn');
    document.getElementById('btn')!.remove();
    try { resolveRef(ref); } catch { /* expected */ }
    expect(refMap.has(ref)).toBe(false);
  });
});

// ============================================================
// handleClick
// ============================================================

describe('handleClick', () => {
  it('dispatches pointer and mouse events', () => {
    document.body.innerHTML = '<button id="btn">Click me</button>';
    const ref = snapshotAndGetRef('btn');
    const btn = document.getElementById('btn')!;
    const events: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      btn.addEventListener(type, () => events.push(type));
    }

    handleClick({ ref });
    expect(events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  });

  it('dispatches dblclick for doubleClick option', () => {
    document.body.innerHTML = '<button id="btn">Click me</button>';
    const ref = snapshotAndGetRef('btn');
    const btn = document.getElementById('btn')!;
    const events: string[] = [];
    btn.addEventListener('click', () => events.push('click'));
    btn.addEventListener('dblclick', () => events.push('dblclick'));

    handleClick({ ref, doubleClick: true });
    // Should have 2 clicks + 1 dblclick
    expect(events.filter((e) => e === 'click')).toHaveLength(2);
    expect(events.filter((e) => e === 'dblclick')).toHaveLength(1);
  });

  it('passes modifier keys to events', () => {
    document.body.innerHTML = '<button id="btn">Click</button>';
    const ref = snapshotAndGetRef('btn');
    const btn = document.getElementById('btn')!;
    let capturedEvent: MouseEvent | null = null;
    btn.addEventListener('click', (e) => { capturedEvent = e; });

    handleClick({ ref, modifiers: ['Control', 'Shift'] });
    expect(capturedEvent!.ctrlKey).toBe(true);
    expect(capturedEvent!.shiftKey).toBe(true);
    expect(capturedEvent!.altKey).toBe(false);
  });

  it('sets correct button code for right click', () => {
    document.body.innerHTML = '<button id="btn">Click</button>';
    const ref = snapshotAndGetRef('btn');
    const btn = document.getElementById('btn')!;
    let capturedEvent: MouseEvent | null = null;
    btn.addEventListener('mousedown', (e) => { capturedEvent = e; });

    handleClick({ ref, button: 'right' });
    expect(capturedEvent!.button).toBe(2);
  });

  it('focuses the element after click', () => {
    document.body.innerHTML = '<button id="btn">Click</button>';
    const ref = snapshotAndGetRef('btn');
    handleClick({ ref });
    expect(document.activeElement?.id).toBe('btn');
  });

  it('throws for invalid ref', () => {
    expect(() => handleClick({ ref: 'e999' })).toThrow('not found');
  });
});

// ============================================================
// handleType
// ============================================================

describe('handleType', () => {
  it('types text into an input element (fast mode)', async () => {
    document.body.innerHTML = '<input id="inp" type="text" />';
    const ref = snapshotAndGetRef('inp');
    await handleType({ ref, text: 'hello' });
    expect((document.getElementById('inp') as HTMLInputElement).value).toBe('hello');
  });

  it('fires input and change events (fast mode)', async () => {
    document.body.innerHTML = '<input id="inp" type="text" />';
    const ref = snapshotAndGetRef('inp');
    const inp = document.getElementById('inp')!;
    const events: string[] = [];
    inp.addEventListener('input', () => events.push('input'));
    inp.addEventListener('change', () => events.push('change'));

    await handleType({ ref, text: 'test' });
    expect(events).toContain('input');
    expect(events).toContain('change');
  });

  it('types text slowly (character by character)', async () => {
    document.body.innerHTML = '<input id="inp" type="text" />';
    const ref = snapshotAndGetRef('inp');
    const inp = document.getElementById('inp') as HTMLInputElement;
    const inputEvents: string[] = [];
    inp.addEventListener('input', (e) => {
      inputEvents.push((e as InputEvent).data || '');
    });

    await handleType({ ref, text: 'ab', slowly: true });
    expect(inp.value).toBe('ab');
    expect(inputEvents).toEqual(['a', 'b']);
  });

  it('types into textarea', async () => {
    document.body.innerHTML = '<textarea id="ta"></textarea>';
    const ref = snapshotAndGetRef('ta');
    await handleType({ ref, text: 'multiline' });
    expect((document.getElementById('ta') as HTMLTextAreaElement).value).toBe('multiline');
  });

  it('submits form when submit=true', async () => {
    document.body.innerHTML = `
      <form id="form">
        <input id="inp" type="text" />
      </form>
    `;
    const ref = snapshotAndGetRef('inp');
    const form = document.getElementById('form') as HTMLFormElement;
    let submitted = false;
    // requestSubmit triggers submit event
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });

    await handleType({ ref, text: 'test', submit: true });
    expect(submitted).toBe(true);
  });

  it('throws for non-editable elements', async () => {
    document.body.innerHTML = '<div id="div" tabindex="0">text</div>';
    const ref = snapshotAndGetRef('div');
    await expect(handleType({ ref, text: 'test' })).rejects.toThrow('not an editable element');
  });

  it('focuses the element before typing', async () => {
    document.body.innerHTML = '<input id="inp" type="text" />';
    const ref = snapshotAndGetRef('inp');
    await handleType({ ref, text: 'x' });
    expect(document.activeElement?.id).toBe('inp');
  });
});

// ============================================================
// handlePressKey
// ============================================================

describe('handlePressKey', () => {
  it('dispatches keydown and keyup (no deprecated keypress)', () => {
    document.body.innerHTML = '<input id="inp" type="text" />';
    snapshotAndGetRef('inp');
    (document.getElementById('inp') as HTMLElement).focus();

    const events: string[] = [];
    document.getElementById('inp')!.addEventListener('keydown', () => events.push('keydown'));
    document.getElementById('inp')!.addEventListener('keypress', () => events.push('keypress'));
    document.getElementById('inp')!.addEventListener('keyup', () => events.push('keyup'));

    handlePressKey({ key: 'Enter' });
    expect(events).toEqual(['keydown', 'keyup']);
  });

  it('sets correct key and code properties', () => {
    document.body.innerHTML = '<input id="inp" type="text" />';
    snapshotAndGetRef('inp');
    (document.getElementById('inp') as HTMLElement).focus();

    let capturedEvent: KeyboardEvent | null = null;
    document.getElementById('inp')!.addEventListener('keydown', (e) => {
      capturedEvent = e;
    });

    handlePressKey({ key: 'a' });
    expect(capturedEvent!.key).toBe('a');
    expect(capturedEvent!.code).toBe('KeyA');
  });

  it('dispatches to document body when nothing is focused', () => {
    const events: string[] = [];
    document.body.addEventListener('keydown', () => events.push('keydown'));
    handlePressKey({ key: 'Escape' });
    expect(events).toContain('keydown');
  });
});

// ============================================================
// keyToCode
// ============================================================

describe('keyToCode', () => {
  it('maps single letters to KeyX', () => {
    expect(keyToCode('a')).toBe('KeyA');
    expect(keyToCode('z')).toBe('KeyZ');
    expect(keyToCode('A')).toBe('KeyA');
  });

  it('maps digits to DigitX', () => {
    expect(keyToCode('0')).toBe('Digit0');
    expect(keyToCode('9')).toBe('Digit9');
  });

  it('maps space to Space', () => {
    expect(keyToCode(' ')).toBe('Space');
  });

  it('maps punctuation correctly', () => {
    expect(keyToCode('-')).toBe('Minus');
    expect(keyToCode('=')).toBe('Equal');
    expect(keyToCode(',')).toBe('Comma');
    expect(keyToCode('.')).toBe('Period');
  });

  it('returns named keys as-is', () => {
    expect(keyToCode('Enter')).toBe('Enter');
    expect(keyToCode('ArrowLeft')).toBe('ArrowLeft');
    expect(keyToCode('Escape')).toBe('Escape');
  });
});

// ============================================================
// handleHover
// ============================================================

describe('handleHover', () => {
  it('dispatches pointer and mouse hover events', () => {
    document.body.innerHTML = '<button id="btn">Hover me</button>';
    const ref = snapshotAndGetRef('btn');
    const btn = document.getElementById('btn')!;
    const events: string[] = [];
    for (const type of ['pointerenter', 'pointerover', 'pointermove', 'mouseenter', 'mouseover', 'mousemove']) {
      btn.addEventListener(type, () => events.push(type));
    }

    handleHover({ ref });
    expect(events).toEqual([
      'pointerenter', 'pointerover', 'pointermove',
      'mouseenter', 'mouseover', 'mousemove',
    ]);
  });

  it('throws for invalid ref', () => {
    expect(() => handleHover({ ref: 'e999' })).toThrow('not found');
  });
});

// ============================================================
// handleFillForm
// ============================================================

describe('handleFillForm', () => {
  it('fills a text input', () => {
    document.body.innerHTML = '<input id="name" type="text" />';
    const ref = snapshotAndGetRef('name');
    const result = handleFillForm({
      fields: [{ ref, name: 'Name', type: 'textbox', value: 'Willow' }],
    });
    expect(result.filledCount).toBe(1);
    expect((document.getElementById('name') as HTMLInputElement).value).toBe('Willow');
  });

  it('fills a checkbox', () => {
    document.body.innerHTML = '<input id="cb" type="checkbox" />';
    const ref = snapshotAndGetRef('cb');
    const result = handleFillForm({
      fields: [{ ref, name: 'Agree', type: 'checkbox', value: 'true' }],
    });
    expect(result.filledCount).toBe(1);
    expect((document.getElementById('cb') as HTMLInputElement).checked).toBe(true);
  });

  it('does not toggle checkbox when already in desired state', () => {
    document.body.innerHTML = '<input id="cb" type="checkbox" checked />';
    const ref = snapshotAndGetRef('cb');
    handleFillForm({
      fields: [{ ref, name: 'Agree', type: 'checkbox', value: 'true' }],
    });
    expect((document.getElementById('cb') as HTMLInputElement).checked).toBe(true);
  });

  it('fills a radio button', () => {
    document.body.innerHTML = '<input id="r1" type="radio" name="choice" />';
    const ref = snapshotAndGetRef('r1');
    handleFillForm({
      fields: [{ ref, name: 'Choice', type: 'radio', value: 'on' }],
    });
    expect((document.getElementById('r1') as HTMLInputElement).checked).toBe(true);
  });

  it('fills a combobox (select)', () => {
    document.body.innerHTML = `
      <select id="sel">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </select>
    `;
    const ref = snapshotAndGetRef('sel');
    const result = handleFillForm({
      fields: [{ ref, name: 'Option', type: 'combobox', value: 'Beta' }],
    });
    expect(result.filledCount).toBe(1);
    expect((document.getElementById('sel') as HTMLSelectElement).value).toBe('b');
  });

  it('fills a slider (range input)', () => {
    document.body.innerHTML = '<input id="slider" type="range" min="0" max="100" />';
    const ref = snapshotAndGetRef('slider');
    handleFillForm({
      fields: [{ ref, name: 'Volume', type: 'slider', value: '75' }],
    });
    expect((document.getElementById('slider') as HTMLInputElement).value).toBe('75');
  });

  it('collects errors per field and continues', () => {
    document.body.innerHTML = `
      <input id="a" type="text" />
      <input id="b" type="text" />
    `;
    buildAccessibilityTree();
    const refA = snapshotAndGetRef('a');
    // Use a ref that doesn't exist
    const result = handleFillForm({
      fields: [
        { ref: 'e999', name: 'Missing', type: 'textbox', value: 'test' },
        { ref: refA, name: 'A', type: 'textbox', value: 'ok' },
      ],
    });
    expect(result.filledCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).toContain('Missing');
  });

  it('reports error for type mismatch', () => {
    document.body.innerHTML = '<input id="inp" type="text" />';
    const ref = snapshotAndGetRef('inp');
    const result = handleFillForm({
      fields: [{ ref, name: 'Field', type: 'checkbox', value: 'true' }],
    });
    expect(result.filledCount).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).toContain('not a checkbox');
  });

  it('reports error for missing combobox option', () => {
    document.body.innerHTML = `
      <select id="sel">
        <option value="a">Alpha</option>
      </select>
    `;
    const ref = snapshotAndGetRef('sel');
    const result = handleFillForm({
      fields: [{ ref, name: 'Option', type: 'combobox', value: 'Nonexistent' }],
    });
    expect(result.filledCount).toBe(0);
    expect(result.errors![0]).toContain('not found');
  });
});

// ============================================================
// handleSelectOption
// ============================================================

describe('handleSelectOption', () => {
  it('selects an option by text', () => {
    document.body.innerHTML = `
      <select id="sel">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </select>
    `;
    const ref = snapshotAndGetRef('sel');
    const result = handleSelectOption({ ref, values: ['Beta'] });
    expect(result.selected).toEqual(['Beta']);
    expect((document.getElementById('sel') as HTMLSelectElement).value).toBe('b');
  });

  it('selects an option by value', () => {
    document.body.innerHTML = `
      <select id="sel">
        <option value="opt1">First</option>
        <option value="opt2">Second</option>
      </select>
    `;
    const ref = snapshotAndGetRef('sel');
    const result = handleSelectOption({ ref, values: ['opt2'] });
    expect(result.selected).toEqual(['Second']);
  });

  it('selects multiple options for multi-select', () => {
    document.body.innerHTML = `
      <select id="sel" multiple>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
        <option value="c">Gamma</option>
      </select>
    `;
    const ref = snapshotAndGetRef('sel');
    const result = handleSelectOption({ ref, values: ['Alpha', 'Gamma'] });
    expect(result.selected).toEqual(['Alpha', 'Gamma']);
    const sel = document.getElementById('sel') as HTMLSelectElement;
    expect(sel.options[0].selected).toBe(true);
    expect(sel.options[1].selected).toBe(false);
    expect(sel.options[2].selected).toBe(true);
  });

  it('throws for non-select element', () => {
    document.body.innerHTML = '<input id="inp" type="text" />';
    const ref = snapshotAndGetRef('inp');
    expect(() => handleSelectOption({ ref, values: ['test'] })).toThrow('not a <select>');
  });

  it('throws for option not found', () => {
    document.body.innerHTML = `
      <select id="sel">
        <option value="a">Alpha</option>
      </select>
    `;
    const ref = snapshotAndGetRef('sel');
    expect(() => handleSelectOption({ ref, values: ['Nonexistent'] })).toThrow('not found');
  });

  it('fires change event', () => {
    document.body.innerHTML = `
      <select id="sel">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </select>
    `;
    const ref = snapshotAndGetRef('sel');
    const sel = document.getElementById('sel')!;
    let changed = false;
    sel.addEventListener('change', () => { changed = true; });

    handleSelectOption({ ref, values: ['Beta'] });
    expect(changed).toBe(true);
  });
});

// ============================================================
// handleEvaluate
// ============================================================

describe('handleEvaluate', () => {
  it('executes a simple function and returns the result', async () => {
    const result = await handleEvaluate({
      function: '() => 2 + 2',
    });
    expect(result).toEqual({ value: 4 });
  });

  it('executes an async function', async () => {
    const result = await handleEvaluate({
      function: 'async () => "hello"',
    });
    expect(result).toEqual({ value: 'hello' });
  });

  it('passes element when ref is provided', async () => {
    document.body.innerHTML = '<button id="target" data-val="42">Click me</button>';
    const ref = snapshotAndGetRef('target');

    const result = await handleEvaluate({
      function: '(el) => el.getAttribute("data-val")',
      ref,
    });
    expect(result).toEqual({ value: '42' });
  });

  it('throws on invalid ref', async () => {
    await expect(handleEvaluate({
      function: '(el) => el.textContent',
      ref: 'e9999',
    })).rejects.toThrow('not found');
  });

  it('returns error for non-function expression', async () => {
    await expect(handleEvaluate({
      function: '"not a function"',
    })).rejects.toThrow('did not evaluate to a function');
  });
});

// ============================================================
// handleWaitFor
// ============================================================

describe('handleWaitFor', () => {
  it('resolves immediately when text is already present', async () => {
    document.body.innerHTML = '<p>Hello world</p>';
    const result = await handleWaitFor({ text: 'Hello' });
    expect(result.matched).toBe(true);
  });

  it('resolves immediately when textGone text is already absent', async () => {
    document.body.innerHTML = '<p>Something else</p>';
    const result = await handleWaitFor({ textGone: 'Missing text' });
    expect(result.matched).toBe(true);
  });

  it('resolves when text appears via DOM mutation', async () => {
    document.body.innerHTML = '<div id="container"></div>';
    const promise = handleWaitFor({ text: 'Added' });

    // Mutate DOM after a short delay
    setTimeout(() => {
      document.getElementById('container')!.textContent = 'Added text';
    }, 50);

    const result = await promise;
    expect(result.matched).toBe(true);
  });

  it('times out when text never appears', async () => {
    document.body.innerHTML = '<p>Static content</p>';
    const result = await handleWaitFor({ text: 'Never appears', time: 0.1 });
    expect(result.matched).toBe(false);
  });

  it('resolves for time-only wait', async () => {
    const result = await handleWaitFor({ time: 0.05 } as any);
    expect(result.matched).toBe(true);
  });

  it('rejects when no params are provided', async () => {
    await expect(handleWaitFor({} as any)).rejects.toThrow('At least one');
  });
});

// ============================================================
// isContentRequest
// ============================================================

describe('isContentRequest', () => {
  it('returns true for valid content request', () => {
    expect(isContentRequest({
      type: 'content-request',
      id: '123',
      action: 'snapshot',
      params: {},
    })).toBe(true);
  });

  it('returns false for missing type', () => {
    expect(isContentRequest({ id: '123', action: 'snapshot', params: {} })).toBe(false);
  });

  it('returns false for wrong type', () => {
    expect(isContentRequest({ type: 'other', id: '123', action: 'snapshot' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isContentRequest(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isContentRequest('string')).toBe(false);
  });
});

// ============================================================
// makeResponse
// ============================================================

describe('makeResponse', () => {
  it('creates success response', () => {
    const resp = makeResponse('id1', true, { data: 'ok' });
    expect(resp.type).toBe('content-response');
    expect(resp.id).toBe('id1');
    expect(resp.success).toBe(true);
    expect(resp.result).toEqual({ data: 'ok' });
    expect(resp.error).toBeUndefined();
  });

  it('creates error response', () => {
    const resp = makeResponse('id2', false, undefined, 'something broke');
    expect(resp.success).toBe(false);
    expect(resp.error).toBe('something broke');
    expect(resp.result).toBeUndefined();
  });
});

// ============================================================
// processRequest
// ============================================================

describe('processRequest', () => {
  it('handles snapshot action', async () => {
    document.body.innerHTML = '<h1>Title</h1>';
    const resp = await processRequest('r1', 'snapshot', {});
    expect(resp.success).toBe(true);
    expect(resp.result).toBeDefined();
    expect((resp.result as any).tree).toBeDefined();
  });

  it('returns error for unimplemented action', async () => {
    const resp = await processRequest('r2', 'navigate', { url: 'http://example.com' });
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('not yet implemented');
  });

  it('handles click action', async () => {
    document.body.innerHTML = '<button id="btn">OK</button>';
    buildAccessibilityTree();
    const ref = [...refMap.entries()].find(([, el]) => (el as HTMLElement).id === 'btn')![0];
    const resp = await processRequest('r3', 'click', { ref });
    expect(resp.success).toBe(true);
  });

  it('returns error for click on invalid ref', async () => {
    const resp = await processRequest('r4', 'click', { ref: 'e999' });
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('not found');
  });
});

// ============================================================
// handlePageContent
// ============================================================

describe('handlePageContent', () => {
  it('extracts text from document body', () => {
    document.body.innerHTML = '<div><p>Hello world</p><p>Second paragraph</p></div>';
    const result = handlePageContent({});
    expect(result.text).toContain('Hello world');
    expect(result.text).toContain('Second paragraph');
    expect(result.url).toBeDefined();
    expect(result.title).toBeDefined();
  });

  it('extracts text from a specific selector', () => {
    document.body.innerHTML = '<div id="target">Target text</div><div>Other text</div>';
    const result = handlePageContent({ selector: '#target' });
    expect(result.text).toBe('Target text');
    expect(result.text).not.toContain('Other text');
  });

  it('throws for invalid selector', () => {
    document.body.innerHTML = '<div>Content</div>';
    expect(() => handlePageContent({ selector: '#nonexistent' })).toThrow('No element found');
  });

  it('normalizes whitespace', () => {
    document.body.innerHTML = '<div>  Multiple   spaces   here  </div>';
    const result = handlePageContent({});
    expect(result.text).not.toContain('  '); // no double spaces
  });
});
