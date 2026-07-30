# Permissions

ClickShield uses the permissions declared in [`manifest.json`](../manifest.json). The project deliberately avoids permissions that are not required by the current implementation.

## `storage`

ClickShield uses Chrome extension storage for three bounded categories of state:

- `chrome.storage.sync`: per-host Off, Standard, and Strict policies under `sitePolicies`.
- `chrome.storage.local`: per-tab counts, lifetime counts, and a bounded diagnostic list.
- `chrome.storage.session`: short-lived popup correlation evidence and recent popup decisions for the current browser session.

The extension does not use storage for page contents, form values, cookies, account credentials, or a general browsing-history database.

## `activeTab`

The popup inspects the currently selected tab when the user opens ClickShield. It uses the tab ID and URL to resolve the active hostname, show the current mode and counts, and filter recent diagnostics to the active page.

ClickShield does not request the broader `tabs` permission.

## `declarativeNetRequest`

This permission enables Chrome's Manifest V3 declarative network engine. ClickShield packages static block rules in the extension and asks Chrome to apply them without routing page traffic through extension JavaScript.

The background worker also enables Chrome's extension-action match count. Production code does not request `declarativeNetRequestFeedback`, because its detailed match events are not appropriate for the current production permission model.

## `<all_urls>` host access

ClickShield is intended to protect arbitrary websites rather than a fixed allowlist. Broad host access is currently required for both of these behaviors:

1. Run the isolated cosmetic and overlay content script at `document_start` on ordinary web pages.
2. Run the minimal MAIN-world popup guard early enough to observe and safely wrap page calls to `window.open()`.

The packaged declarative rules also need to match ad and tracker requests made by arbitrary pages.

Browser-internal and other unsupported schemes are treated as Off. Chrome does not inject these content scripts into protected browser pages where extension access is unavailable.

## Permissions not requested

The current manifest does not request:

- `cookies`
- `debugger`
- `downloads`
- `history`
- `identity`
- `notifications`
- `scripting`
- `tabs`
- `webRequest`
- `webRequestBlocking`

Any future permission addition should include a code-level use case, tests, and an update to this document before it is accepted.
