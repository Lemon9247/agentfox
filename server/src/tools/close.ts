import type { ToolDefinition } from './index.js';

const closeTool: ToolDefinition = {
  name: 'browser_close',
  description: 'Close the current tab',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  action: 'close',

  formatResult() {
    return [{ type: 'text' as const, text: 'Tab closed' }];
  },
};

export default closeTool;
