import type { GetBookmarksResult, BookmarkInfo } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const bookmarksTool: ToolDefinition = {
  name: 'browser_get_bookmarks',
  description: 'Search or list bookmarks',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Search query to filter bookmarks. If not provided, lists recent bookmarks.',
      },
    },
  },
  action: 'get_bookmarks',

  formatResult(result: unknown) {
    if (!result || typeof result !== 'object') {
      return [
        {
          type: 'text' as const,
          text: 'No bookmarks returned',
        },
      ];
    }
    const r = result as GetBookmarksResult;
    if (!r.bookmarks || r.bookmarks.length === 0) {
      return [
        {
          type: 'text' as const,
          text: 'No bookmarks found',
        },
      ];
    }
    const lines = r.bookmarks.map(
      (b: BookmarkInfo) => `- ${b.title}${b.url ? ` (${b.url})` : ''}`,
    );
    return [
      {
        type: 'text' as const,
        text: `Bookmarks (${r.bookmarks.length}):\n${lines.join('\n')}`,
      },
    ];
  },
};

export default bookmarksTool;
