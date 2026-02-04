import type { ToolDefinition } from './index.js';

export const clickTool: ToolDefinition = {
  name: 'browser_click',
  description: 'Perform click on a web page',
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
      button: {
        type: 'string',
        enum: ['left', 'right', 'middle'],
        description: 'Button to click, defaults to left',
      },
      modifiers: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['Alt', 'Control', 'Meta', 'Shift'],
        },
        description: 'Modifier keys to press',
      },
      doubleClick: {
        type: 'boolean',
        description:
          'Whether to perform a double click instead of a single click',
      },
    },
    required: ['ref'],
  },
  action: 'click',

  formatResult() {
    return [{ type: 'text' as const, text: 'Clicked element' }];
  },
};

export const typeTool: ToolDefinition = {
  name: 'browser_type',
  description: 'Type text into editable element',
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Exact target element reference from the page snapshot',
      },
      text: {
        type: 'string',
        description: 'Text to type into the element',
      },
      element: {
        type: 'string',
        description:
          'Human-readable element description used to obtain permission to interact with the element',
      },
      submit: {
        type: 'boolean',
        description: 'Whether to submit entered text (press Enter after)',
      },
      slowly: {
        type: 'boolean',
        description:
          'Whether to type one character at a time. Useful for triggering key handlers in the page.',
      },
    },
    required: ['ref', 'text'],
  },
  action: 'type',

  formatResult() {
    return [{ type: 'text' as const, text: 'Typed text into element' }];
  },
};

export const pressKeyTool: ToolDefinition = {
  name: 'browser_press_key',
  description: 'Press a key on the keyboard',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          'Name of the key to press or a character to generate, such as `ArrowLeft` or `a`',
      },
    },
    required: ['key'],
  },
  action: 'press_key',

  formatResult() {
    return [{ type: 'text' as const, text: 'Key pressed' }];
  },
};

export const hoverTool: ToolDefinition = {
  name: 'browser_hover',
  description: 'Hover over element on page',
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
    },
    required: ['ref'],
  },
  action: 'hover',

  formatResult() {
    return [{ type: 'text' as const, text: 'Hovered over element' }];
  },
};
