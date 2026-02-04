import type { PageContentResult } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const pageContentTool: ToolDefinition = {
  name: 'browser_page_content',
  description:
    'Extract the text content of the current page or a specific element. Returns plain text without HTML tags. Useful for reading long-form content like articles.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description:
          'CSS selector to extract text from a specific element. If not provided, extracts from the entire page body.',
      },
    },
  },
  action: 'page_content',

  formatResult(result: unknown) {
    if (!result || typeof result !== 'object') {
      return [
        {
          type: 'text' as const,
          text: 'Page content extraction completed (no details returned)',
        },
      ];
    }
    const r = result as PageContentResult;
    return [
      {
        type: 'text' as const,
        text: `URL: ${r.url ?? 'unknown'}\nTitle: ${r.title ?? ''}\n\n${r.text ?? ''}`,
      },
    ];
  },
};

export default pageContentTool;
