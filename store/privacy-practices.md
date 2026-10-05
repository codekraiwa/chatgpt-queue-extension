# Chrome Web Store Privacy Practices — Suggested Answers

Use these as the basis for the Chrome Web Store Developer Dashboard. Keep them synchronized with the extension behavior and `PRIVACY.md`.

## Single purpose
Queue and monitor user-selected work across ChatGPT conversations and notify the user when responses or queued work are complete.

## Permission justifications

### storage
Used to save user-configurable extension settings such as notification, sound, volume, repeat count, and attention preferences. No advertising or profiling use.

### notifications
Used to display completion notifications when a ChatGPT response or queued workflow finishes, including routing the user back to the relevant ChatGPT tab.

### offscreen
Used only for background audio playback so completion sounds can play while the ChatGPT tab is not active.

### Host permission: https://chatgpt.com/*
Required for the extension's single purpose. The content script adds the queue UI to ChatGPT, inserts user-queued prompts/attachments into the ChatGPT composer, observes whether ChatGPT is generating a response, and reports local status for the multi-tab dashboard.

## Remote code
No. The extension does not download or execute remote JavaScript or WebAssembly. All executable extension code is packaged with the extension.

## Data categories to disclose
Based on current source behavior, disclose the categories that correspond in the dashboard to:
- Website content / user-generated content: queued prompts, explicitly queued images, and limited ChatGPT response text inspected locally for completion detection.
- Web browsing activity: ChatGPT tab URL/title is used only to identify and route among matching ChatGPT tabs.

Do **not** claim that the extension handles no user data merely because processing is local. Chrome policy treats locally handled sensitive/user data as data handling for privacy-policy purposes.

## Collection / sharing statement
The extension does not transmit these data categories to the developer or a developer-owned server. Data is used locally only to provide the queue, monitoring, attachment, and completion-notification features.

## Selling data
No.

## Using data for advertising
No.

## Using data for creditworthiness or lending
No.

## Allowing humans to read user data
No developer-side human access is provided because the extension does not transmit the user's queue or ChatGPT content to a developer backend.

## Limited Use certification
Certify only while the extension behavior continues to match the statements above.
