// Agent Fox Firefox Extension — Content Script
// Runs in the context of web pages. Listens for messages from the
// background script and delegates to content-handlers for processing.

import { handleMessage } from './content-handlers.js';

// ============================================================
// Minimal Firefox content-script API type declarations
// ============================================================

declare namespace browser {
  namespace runtime {
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
        ) => ReturnType<typeof handleMessage>,
      ): void;
    };
  }
}

// ============================================================
// Entry point
// ============================================================

browser.runtime.onMessage.addListener(handleMessage);
