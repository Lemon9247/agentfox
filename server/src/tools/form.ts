import type { ToolDefinition } from './index.js';

export const fillFormTool: ToolDefinition = {
  name: 'browser_fill_form',
  description: 'Fill multiple form fields',
  inputSchema: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        description: 'Fields to fill in',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Human-readable field name',
            },
            type: {
              type: 'string',
              enum: ['textbox', 'checkbox', 'radio', 'combobox', 'slider'],
              description: 'Type of the field',
            },
            ref: {
              type: 'string',
              description:
                'Exact target field reference from the page snapshot',
            },
            value: {
              type: 'string',
              description:
                'Value to fill in the field. If the field is a checkbox, the value should be `true` or `false`. If the field is a combobox, the value should be the text of the option.',
            },
          },
          required: ['name', 'type', 'ref', 'value'],
        },
      },
    },
    required: ['fields'],
  },
  action: 'fill_form',

  formatResult(result: unknown) {
    if (result && typeof result === 'object' && 'filledCount' in result) {
      const r = result as { filledCount: number };
      return [
        {
          type: 'text' as const,
          text: `Filled ${r.filledCount} form field(s)`,
        },
      ];
    }
    return [{ type: 'text' as const, text: 'Form fields filled' }];
  },
};

export const selectOptionTool: ToolDefinition = {
  name: 'browser_select_option',
  description: 'Select an option in a dropdown',
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Exact target element reference from the page snapshot',
      },
      element: {
        type: 'string',
        description:
          'Human-readable element description used to obtain permission to interact with the element',
      },
      values: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Array of values to select in the dropdown. Can be single or multiple values.',
      },
    },
    required: ['ref', 'values'],
  },
  action: 'select_option',

  formatResult(result: unknown) {
    if (result && typeof result === 'object' && 'selected' in result) {
      const r = result as { selected: string[] };
      return [
        {
          type: 'text' as const,
          text: `Selected: ${r.selected.join(', ')}`,
        },
      ];
    }
    return [{ type: 'text' as const, text: 'Option selected' }];
  },
};
