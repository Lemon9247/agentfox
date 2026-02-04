import type { ScreenshotResult } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const screenshotTool: ToolDefinition = {
  name: 'browser_take_screenshot',
  description: 'Take a screenshot of the current page',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: 'Image format for the screenshot. Default is png.',
      },
    },
  },
  action: 'screenshot',

  formatResult(result: unknown) {
    if (!result || typeof result !== 'object') {
      return [
        {
          type: 'text' as const,
          text: 'Screenshot failed (no data returned)',
        },
      ];
    }
    const r = result as ScreenshotResult;
    if (!r.data) {
      return [
        {
          type: 'text' as const,
          text: 'Screenshot failed (empty image data)',
        },
      ];
    }
    return [
      {
        type: 'image' as const,
        data: r.data,
        mimeType: r.mimeType ?? 'image/png',
      },
    ];
  },
};

export default screenshotTool;
