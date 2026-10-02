# Prompt & Leave, ChatGPT Queue

## Keep ChatGPT moving.
**Queue prompts. Leave the tab. Come back when it is done.**

Prompt & Leave, ChatGPT Queue is a lightweight Chrome extension that adds a reliable prompt queue to ChatGPT. It runs queued prompts in strict FIFO order, tracks multiple ChatGPT tabs, shows live status directly on each tab, and alerts you when responses or entire queues finish.

It is designed for people who keep several ChatGPT conversations running at once and do not want to babysit every response.

## Features

- **Strict FIFO prompt queue** — prompts run in the same order you add them.
- **Per-chat queues** — every ChatGPT tab keeps its own independent queue.
- **Safe active-item locking** — the current queued item stays locked until its response is actually finished before the next item can run.
- **Image support** — attach, paste, or drag and drop multiple images into queued prompts.
- **Background execution** — continue working in other tabs while ChatGPT finishes.
- **Multi-tab dashboard** — the extension popup shows open ChatGPT tabs, queue counts, and live status.
- **Clear tab status** — compact symbols are added before the original chat title without replacing the title itself.
- **Completion notifications** — notifications show queue progress, how many items remain, and when the whole queue is complete.
- **Notification-to-tab routing** — click a completion notification to jump back to the correct ChatGPT tab, even when several queues are running.
- **Automatic notification cleanup** — opening the related tab clears its completed notification and unread state.
- **Custom completion sounds** — choose a sound, volume, and repeat count; gain can be increased up to 400%.
- **No separate backend** — the extension works directly with the ChatGPT web interface.
- **No OpenAI API key required** — it uses your existing ChatGPT session in the browser.

## Tab status

The extension keeps the original ChatGPT conversation title visible and adds only a small status symbol in front:

| Symbol | Meaning |
| --- | --- |
| 🔄 | ChatGPT is working |
| 📥 | Prompts are waiting in the queue |
| ✅ | Response or queue completed and has not been acknowledged yet |

The favicon also changes with queue state so busy tabs are easier to spot when many ChatGPT conversations are open.

## How the queue works

If you add:

```text
A
B
C
```

Prompt & Leave, ChatGPT Queue runs:

```text
A → wait for A to fully finish → B → wait for B → C
```

The active queued item is locked while it is running. It is removed from the queue only after the assistant response has settled, which prevents overlapping sends and out-of-order execution.

## Installation from source

1. Download or clone this repository.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder.
6. Reload any ChatGPT tabs that were already open.

The extension currently supports:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

## Usage

1. Open a ChatGPT conversation.
2. Click **Queue** in the ChatGPT header.
3. Type a prompt and optionally attach images.
4. Click **Add**.
5. Add more prompts as needed.
6. The queue runs automatically when ChatGPT is ready.

Queued items are shown in execution order. You can reorder or remove waiting items; the currently running item is locked until its response finishes.

## Notifications and sounds

Completion notifications can report both response progress and queue state, for example:

```text
Queue progress — My Chat
1 completed · 2 queues remaining · continuing.
```

When everything is done:

```text
Queue complete — My Chat
All 3 queued tasks completed · 0 remaining.
```

Clicking a notification focuses the ChatGPT tab that produced it. Visiting that tab also clears its outstanding completion notification.

Sound options are available from the extension settings, including sound style, repeat count, and adjustable gain.

> Chrome and macOS can still control whether a system notification appears as a banner or only in Notification Center. The extension can request a notification, sound, and window attention, but it cannot override operating-system notification policy.

## Privacy

Prompt & Leave, ChatGPT Queue does not use a separate application server and does not require an OpenAI API key.

Queue state and settings are stored in the browser. Image attachments are stored locally in browser storage while waiting in the queue and are then passed to the ChatGPT page when their item runs.

The extension requests only the browser permissions needed for queue state, notifications, tab management, local storage, and background audio.

## Permissions

| Permission | Why it is used |
| --- | --- |
| `storage` | Save extension settings |
| `notifications` | Show completion notifications |
| `tabs` | Track and focus ChatGPT tabs |
| `unlimitedStorage` | Keep queued image data locally when needed |
| `offscreen` | Play completion sounds reliably in the background |
| `chatgpt.com` / `chat.openai.com` | Add the queue UI and send queued prompts on ChatGPT pages |

## Limitations

Prompt & Leave, ChatGPT Queue works by integrating with the ChatGPT website, so major changes to ChatGPT's page structure can occasionally require an extension update.

Chrome may also suspend or discard background tabs under heavy memory pressure. The extension uses DOM observation plus fallback checks to improve reliability, but it cannot fully override Chrome's tab lifecycle behavior.

## Current version

**v1.9.1**

Current focus:

- strict FIFO execution
- safe response-completion detection
- stable multi-tab queue handling
- reliable notification routing
- minimal interference with normal ChatGPT typing and navigation

## Contributing

Bug reports and pull requests are welcome. When reporting a queue-order or completion-detection issue, include:

- Chrome version
- extension version
- whether the ChatGPT tab was active or in the background
- queue size
- whether the queued item included images
- the sequence of events that caused the problem

## Disclaimer

This is an independent, unofficial project and is not affiliated with, endorsed by, or sponsored by OpenAI.

ChatGPT is a trademark of OpenAI.
