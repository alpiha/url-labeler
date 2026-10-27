# URL Labeler

Chrome extension that labels tabs whose URL contains a string or matches a regex.

Each label has:

- **Match**: URL contains a string, or matches a regex. Labels are checked from top to bottom, and the first match wins.
- **Text**: a list of text checks, checked from top to bottom (e.g. contains `/admin` → `ADM`, contains `/docs` → `DOC`). If a check's text is empty, the matched text is shown (for a regex, its first capture group). If no check matches, the **default text** is used.
- **Look**: shape (square, round, arrow) and color, plus where to show the label.

So one blue "Production" label matching `prod.` can show `ADM` on admin pages, `DOC` on docs pages and `PROD` everywhere else.

Places to show the label:

- **Tab title**: `[PROD] Page title`, `(PROD) …`, `‹PROD› …`
- **Tab icon**: replaces the favicon with the shape plus 1–2 characters
- **Toolbar badge**: the extension icon becomes the shape, with up to 4 characters in the badge
- **In-page label**: a small label pinned to a corner of the page (fades out when you hover over it)

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select this folder

## Settings

Rules are saved with `chrome.storage.local`. Chrome keeps that inside your profile folder
(`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Local Extension Settings\<extension id>\`) as a LevelDB database, not a readable JSON file.
Use **Export / Import** on the options page to back up or move your rules as JSON. Exports from version 1 (with `rules`) can still be imported.

## Limitations

- Chrome doesn't run extensions on `chrome://` pages, the New Tab page or the Chrome Web Store. Only the toolbar badge works there.
- Chrome extensions can't draw inside the address bar. The toolbar badge is the closest substitute.
