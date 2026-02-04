import { describe, it, expect } from 'vitest';
import { tools, getToolByName } from '../tools/index.js';
import type { ToolDefinition } from '../tools/index.js';

// ============================================================
// Tool Registry
// ============================================================

describe('tool registry', () => {
  it('contains all expected tools', () => {
    const expectedNames = [
      'browser_navigate',
      'browser_navigate_back',
      'browser_snapshot',
      'browser_take_screenshot',
      'browser_click',
      'browser_type',
      'browser_press_key',
      'browser_hover',
      'browser_fill_form',
      'browser_select_option',
      'browser_tabs',
      'browser_close',
      'browser_resize',
      'browser_evaluate',
      'browser_wait_for',
      'browser_get_cookies',
      'browser_get_bookmarks',
      'browser_get_history',
      'browser_network_requests',
      'browser_save_pdf',
      'browser_page_content',
    ];
    const actualNames = tools.map((t) => t.name);
    for (const name of expectedNames) {
      expect(actualNames).toContain(name);
    }
  });

  it('has no duplicate tool names', () => {
    const names = tools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('looks up tools by name', () => {
    const tool = getToolByName('browser_navigate');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('browser_navigate');
    expect(tool!.action).toBe('navigate');
  });

  it('returns undefined for unknown tool name', () => {
    expect(getToolByName('nonexistent_tool')).toBeUndefined();
  });

  it('every tool has required properties', () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.action).toBeTruthy();
      expect(typeof tool.formatResult).toBe('function');
    }
  });
});

// ============================================================
// Input Schema Validation
// ============================================================

describe('input schemas', () => {
  it('all schemas have type: object', () => {
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('schemas with required fields specify them', () => {
    const toolsWithRequired: Array<[string, string[]]> = [
      ['browser_navigate', ['url']],
      ['browser_click', ['ref']],
      ['browser_type', ['ref', 'text']],
      ['browser_press_key', ['key']],
      ['browser_hover', ['ref']],
      ['browser_fill_form', ['fields']],
      ['browser_select_option', ['ref', 'values']],
      ['browser_evaluate', ['function']],
      ['browser_tabs', ['action']],
      ['browser_resize', ['width', 'height']],
    ];

    for (const [name, required] of toolsWithRequired) {
      const tool = getToolByName(name)!;
      expect(tool.inputSchema.required).toBeDefined();
      for (const field of required) {
        expect(
          (tool.inputSchema.required as string[]).includes(field),
        ).toBe(true);
      }
    }
  });

  it('tools without required params have no required field or empty required', () => {
    const optionalTools = ['browser_navigate_back', 'browser_snapshot', 'browser_close'];
    for (const name of optionalTools) {
      const tool = getToolByName(name)!;
      if (tool.inputSchema.required) {
        expect((tool.inputSchema.required as string[]).length).toBe(0);
      }
    }
  });

  it('click tool has correct modifier enum', () => {
    const tool = getToolByName('browser_click')!;
    const props = tool.inputSchema.properties as Record<string, any>;
    const modItems = props.modifiers.items;
    expect(modItems.enum).toEqual(['Alt', 'Control', 'Meta', 'Shift']);
  });

  it('tabs tool has correct action enum', () => {
    const tool = getToolByName('browser_tabs')!;
    const props = tool.inputSchema.properties as Record<string, any>;
    expect(props.action.enum).toEqual(['list', 'new', 'close', 'select']);
  });

  it('screenshot tool has correct type enum', () => {
    const tool = getToolByName('browser_take_screenshot')!;
    const props = tool.inputSchema.properties as Record<string, any>;
    expect(props.type.enum).toEqual(['png', 'jpeg']);
  });

  it('fill_form fields items have correct type enum', () => {
    const tool = getToolByName('browser_fill_form')!;
    const props = tool.inputSchema.properties as Record<string, any>;
    const fieldItems = props.fields.items.properties;
    expect(fieldItems.type.enum).toEqual([
      'textbox', 'checkbox', 'radio', 'combobox', 'slider',
    ]);
  });
});

// ============================================================
// formatResult — Navigate
// ============================================================

describe('navigate formatResult', () => {
  const tool = getToolByName('browser_navigate')!;

  it('formats valid navigation result', () => {
    const result = tool.formatResult({ url: 'https://example.com', title: 'Example' });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect((result[0] as any).text).toContain('https://example.com');
    expect((result[0] as any).text).toContain('Example');
  });

  it('handles null result', () => {
    const result = tool.formatResult(null);
    expect(result).toHaveLength(1);
    expect((result[0] as any).text).toContain('no details');
  });

  it('handles undefined result', () => {
    const result = tool.formatResult(undefined);
    expect(result).toHaveLength(1);
    expect((result[0] as any).text).toContain('no details');
  });
});

// ============================================================
// formatResult — Navigate Back
// ============================================================

describe('navigate_back formatResult', () => {
  const tool = getToolByName('browser_navigate_back')!;

  it('formats valid result', () => {
    const result = tool.formatResult({ url: 'https://prev.com', title: 'Previous' });
    expect(result).toHaveLength(1);
    expect((result[0] as any).text).toContain('https://prev.com');
  });

  it('handles null result', () => {
    const result = tool.formatResult(null);
    expect((result[0] as any).text).toContain('no details');
  });
});

// ============================================================
// formatResult — Snapshot
// ============================================================

describe('snapshot formatResult', () => {
  const tool = getToolByName('browser_snapshot')!;

  it('formats valid snapshot with tree', () => {
    const result = tool.formatResult({
      tree: { role: 'document', name: 'Test', children: [{ role: 'heading', name: 'Hello' }] },
      url: 'https://example.com',
      title: 'Test Page',
    });
    expect(result).toHaveLength(1);
    const text = (result[0] as any).text;
    expect(text).toContain('Test Page');
    expect(text).toContain('https://example.com');
    expect(text).toContain('- document "Test"');
    expect(text).toContain('  - heading "Hello"');
  });

  it('renders tree with refs and attributes', () => {
    const result = tool.formatResult({
      tree: {
        role: 'document',
        name: 'Doc',
        children: [{
          role: 'button',
          name: 'Click',
          ref: 'e0',
          disabled: true,
        }],
      },
      url: 'http://test.com',
      title: 'Doc',
    });
    const text = (result[0] as any).text;
    expect(text).toContain('ref=e0');
    expect(text).toContain('disabled=true');
  });

  it('renders tree with value and description', () => {
    const result = tool.formatResult({
      tree: {
        role: 'document',
        name: '',
        children: [{
          role: 'textbox',
          name: 'Name',
          ref: 'e0',
          value: 'John',
          required: true,
          description: 'Enter your name',
        }],
      },
      url: 'http://test.com',
      title: '',
    });
    const text = (result[0] as any).text;
    expect(text).toContain('value="John"');
    expect(text).toContain('required=true');
    expect(text).toContain('description="Enter your name"');
  });

  it('handles null result', () => {
    const result = tool.formatResult(null);
    expect((result[0] as any).text).toContain('failed');
  });

  it('handles empty tree', () => {
    const result = tool.formatResult({ tree: null, url: 'http://test.com', title: 'Test' });
    expect((result[0] as any).text).toContain('empty');
  });
});

// ============================================================
// formatResult — Screenshot
// ============================================================

describe('screenshot formatResult', () => {
  const tool = getToolByName('browser_take_screenshot')!;

  it('returns image content for valid result', () => {
    const result = tool.formatResult({ data: 'base64data', mimeType: 'image/png' });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('image');
    expect((result[0] as any).data).toBe('base64data');
    expect((result[0] as any).mimeType).toBe('image/png');
  });

  it('handles null result', () => {
    const result = tool.formatResult(null);
    expect(result[0].type).toBe('text');
    expect((result[0] as any).text).toContain('failed');
  });

  it('handles empty data', () => {
    const result = tool.formatResult({ data: '', mimeType: 'image/png' });
    expect(result[0].type).toBe('text');
    expect((result[0] as any).text).toContain('empty');
  });
});

// ============================================================
// formatResult — Click, Type, PressKey, Hover (simple confirmations)
// ============================================================

describe('interaction tool formatResults', () => {
  it('click returns confirmation text', () => {
    const tool = getToolByName('browser_click')!;
    const result = tool.formatResult({});
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect((result[0] as any).text).toBeTruthy();
  });

  it('type returns confirmation text', () => {
    const tool = getToolByName('browser_type')!;
    const result = tool.formatResult({});
    expect((result[0] as any).text).toBeTruthy();
  });

  it('press_key returns confirmation text', () => {
    const tool = getToolByName('browser_press_key')!;
    const result = tool.formatResult({});
    expect((result[0] as any).text).toBeTruthy();
  });

  it('hover returns confirmation text', () => {
    const tool = getToolByName('browser_hover')!;
    const result = tool.formatResult({});
    expect((result[0] as any).text).toBeTruthy();
  });
});

// ============================================================
// formatResult — Fill Form
// ============================================================

describe('fill_form formatResult', () => {
  const tool = getToolByName('browser_fill_form')!;

  it('formats successful fill result', () => {
    const result = tool.formatResult({ filledCount: 3 });
    expect((result[0] as any).text).toContain('3');
    expect((result[0] as any).text).toContain('form field');
  });

  it('formats result with errors', () => {
    const result = tool.formatResult({
      filledCount: 1,
      errors: ['Field "Name" (ref e0): not found', 'Field "Email" (ref e1): not a text input'],
    });
    const text = (result[0] as any).text;
    expect(text).toContain('1');
    expect(text).toContain('Errors (2)');
    expect(text).toContain('not found');
    expect(text).toContain('not a text input');
  });

  it('handles unexpected result shape', () => {
    const result = tool.formatResult('unexpected');
    expect((result[0] as any).text).toContain('Form fields filled');
  });
});

// ============================================================
// formatResult — Select Option
// ============================================================

describe('select_option formatResult', () => {
  const tool = getToolByName('browser_select_option')!;

  it('formats selected options', () => {
    const result = tool.formatResult({ selected: ['Alpha', 'Beta'] });
    expect((result[0] as any).text).toContain('Alpha');
    expect((result[0] as any).text).toContain('Beta');
  });

  it('handles unexpected result shape', () => {
    const result = tool.formatResult(null);
    expect((result[0] as any).text).toContain('Option selected');
  });
});

// ============================================================
// formatResult — Tabs
// ============================================================

describe('tabs formatResult', () => {
  const tool = getToolByName('browser_tabs')!;

  it('formats tab list', () => {
    const result = tool.formatResult({
      tabs: [
        { index: 0, title: 'Tab 1', url: 'http://a.com', active: true },
        { index: 1, title: 'Tab 2', url: 'http://b.com', active: false },
      ],
    });
    const text = (result[0] as any).text;
    expect(text).toContain('* [0] Tab 1');
    expect(text).toContain('  [1] Tab 2');
  });

  it('handles empty tab list', () => {
    const result = tool.formatResult({ tabs: [] });
    expect((result[0] as any).text).toContain('No tabs');
  });

  it('formats single tab result', () => {
    const result = tool.formatResult({ index: 2, title: 'New Tab', url: 'http://c.com' });
    expect((result[0] as any).text).toContain('[2]');
    expect((result[0] as any).text).toContain('New Tab');
  });

  it('handles null result', () => {
    const result = tool.formatResult(null);
    expect((result[0] as any).text).toContain('Tab operation completed');
  });
});

// ============================================================
// formatResult — Close, Resize
// ============================================================

describe('close formatResult', () => {
  const tool = getToolByName('browser_close')!;
  it('returns confirmation text', () => {
    const result = tool.formatResult({});
    expect((result[0] as any).text).toContain('closed');
  });
});

describe('resize formatResult', () => {
  const tool = getToolByName('browser_resize')!;
  it('returns confirmation text', () => {
    const result = tool.formatResult({});
    expect((result[0] as any).text).toContain('resized');
  });
});

// ============================================================
// formatResult — Evaluate
// ============================================================

describe('evaluate formatResult', () => {
  const tool = getToolByName('browser_evaluate')!;

  it('formats primitive value', () => {
    const result = tool.formatResult({ value: 42 });
    expect((result[0] as any).text).toBe('42');
  });

  it('formats string value', () => {
    const result = tool.formatResult({ value: 'hello' });
    expect((result[0] as any).text).toBe('"hello"');
  });

  it('formats object value', () => {
    const result = tool.formatResult({ value: { a: 1, b: 2 } });
    const text = (result[0] as any).text;
    expect(text).toContain('"a": 1');
    expect(text).toContain('"b": 2');
  });

  it('formats undefined value', () => {
    const result = tool.formatResult({ value: undefined });
    expect((result[0] as any).text).toBe('undefined');
  });

  it('formats null result object', () => {
    const result = tool.formatResult(null);
    expect((result[0] as any).text).toContain('completed');
  });
});

// ============================================================
// formatResult — Wait For
// ============================================================

describe('wait_for formatResult', () => {
  const tool = getToolByName('browser_wait_for')!;

  it('formats matched result', () => {
    const result = tool.formatResult({ matched: true });
    expect((result[0] as any).text).toContain('met');
  });

  it('formats timed out result', () => {
    const result = tool.formatResult({ matched: false });
    expect((result[0] as any).text).toContain('timed out');
  });

  it('handles null result', () => {
    const result = tool.formatResult(null);
    expect((result[0] as any).text).toContain('Wait completed');
  });
});

describe('page_content formatResult', () => {
  const tool = getToolByName('browser_page_content')!;

  it('formats valid page content result', () => {
    const result = tool.formatResult({
      text: 'Hello world',
      url: 'https://example.com',
      title: 'Example',
    });
    expect((result[0] as any).text).toContain('Hello world');
    expect((result[0] as any).text).toContain('https://example.com');
    expect((result[0] as any).text).toContain('Example');
  });

  it('handles null result', () => {
    const result = tool.formatResult(null);
    expect((result[0] as any).text).toContain('no details');
  });
});

// ============================================================
// Action mapping
// ============================================================

describe('tool action mapping', () => {
  it('every tool maps to a valid ActionType', () => {
    const validActions = new Set([
      'navigate', 'navigate_back', 'snapshot', 'screenshot',
      'click', 'type', 'press_key', 'hover',
      'fill_form', 'select_option', 'evaluate', 'wait_for',
      'tabs', 'close', 'resize',
      'get_cookies', 'get_bookmarks', 'get_history',
      'network_requests', 'save_pdf', 'page_content',
    ]);
    for (const tool of tools) {
      expect(validActions.has(tool.action)).toBe(true);
    }
  });

  it('no two tools map to the same action', () => {
    const actions = tools.map((t) => t.action);
    const unique = new Set(actions);
    expect(unique.size).toBe(actions.length);
  });
});
