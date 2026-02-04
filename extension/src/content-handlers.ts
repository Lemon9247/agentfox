// Agent Fox Firefox Extension — Content Script Handlers
// Extracted from content.ts for testability. Contains all the pure logic
// and DOM interaction handlers, but no browser.runtime listeners.

import type {
  AccessibilityNode,
  SnapshotResult,
  ActionType,
  ClickParams,
  TypeParams,
  PressKeyParams,
  HoverParams,
  FillFormParams,
  SelectOptionParams,
  EvaluateParams,
  WaitForParams,
  ContentRequest,
  ContentResponse,
} from '@agentfox/shared';

// ============================================================
// Constants
// ============================================================

/** Elements that should be skipped entirely during tree walks */
export const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME',
]);

/** Tags that map to implicit ARIA roles */
export const TAG_ROLE_MAP: Record<string, string> = {
  BUTTON: 'button',
  NAV: 'navigation',
  MAIN: 'main',
  ASIDE: 'complementary',
  FOOTER: 'contentinfo',
  HEADER: 'banner',
  FORM: 'form',
  TABLE: 'table',
  TR: 'row',
  TD: 'cell',
  TH: 'columnheader',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  DIALOG: 'dialog',
  IMG: 'img',
  OPTION: 'option',
};

/** Input type → role mapping */
export const INPUT_TYPE_ROLE_MAP: Record<string, string> = {
  text: 'textbox',
  search: 'searchbox',
  email: 'textbox',
  url: 'textbox',
  tel: 'textbox',
  password: 'textbox',
  number: 'spinbutton',
  range: 'slider',
  checkbox: 'checkbox',
  radio: 'radio',
  submit: 'button',
  reset: 'button',
  button: 'button',
  image: 'button',
  file: 'button',
};

/** Generic wrapper tags that should be flattened unless they carry semantic role */
const GENERIC_TAGS = new Set([
  'DIV', 'SPAN',
]);

// ============================================================
// Module-level state
// ============================================================

/**
 * Maps ref IDs (e.g. "e0", "e1") to DOM elements.
 * Rebuilt on every snapshot call. Action handlers use resolveRef() to
 * look up elements by their ref ID.
 *
 * IMPORTANT: refs become stale if the DOM mutates or a new snapshot is taken.
 * resolveRef() detects stale refs and returns clear error messages.
 */
export let refMap = new Map<string, Element>();

/** Counter for generating sequential ref IDs */
export let refCounter = 0;

/** Reset ref state — called at beginning of each snapshot */
export function resetRefState(): void {
  refMap = new Map();
  refCounter = 0;
}

/** Assign a ref ID to an interactive element and register it in the map */
export function assignRef(el: Element): string {
  const ref = `e${refCounter++}`;
  refMap.set(ref, el);
  return ref;
}

// ============================================================
// Logging
// ============================================================

const DEBUG = false;

function log(...args: unknown[]): void {
  if (DEBUG) console.log('[AgentFox:content]', ...args);
}

function logError(...args: unknown[]): void {
  if (DEBUG) console.error('[AgentFox:content]', ...args);
}

// ============================================================
// Visibility helpers
// ============================================================

/** Check if an element is hidden and should be skipped */
export function isHidden(el: Element): boolean {
  if (el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;

  if (el instanceof HTMLElement) {
    // Fast inline style check (no layout trigger)
    const style = el.style;
    if (style.display === 'none' || style.visibility === 'hidden') return true;

    // offsetParent is null for display:none elements (and for body, fixed, sticky)
    // This avoids getComputedStyle in the common case
    if (el.offsetParent === null && el.tagName !== 'BODY') {
      // Could be display:none OR position:fixed/sticky — need getComputedStyle to distinguish
      const computed = window.getComputedStyle(el);
      if (computed.display === 'none') return true;
      if (computed.visibility === 'hidden') return true;
    }
  }
  return false;
}

// ============================================================
// Role computation
// ============================================================

/** Determine the ARIA role for an element */
export function getRole(el: Element): string {
  // Explicit role attribute takes priority
  const explicitRole = el.getAttribute('role');
  if (explicitRole) return explicitRole;

  const tag = el.tagName;

  // Headings
  if (/^H[1-6]$/.test(tag)) return 'heading';

  // Anchor elements: only 'link' if they have an href
  if (tag === 'A') {
    return el.hasAttribute('href') ? 'link' : 'generic';
  }

  // Input elements have type-specific roles
  if (tag === 'INPUT') {
    const inputType = (el as HTMLInputElement).type || 'text';
    return INPUT_TYPE_ROLE_MAP[inputType] || 'textbox';
  }

  // Textarea
  if (tag === 'TEXTAREA') return 'textbox';

  // Select: multiple → listbox, single → combobox
  if (tag === 'SELECT') {
    return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
  }

  // Section with aria-label/aria-labelledby is a region, otherwise generic
  if (tag === 'SECTION') {
    if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) {
      return 'region';
    }
    return 'generic';
  }

  // Article
  if (tag === 'ARTICLE') return 'article';

  // Standard tag-to-role mapping
  if (tag in TAG_ROLE_MAP) return TAG_ROLE_MAP[tag];

  // Generic containers
  if (GENERIC_TAGS.has(tag)) return 'generic';

  // Other elements get 'generic' if they have no semantic meaning
  return 'generic';
}

// ============================================================
// Interactive element detection
// ============================================================

/** ARIA roles that indicate an interactive element */
export const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'textbox', 'combobox',
  'slider', 'switch', 'tab', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'treeitem', 'searchbox', 'spinbutton',
]);

/** Check if an element should receive a ref ID */
export function isInteractive(el: Element): boolean {
  const tag = el.tagName;

  // Standard interactive elements
  if (
    tag === 'A' ||
    tag === 'BUTTON' ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT'
  ) {
    return true;
  }

  // Elements with interactive attributes
  if (el.hasAttribute('onclick') || el.hasAttribute('onmousedown')) return true;
  if (el.getAttribute('contenteditable') === 'true') return true;

  // Elements with tabindex >= 0 are focusable/interactive
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && parseInt(tabindex, 10) >= 0) return true;

  // ARIA interactive roles
  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;

  return false;
}

// ============================================================
// Accessible name computation
// ============================================================

/** Get the text content of an element by ID (for aria-labelledby) */
function getTextById(id: string): string {
  const el = document.getElementById(id);
  return el ? (el.textContent || '').trim() : '';
}

/** Collect text content from an element, excluding form control descendants */
function getTextExcludingFormElements(el: Element): string {
  let text = '';
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent || '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = (child as Element).tagName;
      if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        text += getTextExcludingFormElements(child as Element);
      }
    }
  }
  return text.trim();
}

/** Find the label element associated with an input */
function findAssociatedLabel(el: Element): string {
  // Check for label via 'for' attribute
  const id = el.getAttribute('id');
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) return (label.textContent || '').trim();
  }

  // Check for wrapping label — walk text nodes to avoid cloning the DOM
  const parentLabel = el.closest('label');
  if (parentLabel) {
    return getTextExcludingFormElements(parentLabel);
  }

  return '';
}

/** Compute the accessible name for an element */
export function getAccessibleName(el: Element): string {
  // 1. aria-label (highest priority)
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // 2. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    const text = ids.map(getTextById).filter(Boolean).join(' ');
    if (text) return text;
  }

  // 3. Associated label (for form elements)
  const tag = el.tagName;
  if (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT'
  ) {
    const labelText = findAssociatedLabel(el);
    if (labelText) return labelText;
  }

  // 4. alt attribute (for images)
  if (tag === 'IMG') {
    const alt = el.getAttribute('alt');
    if (alt !== null) return alt.trim();
  }

  // 5. title attribute
  const title = el.getAttribute('title');
  if (title) return title.trim();

  // 6. Text content (for buttons, links, and other elements
  //    that derive their name from content)
  if (
    tag === 'A' ||
    tag === 'BUTTON' ||
    tag === 'H1' || tag === 'H2' || tag === 'H3' ||
    tag === 'H4' || tag === 'H5' || tag === 'H6' ||
    tag === 'LABEL' ||
    tag === 'LEGEND' ||
    tag === 'OPTION' ||
    tag === 'LI' ||
    tag === 'TD' || tag === 'TH' ||
    el.getAttribute('role') === 'button' ||
    el.getAttribute('role') === 'link'
  ) {
    const text = (el.textContent || '').trim();
    // Truncate very long text content
    if (text.length > 200) return text.slice(0, 200) + '...';
    if (text) return text;
  }

  // 7. placeholder (for inputs, as fallback)
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();
  }

  // 8. value for submit/button inputs
  if (tag === 'INPUT') {
    const inputType = (el as HTMLInputElement).type;
    if (inputType === 'submit' || inputType === 'reset' || inputType === 'button') {
      const value = (el as HTMLInputElement).value;
      if (value) return value.trim();
    }
  }

  return '';
}

// ============================================================
// Element state extraction
// ============================================================

/** Extract the current value of a form element */
export function getValue(el: Element): string | undefined {
  if (el instanceof HTMLInputElement) {
    const type = el.type;
    if (type === 'checkbox' || type === 'radio') return undefined;
    if (type === 'file') return el.files?.length ? `${el.files.length} file(s)` : undefined;
    return el.value || undefined;
  }
  if (el instanceof HTMLTextAreaElement) {
    return el.value || undefined;
  }
  if (el instanceof HTMLSelectElement) {
    return el.value || undefined;
  }
  return undefined;
}

/** Extract boolean/state properties from an element */
export function getElementState(el: Element): {
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  required?: boolean;
  description?: string;
} {
  const state: {
    checked?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    selected?: boolean;
    required?: boolean;
    description?: string;
  } = {};

  // Checked state
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      state.checked = el.checked;
    }
  }

  // Disabled state
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLButtonElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    if (el.disabled) state.disabled = true;
  }
  // Also check aria-disabled
  if (el.getAttribute('aria-disabled') === 'true') state.disabled = true;

  // Expanded state
  const expanded = el.getAttribute('aria-expanded');
  if (expanded !== null) state.expanded = expanded === 'true';

  // Selected state (for options)
  if (el instanceof HTMLOptionElement) {
    state.selected = el.selected;
  }
  const ariaSelected = el.getAttribute('aria-selected');
  if (ariaSelected !== null) state.selected = ariaSelected === 'true';

  // Required state
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    if (el.required) state.required = true;
  }
  if (el.getAttribute('aria-required') === 'true') state.required = true;

  // Description (aria-describedby or title if not used as name)
  const describedBy = el.getAttribute('aria-describedby');
  if (describedBy) {
    const ids = describedBy.split(/\s+/);
    const desc = ids.map(getTextById).filter(Boolean).join(' ');
    if (desc) state.description = desc;
  } else {
    // Use title as description only if it wasn't used as the accessible name
    const title = el.getAttribute('title');
    const ariaLabel = el.getAttribute('aria-label');
    const labelledBy = el.getAttribute('aria-labelledby');
    if (title && (ariaLabel || labelledBy)) {
      state.description = title.trim();
    }
  }

  return state;
}

// ============================================================
// Accessibility tree builder
// ============================================================

/** Collect direct text content of an element (text nodes only, not descendants) */
function getDirectTextContent(el: Element): string {
  let text = '';
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = (child.textContent || '').trim();
      if (t) {
        text += (text ? ' ' : '') + t;
      }
    }
  }
  return text;
}

/** Check whether a role is semantic (worth keeping in the tree) */
function isSemanticRole(role: string): boolean {
  return role !== 'generic';
}

/** Maximum number of nodes to process before truncating the tree */
export const MAX_NODES = 50000;

/** Running node counter, reset per snapshot */
let nodeCount = 0;

/**
 * Build an AccessibilityNode from a DOM element and its subtree.
 * Returns null if the element should be excluded from the tree.
 */
export function buildNode(el: Element, depth: number): AccessibilityNode | null {
  // Bail if we've hit the node limit
  if (nodeCount >= MAX_NODES) return null;
  nodeCount++;

  // Hard depth limit to prevent stack overflow on pathological DOMs
  if (depth > 100) return null;

  // Skip invisible elements
  if (isHidden(el)) return null;

  // Skip non-content tags
  if (SKIP_TAGS.has(el.tagName)) return null;

  const role = getRole(el);
  const interactive = isInteractive(el);
  const name = getAccessibleName(el);
  const semantic = isSemanticRole(role);

  // Build children by walking childNodes in document order, interleaving
  // element children and text pseudo-nodes to preserve correct ordering.
  const childNodes: AccessibilityNode[] = [];

  for (const child of el.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childNode = buildNode(child as Element, depth + 1);
      if (childNode) {
        childNodes.push(childNode);
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent || '').trim();
      if (text && text !== name) {
        childNodes.push({
          role: 'text',
          name: text.length > 200 ? text.slice(0, 200) + '...' : text,
        });
      }
    }
  }

  // Flatten generic containers: if a non-interactive, non-semantic element
  // has no meaningful name, promote its children directly
  if (!interactive && !semantic && !name) {
    if (childNodes.length === 0) {
      // Generic wrapper with no useful content — check for text content
      const text = getDirectTextContent(el);
      if (!text) return null;
      // Has text content — emit as text node
      return {
        role: 'text',
        name: text.length > 200 ? text.slice(0, 200) + '...' : text,
      };
    }
    if (childNodes.length === 1) {
      // Single child — promote it directly
      return childNodes[0];
    }
    // Wrap in generic node — parent's flattenGenericChildren will inline these
    return {
      role: 'generic',
      name: '',
      children: childNodes,
    };
  }

  // Build the node
  const node: AccessibilityNode = {
    role,
    name,
  };

  // Assign ref for interactive elements
  if (interactive) {
    node.ref = assignRef(el);
  }

  // Heading level
  if (role === 'heading') {
    const match = el.tagName.match(/^H(\d)$/);
    if (match) {
      node.level = parseInt(match[1], 10);
    }
  }

  // Value
  const value = getValue(el);
  if (value !== undefined) node.value = value;

  // State properties
  const state = getElementState(el);
  if (state.checked !== undefined) node.checked = state.checked;
  if (state.disabled !== undefined) node.disabled = state.disabled;
  if (state.expanded !== undefined) node.expanded = state.expanded;
  if (state.selected !== undefined) node.selected = state.selected;
  if (state.required !== undefined) node.required = state.required;
  if (state.description !== undefined) node.description = state.description;

  // Attach children (flattening nested generics)
  const flatChildren = flattenGenericChildren(childNodes);
  if (flatChildren.length > 0) {
    node.children = flatChildren;
  }

  // For non-interactive elements with no children and no name,
  // return a text node from content if there is text
  if (!interactive && !node.children && !name) {
    const text = (el.textContent || '').trim();
    if (!text) return null;
    node.name = text.length > 200 ? text.slice(0, 200) + '...' : text;
  }

  return node;
}

/**
 * Flatten children: if a child is a nameless generic node, promote
 * its children to the parent level.
 */
export function flattenGenericChildren(children: AccessibilityNode[]): AccessibilityNode[] {
  const result: AccessibilityNode[] = [];
  for (const child of children) {
    if (child.role === 'generic' && !child.name && !child.ref && child.children) {
      // Recursively flatten
      result.push(...flattenGenericChildren(child.children));
    } else {
      result.push(child);
    }
  }
  return result;
}

/**
 * Build the full accessibility tree for the current page.
 * Returns the root AccessibilityNode (role: "document").
 */
export function buildAccessibilityTree(): AccessibilityNode {
  // Reset state for fresh build
  resetRefState();
  nodeCount = 0;

  const root: AccessibilityNode = {
    role: 'document',
    name: document.title || '',
  };

  if (!document.body) return root;

  const children: AccessibilityNode[] = [];
  for (const child of document.body.children) {
    const node = buildNode(child, 0);
    if (node) children.push(node);
  }

  const flatChildren = flattenGenericChildren(children);
  if (flatChildren.length > 0) {
    root.children = flatChildren;
  }

  // If we hit the node limit, add a truncation indicator
  if (nodeCount >= MAX_NODES) {
    if (!root.children) root.children = [];
    root.children.push({
      role: 'text',
      name: `[Tree truncated at ${MAX_NODES} nodes]`,
    });
  }

  return root;
}

// ============================================================
// Snapshot handler
// ============================================================

export function handleSnapshot(): SnapshotResult {
  const tree = buildAccessibilityTree();
  return {
    tree,
    url: window.location.href,
    title: document.title,
  };
}

// ============================================================
// Ref resolution helper
// ============================================================

/**
 * Resolve a ref ID (e.g. "e5") to the corresponding DOM element.
 * Throws if the ref is not found (stale or invalid).
 */
export function resolveRef(ref: string): Element {
  const el = refMap.get(ref);
  if (!el) {
    throw new Error(
      `Element ref "${ref}" not found. The page may have changed since the last snapshot. Take a new snapshot and use updated refs.`,
    );
  }
  // Verify the element is still in the document
  if (!document.contains(el)) {
    refMap.delete(ref);
    throw new Error(
      `Element ref "${ref}" is stale — the element is no longer in the DOM. Take a new snapshot.`,
    );
  }
  return el;
}

// ============================================================
// Click handler
// ============================================================

export function handleClick(params: ClickParams): void {
  const el = resolveRef(params.ref);

  // Scroll element into view so coordinates are within the viewport
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  }

  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const buttonCode =
    params.button === 'right' ? 2 : params.button === 'middle' ? 1 : 0;

  const modifiers = {
    altKey: params.modifiers?.includes('Alt') ?? false,
    ctrlKey: params.modifiers?.includes('Control') ?? false,
    metaKey: params.modifiers?.includes('Meta') ?? false,
    shiftKey: params.modifiers?.includes('Shift') ?? false,
  };

  const commonOpts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: buttonCode,
    ...modifiers,
  };

  // Dispatch pointer + mouse events in the correct browser order
  // pointerdown -> mousedown -> pointerup -> mouseup -> click
  el.dispatchEvent(new PointerEvent('pointerdown', { ...commonOpts, detail: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...commonOpts, detail: 1 }));
  el.dispatchEvent(new PointerEvent('pointerup', { ...commonOpts, detail: 1 }));
  el.dispatchEvent(new MouseEvent('mouseup', { ...commonOpts, detail: 1 }));
  el.dispatchEvent(new MouseEvent('click', { ...commonOpts, detail: 1 }));

  if (params.doubleClick) {
    // Second click in the double-click sequence, with detail=2
    el.dispatchEvent(new PointerEvent('pointerdown', { ...commonOpts, detail: 2 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...commonOpts, detail: 2 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...commonOpts, detail: 2 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...commonOpts, detail: 2 }));
    el.dispatchEvent(new MouseEvent('click', { ...commonOpts, detail: 2 }));
    el.dispatchEvent(new MouseEvent('dblclick', { ...commonOpts, detail: 2 }));
  }

  // Focus the element if it's focusable
  if (el instanceof HTMLElement) {
    el.focus();
  }
}

// ============================================================
// Type handler
// ============================================================

export async function handleType(params: TypeParams): Promise<void> {
  const el = resolveRef(params.ref);

  // Focus the element
  if (el instanceof HTMLElement) {
    el.focus();
  }

  // Clear existing value and set new one
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement
  ) {
    if (params.slowly) {
      // Type character by character, dispatching events for each
      el.value = '';
      for (const char of params.text) {
        el.value += char;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
        el.dispatchEvent(new InputEvent('input', { data: char, inputType: 'insertText', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        // Small delay between characters
        await new Promise((r) => setTimeout(r, 30));
      }
    } else {
      // Select all existing text then replace in one step
      el.select();
      el.value = params.text;
      el.dispatchEvent(
        new InputEvent('input', {
          data: params.text,
          inputType: 'insertText',
          bubbles: true,
        }),
      );
    }

    // Fire change event
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el instanceof HTMLElement && el.isContentEditable) {
    // Content-editable element — use execCommand to work with rich text editors
    // Select all existing content first
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);

    if (params.slowly) {
      // Delete existing content, then type character by character
      document.execCommand('delete', false);
      for (const char of params.text) {
        document.execCommand('insertText', false, char);
        await new Promise((r) => setTimeout(r, 30));
      }
    } else {
      // Replace all selected content at once
      document.execCommand('insertText', false, params.text);
    }
  } else {
    throw new Error(
      `Element ref "${params.ref}" is not an editable element (input, textarea, or contenteditable)`,
    );
  }

  // Submit if requested (press Enter)
  if (params.submit) {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    );
    el.dispatchEvent(
      new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }),
    );
    el.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }),
    );

    // Submit the containing form if there is one
    const form = el.closest('form');
    if (form) {
      form.requestSubmit();
    }
  }
}

// ============================================================
// Press key handler
// ============================================================

/** Map a key name to the physical key code */
export function keyToCode(key: string): string {
  // Single character keys
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return `Key${upper}`;
    if (upper >= '0' && upper <= '9') return `Digit${upper}`;
    // Common punctuation
    const punctMap: Record<string, string> = {
      ' ': 'Space', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft',
      ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon',
      "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash',
      '`': 'Backquote',
    };
    return punctMap[key] || key;
  }
  // Named keys where key and code match (Enter, Tab, Escape, Arrow*, etc.)
  return key;
}

export function handlePressKey(params: PressKeyParams): void {
  // Dispatch to the focused element or document body
  const target = document.activeElement || document.body;

  const opts: KeyboardEventInit = {
    key: params.key,
    code: keyToCode(params.key),
    bubbles: true,
    cancelable: true,
  };

  target.dispatchEvent(new KeyboardEvent('keydown', opts));
  target.dispatchEvent(new KeyboardEvent('keypress', opts));
  target.dispatchEvent(new KeyboardEvent('keyup', opts));
}

// ============================================================
// Hover handler
// ============================================================

export function handleHover(params: HoverParams): void {
  const el = resolveRef(params.ref);

  // Scroll into view before hovering
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  }

  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
  };

  // Dispatch pointer events first (modern frameworks rely on these)
  el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }));
  el.dispatchEvent(new PointerEvent('pointerover', opts));
  el.dispatchEvent(new PointerEvent('pointermove', opts));

  // Then mouse events
  el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mousemove', opts));
}

// ============================================================
// Fill form handler
// ============================================================

export function handleFillForm(params: FillFormParams): { filledCount: number; errors?: string[] } {
  let filledCount = 0;
  const errors: string[] = [];

  for (const field of params.fields) {
    let el: Element;
    try {
      el = resolveRef(field.ref);
    } catch (err) {
      errors.push(`Field "${field.name}" (ref ${field.ref}): ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    try {
      switch (field.type) {
        case 'textbox': {
          if (
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement
          ) {
            el.focus();
            el.value = field.value;
            el.dispatchEvent(new InputEvent('input', { data: field.value, inputType: 'insertText', bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (el instanceof HTMLElement && el.isContentEditable) {
            el.focus();
            el.textContent = field.value;
            el.dispatchEvent(new InputEvent('input', { data: field.value, inputType: 'insertText', bubbles: true }));
          } else {
            throw new Error(`not a text input`);
          }
          break;
        }

        case 'checkbox': {
          if (el instanceof HTMLInputElement && el.type === 'checkbox') {
            const shouldBeChecked = field.value === 'true';
            if (el.checked !== shouldBeChecked) {
              el.click();
            }
          } else {
            throw new Error(`not a checkbox`);
          }
          break;
        }

        case 'radio': {
          if (el instanceof HTMLInputElement && el.type === 'radio') {
            if (!el.checked) {
              el.click();
            }
          } else {
            throw new Error(`not a radio button`);
          }
          break;
        }

        case 'combobox': {
          if (el instanceof HTMLSelectElement) {
            const option = Array.from(el.options).find(
              (opt) => opt.textContent?.trim() === field.value || opt.value === field.value,
            );
            if (!option) {
              throw new Error(`option "${field.value}" not found`);
            }
            el.value = option.value;
            el.dispatchEvent(new InputEvent('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            throw new Error(`not a select element`);
          }
          break;
        }

        case 'slider': {
          if (el instanceof HTMLInputElement && el.type === 'range') {
            el.value = field.value;
            el.dispatchEvent(new InputEvent('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            throw new Error(`not a range input`);
          }
          break;
        }

        default:
          throw new Error(`unknown field type "${field.type}"`);
      }

      filledCount++;
    } catch (err) {
      errors.push(`Field "${field.name}" (ref ${field.ref}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const result: { filledCount: number; errors?: string[] } = { filledCount };
  if (errors.length > 0) result.errors = errors;
  return result;
}

// ============================================================
// Select option handler
// ============================================================

export function handleSelectOption(params: SelectOptionParams): { selected: string[] } {
  const el = resolveRef(params.ref);

  if (!(el instanceof HTMLSelectElement)) {
    throw new Error(
      `Element ref "${params.ref}" is not a <select> element`,
    );
  }

  const selected: string[] = [];

  // For multi-select, deselect all first. For single-select, setting
  // a new option automatically deselects the previous one.
  if (el.multiple) {
    for (const opt of el.options) {
      opt.selected = false;
    }
  }

  // Select matching options by text or value
  for (const value of params.values) {
    const option = Array.from(el.options).find(
      (opt) => opt.textContent?.trim() === value || opt.value === value,
    );
    if (!option) {
      throw new Error(
        `Option "${value}" not found in select element (ref ${params.ref})`,
      );
    }
    option.selected = true;
    selected.push(option.textContent?.trim() || option.value);
  }

  el.dispatchEvent(new Event('change', { bubbles: true }));

  return { selected };
}

// ============================================================
// Evaluate handler
// ============================================================
// Security note: This handler injects a <script> tag into the page's main world,
// giving the evaluated code full page-context privileges (equivalent to the dev console).
// This bypasses CSP restrictions that block new Function() in the content script's
// isolated world. The trust model is that the MCP client is trusted -- see README.md.

export async function handleEvaluate(params: EvaluateParams): Promise<{ value: unknown }> {
  // If a ref is provided, resolve the element and inject it into the page scope
  // via a data attribute so the evaluated script can find it.
  let refSelector: string | undefined;
  if (params.ref) {
    const el = resolveRef(params.ref);
    // Tag the element so the injected script can find it
    const marker = `__agentfox_eval_${Date.now()}`;
    el.setAttribute('data-agentfox-eval', marker);
    refSelector = `[data-agentfox-eval="${marker}"]`;
    // Clean up the marker after a short delay
    setTimeout(() => el.removeAttribute('data-agentfox-eval'), 100);
  }

  // Execute via injected <script> tag to run in the page's main world,
  // bypassing content script CSP restrictions. This is the standard
  // pattern for extensions that need to run arbitrary JS in the page context.
  const result = await new Promise<unknown>((resolve, reject) => {
    const resultId = `__agentfox_result_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Listen for the result via a custom event
    function onResult(event: Event) {
      const detail = (event as CustomEvent).detail;
      window.removeEventListener(resultId, onResult);
      if (detail.error) {
        reject(new Error(detail.error));
      } else {
        resolve(detail.value);
      }
    }
    window.addEventListener(resultId, onResult);

    // Build the script that will run in the page's main world
    const script = document.createElement('script');
    script.textContent = `
      (async () => {
        try {
          const fn = (${params.function});
          if (typeof fn !== 'function') {
            throw new Error('The provided string did not evaluate to a function');
          }
          ${refSelector ? `const el = document.querySelector('${refSelector}');` : ''}
          const result = ${refSelector ? 'await fn(el)' : 'await fn()'};
          // Serialize safely -- DOM nodes, circular refs, and oversized results
          let value;
          try {
            // Detect DOM nodes early (they cause issues even with String())
            if (result instanceof Node) {
              value = '[DOM Node: ' + (result.nodeName || 'unknown') + ']';
            } else {
              const serialized = JSON.stringify(result);
              // Guard against oversized results (> 1MB)
              if (serialized && serialized.length > 1048576) {
                value = '[Result truncated: serialized size ' + serialized.length + ' bytes exceeds 1MB limit]';
              } else {
                value = result;
              }
            }
          } catch {
            try {
              value = String(result);
            } catch {
              value = '[Unserializable result]';
            }
          }
          window.dispatchEvent(new CustomEvent('${resultId}', { detail: { value } }));
        } catch (err) {
          try {
            window.dispatchEvent(new CustomEvent('${resultId}', { detail: { error: (err && err.message) ? err.message : String(err) } }));
          } catch (innerErr) {
            window.dispatchEvent(new CustomEvent('${resultId}', { detail: { error: 'Unknown error (error handler failed)' } }));
          }
        }
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();

    // Timeout fallback
    setTimeout(() => {
      window.removeEventListener(resultId, onResult);
      reject(new Error('Evaluate timed out after 30 seconds'));
    }, 30000);
  });

  return { value: result };
}

// ============================================================
// Wait for handler
// ============================================================

export function handleWaitFor(params: WaitForParams): Promise<{ matched: boolean }> {
  // Validate that at least one parameter is provided
  if (!params.text && !params.textGone && !params.time) {
    return Promise.reject(
      new Error('At least one of "text", "textGone", or "time" must be provided'),
    );
  }

  const timeoutMs = params.time ? params.time * 1000 : 30000;

  return new Promise((resolve) => {
    // If just waiting for time, use setTimeout
    if (!params.text && !params.textGone) {
      setTimeout(() => resolve({ matched: true }), timeoutMs);
      return;
    }

    const searchText = params.text || params.textGone!;
    const waitForAppear = !!params.text;

    // Check immediately
    const bodyText = document.body?.textContent || '';
    const found = bodyText.includes(searchText);
    if ((waitForAppear && found) || (!waitForAppear && !found)) {
      resolve({ matched: true });
      return;
    }

    // Set up a MutationObserver to watch for changes
    let resolved = false;
    // Debounce the observer callback to avoid excessive text checks
    // on attribute-heavy pages (at most once per 100ms)
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        observer.disconnect();
        resolve({ matched: false });
      }
    }, timeoutMs);
    const checkText = () => {
      if (resolved) return;
      const currentText = document.body?.textContent || '';
      const nowFound = currentText.includes(searchText);
      if ((waitForAppear && nowFound) || (!waitForAppear && !nowFound)) {
        resolved = true;
        clearTimeout(timeout);
        observer.disconnect();
        resolve({ matched: true });
      }
    };

    const observer = new MutationObserver(() => {
      if (resolved) return;
      if (debounceTimer !== null) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        checkText();
      }, 100);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
  });
}

// ============================================================
// Message handling
// ============================================================

/** Actions that are implemented */
export const IMPLEMENTED_ACTIONS: ReadonlySet<ActionType> = new Set([
  'snapshot',
  'click',
  'type',
  'press_key',
  'hover',
  'fill_form',
  'select_option',
  'evaluate',
  'wait_for',
]);

export function isContentRequest(message: unknown): message is ContentRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as ContentRequest).type === 'content-request' &&
    'id' in message &&
    'action' in message
  );
}

export function makeResponse(
  id: string,
  success: boolean,
  result?: unknown,
  error?: string,
): ContentResponse {
  const response: ContentResponse = {
    type: 'content-response',
    id,
    success,
  };
  if (result !== undefined) response.result = result;
  if (error !== undefined) response.error = error;
  return response;
}

/** Process a validated content request and return a response */
export async function processRequest(
  id: string,
  action: ActionType,
  params: ContentRequest['params'],
): Promise<ContentResponse> {
  try {
    if (!IMPLEMENTED_ACTIONS.has(action)) {
      return makeResponse(
        id,
        false,
        undefined,
        `Action '${action}' is not yet implemented in the content script`,
      );
    }

    let result: unknown;

    switch (action) {
      case 'snapshot':
        result = handleSnapshot();
        break;

      case 'click':
        handleClick(params as ClickParams);
        result = {};
        break;

      case 'type':
        await handleType(params as TypeParams);
        result = {};
        break;

      case 'press_key':
        handlePressKey(params as PressKeyParams);
        result = {};
        break;

      case 'hover':
        handleHover(params as HoverParams);
        result = {};
        break;

      case 'fill_form':
        result = handleFillForm(params as FillFormParams);
        break;

      case 'select_option':
        result = handleSelectOption(params as SelectOptionParams);
        break;

      case 'evaluate':
        result = handleEvaluate(params as EvaluateParams);
        break;

      case 'wait_for':
        result = await handleWaitFor(params as WaitForParams);
        break;

      default:
        return makeResponse(
          id,
          false,
          undefined,
          `Unhandled action: ${action}`,
        );
    }

    return makeResponse(id, true, result);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`Error handling ${action} [${id}]:`, err);
    return makeResponse(id, false, undefined, errMsg);
  }
}

/**
 * Handle an incoming message from the background script.
 * Returns a Promise<ContentResponse> for content requests,
 * or undefined for unrelated messages (Firefox onMessage contract).
 */
export function handleMessage(
  message: unknown,
  _sender: unknown,
): Promise<ContentResponse> | undefined {
  if (!isContentRequest(message)) return undefined;

  const { id, action, params } = message;
  log(`Received ${action} request [${id}]`);

  return processRequest(id, action, params);
}
