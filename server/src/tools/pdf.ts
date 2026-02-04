import type { SavePdfResult } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const pdfTool: ToolDefinition = {
  name: 'browser_save_pdf',
  description:
    'Save the current page as a PDF file (Firefox-exclusive feature). Opens a save dialog in Firefox.',
  inputSchema: {
    type: 'object',
    properties: {
      headerLeft: {
        type: 'string',
        description: 'Text for the left header',
      },
      headerRight: {
        type: 'string',
        description: 'Text for the right header',
      },
      footerLeft: {
        type: 'string',
        description: 'Text for the left footer',
      },
      footerRight: {
        type: 'string',
        description: 'Text for the right footer',
      },
    },
  },
  action: 'save_pdf',

  formatResult(result: unknown) {
    if (!result || typeof result !== 'object') {
      return [
        {
          type: 'text' as const,
          text: 'PDF save completed (no details returned)',
        },
      ];
    }
    const r = result as SavePdfResult;
    if (r.saved) {
      return [
        {
          type: 'text' as const,
          text: `PDF saved successfully (status: ${r.status})`,
        },
      ];
    }
    return [
      {
        type: 'text' as const,
        text: `PDF not saved (status: ${r.status})`,
      },
    ];
  },
};

export default pdfTool;
