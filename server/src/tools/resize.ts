import type { ToolDefinition } from './index.js';

const resizeTool: ToolDefinition = {
  name: 'browser_resize',
  description: 'Resize the browser window',
  inputSchema: {
    type: 'object',
    properties: {
      width: {
        type: 'number',
        description: 'Width of the browser window',
      },
      height: {
        type: 'number',
        description: 'Height of the browser window',
      },
    },
    required: ['width', 'height'],
  },
  action: 'resize',

  formatResult() {
    return [{ type: 'text' as const, text: 'Browser window resized' }];
  },
};

export default resizeTool;
