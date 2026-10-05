# Chrome Web Store Permission Audit

**Audit date:** October 5, 2026  
**Target release:** 1.9.5

## Result

The production manifest was reduced to the narrowest permissions needed for current features.

| Permission / host | Decision | Reason |
|---|---|---|
| `storage` | KEEP | Stores global notification and sound preferences with Chrome storage/sync. |
| `notifications` | KEEP | Required for completion notifications. |
| `offscreen` | KEEP | Required to play completion audio from an MV3 background context. |
| `https://chatgpt.com/*` | KEEP | Core functionality injects the queue UI into ChatGPT, observes generation state, runs queued prompts, and reads matching ChatGPT tab metadata. |
| `tabs` | REMOVE | Redundant. Chrome host permission already allows access to sensitive tab properties for matching ChatGPT tabs, while normal tab activation/query operations do not require the broad `tabs` permission. Removing it avoids the broader browsing-history permission warning. |
| `unlimitedStorage` | REMOVE | Not required by current extension-owned storage usage. Queue text and queued image handling occurs through page-local storage/IndexedDB, while extension Chrome storage is limited to small settings data. |
| `https://chat.openai.com/*` | REMOVE | Legacy ChatGPT host is no longer required for the current product target; the extension is scoped to `chatgpt.com`. |

## Remote-code / network audit

Searched production JavaScript and HTML for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `eval`, and `new Function`.

**Result:** no developer backend, analytics endpoint, ad network, remote script loader, or remote-code execution was found in the production source reviewed for this release.

## User-data handling observed in source

- Queue text and queue state are stored locally.
- Queued image attachments are stored locally in IndexedDB until used/removed.
- ChatGPT page state and limited assistant-message text signatures are inspected locally to determine when generation is complete.
- Global notification/sound preferences are stored in `chrome.storage.sync`.
- ChatGPT tab title/URL/state are used locally for the popup dashboard and notification routing.
- No reviewed code transmits those items to a developer-controlled service.

## Store review note

Because the extension handles user-generated prompt text, image attachments, website content, and ChatGPT tab metadata locally, it should still publish an accurate privacy policy and complete the Chrome Web Store Privacy practices disclosures even though there is no developer backend.
