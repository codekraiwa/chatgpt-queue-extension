# ChatGPT Queue Extension v1

Local Chrome extension for ChatGPT.

## Features
- Queue multiple prompts per ChatGPT tab
- Multiple image attachments per queued prompt
- Drag/drop and paste images
- Queue button beside ChatGPT Share
- Completion notifications include chat name
- Clicking a notification returns to the correct tab
- Extension popup shows all open ChatGPT tabs and queue/status
- Pause / Resume / Run Next
- Done tab marker (✅)
- No OpenAI private API calls
- No server and no API cost

## Install
1. Unzip the package.
2. Open `chrome://extensions`
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the unzipped `chatgpt-queue-extension-v1` folder.
6. Reload existing ChatGPT tabs.

Recommended: Chrome → Settings → Performance → Always keep these sites active → add `chatgpt.com`.

## Note
Chrome can still freeze/discard tabs under strong memory pressure. This extension uses a targeted MutationObserver plus a 2-second fallback check, so it should behave better in background tabs than the Tampermonkey version, but it cannot override Chrome lifecycle rules.


## v1.1 UI update

- Compact grouped popup
- Sections: Current / Active & Queued / Other tabs
- Summary pills for tab count, working count, and total queue count
- Dynamic actions: only relevant buttons are shown
- Idle tabs no longer repeat "0 queued"
- Current tab shown as a badge
- Fixed Queue panel action ordering so the panel opens before the popup closes


## v1.2 header reliability
- Queue button no longer depends only on Share.
- Fallbacks: More/menu and top-right header action cluster.
- Reattaches after SPA route changes.
- Recovery check every 3 seconds.
- Prevents duplicate Queue buttons.


## v1.3
- Browser tab titles show Working / Finishing / Queue / Paused / Idle.
- Latest completion time is shown on the browser tab and popup.
- Only the most recent completion timestamp is stored per chat.


## v1.4
- Persistent browser-tab state icons: 🔄 Working, ✅ Done, 😴 Idle, 📥 Queue, ⏸ Paused.
- Done remains visible until the user returns to the tab, then becomes Idle.
- Last completion time remains stored and visible in the popup.
- Added a dedicated popup Settings screen and gear button.
- Added a title mutation guard so ChatGPT cannot immediately overwrite the extension status.


## v1.5 live tab favicon
- Browser favicon now shows live queue status directly on each Chrome tab.
- Working: animated amber spinner.
- Done: green check.
- Idle: gray Z.
- Queued: blue queue icon with count up to 9.
- Paused: red pause icon.
- No need to open the extension popup just to see status.


## v1.5.1 hotfix
- Fixes `ReferenceError: clearDone is not defined`.
- Restores tab-status settings defaults that were accidentally omitted in v1.5.
- Starts title and favicon guards on page load.
- Restores last-completed timestamp and Done state reporting to the popup.
- Forces favicon/title refresh on Working → Finishing → Done/Idle cycle changes.


## Git workflow
See `README_GIT.md`.
