/**
 * @vitest-environment jsdom
 */
import './setup.js';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRole,
  isInteractive,
  getAccessibleName,
  getValue,
  getElementState,
  isHidden,
  buildAccessibilityTree,
  buildNode,
  flattenGenericChildren,
  resetRefState,
  refMap,
} from '../content-handlers.js';

beforeEach(() => {
  document.body.innerHTML = '';
  resetRefState();
});

// ============================================================
// getRole
// ============================================================

describe('getRole', () => {
  it('returns explicit role attribute when present', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'alert');
    expect(getRole(el)).toBe('alert');
  });

  it('returns heading for h1-h6', () => {
    for (let i = 1; i <= 6; i++) {
      const el = document.createElement(`h${i}`);
      expect(getRole(el)).toBe('heading');
    }
  });

  it('returns link for anchor with href', () => {
    const a = document.createElement('a');
    a.setAttribute('href', '/foo');
    expect(getRole(a)).toBe('link');
  });

  it('returns generic for anchor without href', () => {
    const a = document.createElement('a');
    expect(getRole(a)).toBe('generic');
  });

  it('returns correct roles for input types', () => {
    const cases: Array<[string, string]> = [
      ['text', 'textbox'],
      ['search', 'searchbox'],
      ['email', 'textbox'],
      ['password', 'textbox'],
      ['number', 'spinbutton'],
      ['range', 'slider'],
      ['checkbox', 'checkbox'],
      ['radio', 'radio'],
      ['submit', 'button'],
      ['reset', 'button'],
      ['button', 'button'],
    ];
    for (const [inputType, expectedRole] of cases) {
      const el = document.createElement('input');
      el.type = inputType;
      expect(getRole(el)).toBe(expectedRole);
    }
  });

  it('returns textbox for textarea', () => {
    expect(getRole(document.createElement('textarea'))).toBe('textbox');
  });

  it('returns combobox for single select', () => {
    const el = document.createElement('select');
    expect(getRole(el)).toBe('combobox');
  });

  it('returns listbox for multiple select', () => {
    const el = document.createElement('select');
    el.multiple = true;
    expect(getRole(el)).toBe('listbox');
  });

  it('returns region for section with aria-label', () => {
    const el = document.createElement('section');
    el.setAttribute('aria-label', 'Main content');
    expect(getRole(el)).toBe('region');
  });

  it('returns generic for section without label', () => {
    const el = document.createElement('section');
    expect(getRole(el)).toBe('generic');
  });

  it('returns article for article element', () => {
    expect(getRole(document.createElement('article'))).toBe('article');
  });

  it('returns correct roles from TAG_ROLE_MAP', () => {
    const cases: Array<[string, string]> = [
      ['button', 'button'],
      ['nav', 'navigation'],
      ['main', 'main'],
      ['aside', 'complementary'],
      ['footer', 'contentinfo'],
      ['header', 'banner'],
      ['form', 'form'],
      ['table', 'table'],
      ['ul', 'list'],
      ['ol', 'list'],
      ['li', 'listitem'],
    ];
    for (const [tag, expectedRole] of cases) {
      expect(getRole(document.createElement(tag))).toBe(expectedRole);
    }
  });

  it('returns generic for div and span', () => {
    expect(getRole(document.createElement('div'))).toBe('generic');
    expect(getRole(document.createElement('span'))).toBe('generic');
  });
});

// ============================================================
// isInteractive
// ============================================================

describe('isInteractive', () => {
  it('returns true for standard interactive tags', () => {
    for (const tag of ['a', 'button', 'input', 'textarea', 'select']) {
      expect(isInteractive(document.createElement(tag))).toBe(true);
    }
  });

  it('returns true for elements with onclick', () => {
    const el = document.createElement('div');
    el.setAttribute('onclick', 'doSomething()');
    expect(isInteractive(el)).toBe(true);
  });

  it('returns true for contenteditable', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    expect(isInteractive(el)).toBe(true);
  });

  it('returns true for tabindex >= 0', () => {
    const el = document.createElement('div');
    el.setAttribute('tabindex', '0');
    expect(isInteractive(el)).toBe(true);
  });

  it('returns false for tabindex < 0', () => {
    const el = document.createElement('div');
    el.setAttribute('tabindex', '-1');
    expect(isInteractive(el)).toBe(false);
  });

  it('returns true for ARIA interactive roles', () => {
    for (const role of ['button', 'link', 'checkbox', 'textbox', 'tab', 'menuitem']) {
      const el = document.createElement('div');
      el.setAttribute('role', role);
      expect(isInteractive(el)).toBe(true);
    }
  });

  it('returns false for non-interactive div', () => {
    expect(isInteractive(document.createElement('div'))).toBe(false);
  });
});

// ============================================================
// getAccessibleName
// ============================================================

describe('getAccessibleName', () => {
  it('returns aria-label when present', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-label', 'Close dialog');
    el.textContent = 'X';
    expect(getAccessibleName(el)).toBe('Close dialog');
  });

  it('returns aria-labelledby text', () => {
    const label = document.createElement('span');
    label.id = 'my-label';
    label.textContent = 'Username';
    document.body.appendChild(label);

    const el = document.createElement('input');
    el.setAttribute('aria-labelledby', 'my-label');
    document.body.appendChild(el);

    expect(getAccessibleName(el)).toBe('Username');
  });

  it('returns associated label text for input with id', () => {
    const label = document.createElement('label');
    label.setAttribute('for', 'email-input');
    label.textContent = 'Email';
    document.body.appendChild(label);

    const el = document.createElement('input');
    el.id = 'email-input';
    document.body.appendChild(el);

    expect(getAccessibleName(el)).toBe('Email');
  });

  it('returns wrapping label text', () => {
    const label = document.createElement('label');
    label.textContent = 'Name ';
    const input = document.createElement('input');
    label.appendChild(input);
    document.body.appendChild(label);

    expect(getAccessibleName(input)).toBe('Name');
  });

  it('returns alt text for images', () => {
    const el = document.createElement('img');
    el.setAttribute('alt', 'A cute fox');
    expect(getAccessibleName(el)).toBe('A cute fox');
  });

  it('returns empty string for img with empty alt', () => {
    const el = document.createElement('img');
    el.setAttribute('alt', '');
    expect(getAccessibleName(el)).toBe('');
  });

  it('returns title attribute as fallback', () => {
    const el = document.createElement('div');
    el.setAttribute('title', 'Tooltip text');
    el.setAttribute('role', 'button');
    expect(getAccessibleName(el)).toBe('Tooltip text');
  });

  it('returns text content for buttons', () => {
    const el = document.createElement('button');
    el.textContent = 'Submit';
    expect(getAccessibleName(el)).toBe('Submit');
  });

  it('returns text content for links', () => {
    const el = document.createElement('a');
    el.textContent = 'Click here';
    expect(getAccessibleName(el)).toBe('Click here');
  });

  it('truncates long text content', () => {
    const el = document.createElement('button');
    el.textContent = 'A'.repeat(250);
    const name = getAccessibleName(el);
    expect(name.length).toBeLessThanOrEqual(203); // 200 + '...'
    expect(name.endsWith('...')).toBe(true);
  });

  it('returns placeholder for inputs as fallback', () => {
    const el = document.createElement('input');
    el.setAttribute('placeholder', 'Enter your name');
    document.body.appendChild(el);
    expect(getAccessibleName(el)).toBe('Enter your name');
  });

  it('returns value for submit inputs', () => {
    const el = document.createElement('input');
    el.type = 'submit';
    el.value = 'Send';
    document.body.appendChild(el);
    expect(getAccessibleName(el)).toBe('Send');
  });

  it('returns empty string when no name source exists', () => {
    const el = document.createElement('div');
    expect(getAccessibleName(el)).toBe('');
  });
});

// ============================================================
// getValue
// ============================================================

describe('getValue', () => {
  it('returns value for text input', () => {
    const el = document.createElement('input');
    el.value = 'hello';
    expect(getValue(el)).toBe('hello');
  });

  it('returns undefined for checkbox/radio', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    expect(getValue(el)).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    const el = document.createElement('input');
    expect(getValue(el)).toBeUndefined();
  });

  it('returns value for textarea', () => {
    const el = document.createElement('textarea');
    el.value = 'some text';
    expect(getValue(el)).toBe('some text');
  });

  it('returns value for select', () => {
    const el = document.createElement('select');
    const opt = document.createElement('option');
    opt.value = 'foo';
    opt.textContent = 'Foo';
    el.appendChild(opt);
    el.value = 'foo';
    expect(getValue(el)).toBe('foo');
  });

  it('returns undefined for non-form elements', () => {
    expect(getValue(document.createElement('div'))).toBeUndefined();
  });
});

// ============================================================
// getElementState
// ============================================================

describe('getElementState', () => {
  it('returns checked state for checkbox', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = true;
    expect(getElementState(el).checked).toBe(true);
  });

  it('returns checked=false for unchecked checkbox', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    expect(getElementState(el).checked).toBe(false);
  });

  it('returns disabled state', () => {
    const el = document.createElement('input');
    el.disabled = true;
    expect(getElementState(el).disabled).toBe(true);
  });

  it('returns disabled via aria-disabled', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-disabled', 'true');
    expect(getElementState(el).disabled).toBe(true);
  });

  it('returns expanded state from aria-expanded', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-expanded', 'true');
    expect(getElementState(el).expanded).toBe(true);

    el.setAttribute('aria-expanded', 'false');
    expect(getElementState(el).expanded).toBe(false);
  });

  it('returns selected state for option', () => {
    const select = document.createElement('select');
    const opt = document.createElement('option');
    opt.selected = true;
    select.appendChild(opt);
    document.body.appendChild(select);
    expect(getElementState(opt).selected).toBe(true);
  });

  it('returns required state', () => {
    const el = document.createElement('input');
    el.required = true;
    expect(getElementState(el).required).toBe(true);
  });

  it('returns required via aria-required', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-required', 'true');
    expect(getElementState(el).required).toBe(true);
  });

  it('returns description from aria-describedby', () => {
    const desc = document.createElement('span');
    desc.id = 'desc1';
    desc.textContent = 'Must be at least 8 characters';
    document.body.appendChild(desc);

    const el = document.createElement('input');
    el.setAttribute('aria-describedby', 'desc1');
    document.body.appendChild(el);

    expect(getElementState(el).description).toBe('Must be at least 8 characters');
  });

  it('returns title as description when aria-label is present', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-label', 'Close');
    el.setAttribute('title', 'Close this dialog');
    expect(getElementState(el).description).toBe('Close this dialog');
  });
});

// ============================================================
// isHidden
// ============================================================

describe('isHidden', () => {
  it('returns true for elements with hidden attribute', () => {
    const el = document.createElement('div');
    el.setAttribute('hidden', '');
    expect(isHidden(el)).toBe(true);
  });

  it('returns true for aria-hidden=true', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    expect(isHidden(el)).toBe(true);
  });

  it('returns true for inline display:none', () => {
    const el = document.createElement('div');
    el.style.display = 'none';
    expect(isHidden(el)).toBe(true);
  });

  it('returns true for inline visibility:hidden', () => {
    const el = document.createElement('div');
    el.style.visibility = 'hidden';
    expect(isHidden(el)).toBe(true);
  });

  it('returns false for visible elements', () => {
    const el = document.createElement('div');
    el.textContent = 'visible';
    document.body.appendChild(el);
    expect(isHidden(el)).toBe(false);
  });
});

// ============================================================
// flattenGenericChildren
// ============================================================

describe('flattenGenericChildren', () => {
  it('promotes children of nameless generic nodes', () => {
    const result = flattenGenericChildren([
      {
        role: 'generic',
        name: '',
        children: [
          { role: 'text', name: 'hello' },
          { role: 'text', name: 'world' },
        ],
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('hello');
    expect(result[1].name).toBe('world');
  });

  it('keeps generic nodes with a name', () => {
    const result = flattenGenericChildren([
      {
        role: 'generic',
        name: 'important',
        children: [{ role: 'text', name: 'hello' }],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('generic');
    expect(result[0].name).toBe('important');
  });

  it('keeps generic nodes with a ref', () => {
    const result = flattenGenericChildren([
      {
        role: 'generic',
        name: '',
        ref: 'e0',
        children: [{ role: 'text', name: 'hello' }],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].ref).toBe('e0');
  });

  it('recursively flattens nested generics', () => {
    const result = flattenGenericChildren([
      {
        role: 'generic',
        name: '',
        children: [
          {
            role: 'generic',
            name: '',
            children: [{ role: 'text', name: 'deep' }],
          },
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('deep');
  });

  it('handles empty children array', () => {
    expect(flattenGenericChildren([])).toHaveLength(0);
  });
});

// ============================================================
// buildAccessibilityTree
// ============================================================

describe('buildAccessibilityTree', () => {
  it('returns document node with title', () => {
    document.title = 'Test Page';
    const tree = buildAccessibilityTree();
    expect(tree.role).toBe('document');
    expect(tree.name).toBe('Test Page');
  });

  it('includes headings with level', () => {
    document.body.innerHTML = '<h1>Title</h1><h2>Subtitle</h2>';
    const tree = buildAccessibilityTree();
    const h1 = tree.children?.find((c) => c.role === 'heading' && c.level === 1);
    const h2 = tree.children?.find((c) => c.role === 'heading' && c.level === 2);
    expect(h1).toBeDefined();
    expect(h1?.name).toBe('Title');
    expect(h2).toBeDefined();
    expect(h2?.name).toBe('Subtitle');
  });

  it('assigns refs to interactive elements', () => {
    document.body.innerHTML = '<button>Click me</button><a href="/">Home</a>';
    const tree = buildAccessibilityTree();
    const button = tree.children?.find((c) => c.role === 'button');
    const link = tree.children?.find((c) => c.role === 'link');
    expect(button?.ref).toBe('e0');
    expect(link?.ref).toBe('e1');
  });

  it('populates refMap for interactive elements', () => {
    document.body.innerHTML = '<button id="btn">OK</button>';
    buildAccessibilityTree();
    expect(refMap.size).toBeGreaterThan(0);
    const el = refMap.get('e0');
    expect(el).toBeDefined();
    expect((el as HTMLElement).id).toBe('btn');
  });

  it('includes form element values', () => {
    document.body.innerHTML = '<input type="text" value="hello" />';
    const tree = buildAccessibilityTree();
    const textbox = tree.children?.find((c) => c.role === 'textbox');
    expect(textbox?.value).toBe('hello');
  });

  it('includes checkbox state', () => {
    document.body.innerHTML = '<input type="checkbox" checked />';
    const tree = buildAccessibilityTree();
    const cb = tree.children?.find((c) => c.role === 'checkbox');
    expect(cb?.checked).toBe(true);
  });

  it('skips script, style, and noscript elements', () => {
    document.body.innerHTML = `
      <script>alert("hi")</script>
      <style>.foo{}</style>
      <noscript>Enable JS</noscript>
      <p>Visible</p>
    `;
    const tree = buildAccessibilityTree();
    // Should only have the text from the paragraph
    const allNames = JSON.stringify(tree);
    expect(allNames).not.toContain('alert');
    expect(allNames).not.toContain('.foo');
    expect(allNames).toContain('Visible');
  });

  it('flattens generic div wrappers', () => {
    document.body.innerHTML = '<div><div><button>OK</button></div></div>';
    const tree = buildAccessibilityTree();
    // The divs should be flattened; button should be direct child of document
    const button = tree.children?.find((c) => c.role === 'button');
    expect(button).toBeDefined();
    expect(button?.name).toBe('OK');
  });

  it('returns empty tree for empty body', () => {
    document.body.innerHTML = '';
    const tree = buildAccessibilityTree();
    expect(tree.role).toBe('document');
    expect(tree.children).toBeUndefined();
  });

  it('handles nav with links', () => {
    document.body.innerHTML = `
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
    `;
    const tree = buildAccessibilityTree();
    const nav = tree.children?.find((c) => c.role === 'navigation');
    expect(nav).toBeDefined();
    expect(nav?.children).toHaveLength(2);
    expect(nav?.children?.[0].role).toBe('link');
  });
});

// ============================================================
// buildNode edge cases
// ============================================================

describe('buildNode', () => {
  beforeEach(() => {
    resetRefState();
  });

  it('returns null for hidden elements', () => {
    const el = document.createElement('div');
    el.setAttribute('hidden', '');
    el.textContent = 'hidden text';
    document.body.appendChild(el);
    expect(buildNode(el, 0)).toBeNull();
  });

  it('returns null for SKIP_TAGS', () => {
    const script = document.createElement('script');
    script.textContent = 'console.log("hi")';
    document.body.appendChild(script);
    expect(buildNode(script, 0)).toBeNull();
  });

  it('returns null at depth > 100', () => {
    const el = document.createElement('div');
    el.textContent = 'deep';
    document.body.appendChild(el);
    expect(buildNode(el, 101)).toBeNull();
  });
});
