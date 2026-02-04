import type { GetHistoryResult, HistoryItem } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const historyTool: ToolDefinition = {
  name: 'browser_get_history',
  description: 'Search browsing history',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search text to filter history items',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (default 50)',
      },
      startTime: {
        type: 'string',
        description: 'ISO date string for start of time range',
      },
      endTime: {
        type: 'string',
        description: 'ISO date string for end of time range',
      },
    },
  },
  action: 'get_history',

  formatResult(result: unknown) {
    if (!result || typeof result !== 'object') {
      return [
        {
          type: 'text' as const,
          text: 'No history results returned',
        },
      ];
    }
    const r = result as GetHistoryResult;
    if (!r.items || r.items.length === 0) {
      return [
        {
          type: 'text' as const,
          text: 'No history items found',
        },
      ];
    }
    const lines = r.items.map((item: HistoryItem) => {
      const lastVisit = item.lastVisitTime
        ? new Date(item.lastVisitTime).toISOString()
        : 'unknown';
      return `- ${item.title || '(no title)'}\n  URL: ${item.url}\n  Visits: ${item.visitCount} | Last visit: ${lastVisit}`;
    });
    return [
      {
        type: 'text' as const,
        text: `History items (${r.items.length}):\n${lines.join('\n')}`,
      },
    ];
  },
};

export default historyTool;
