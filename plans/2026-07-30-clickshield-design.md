# ClickShield Design

**Date:** 2026-07-30  
**Status:** Proposed design, ready for implementation planning  
**Target:** Chromium browsers using Manifest V3

## Goal

Build a browser extension that combines conventional ad and tracker blocking with protection against click hijacking, pop-unders, and transparent click-capturing overlays.

The extension must improve browsing without modifying video streams, DRM, authentication, payment flows, or subscription controls.

## Product modes

### Off

Protection is disabled for the current site.

- No cosmetic filtering.
- No popup interception.
- No overlay removal.
- Site-specific network exceptions are applied where supported.

### Standard

Default mode for ordinary browsing.

- Block packaged advertising and tracking requests.
- Apply generic and site-specific cosmetic selectors.
- Hide empty ad containers after blocking.
- Count blocked requests and hidden elements.
- Permit normal links, downloads, authentication, and user-requested tabs.

### Strict

Opt-in mode for aggressive sites.

Includes Standard mode plus:

- Intercept suspicious `window.open()` calls.
- Track trusted user gestures.
- Classify newly created tabs.
- Close only high-confidence unauthorized tabs.
- Restore focus to the originating tab.
- Disable or remove high-confidence transparent overlays.

## Recommended architecture

Use a hybrid implementation:

1. Manifest V3 `declarativeNetRequest` static rulesets for broad network blocking.
2. A custom cosmetic filtering engine for visible page elements.
3. A small MAIN-world script for click and popup interception.
4. An isolated content script for DOM inspection and extension messaging.
5. A background service worker for tab correlation, settings, statistics, and rule management.

Do not implement a complete uBlock Origin or Adblock Plus filter-language engine in version 1.

## Components

### Background service worker

Responsibilities:

- Load site mode and user settings.
- Track recent user-click context.
- Correlate newly created tabs with originating tabs.
- Run the popup classifier.
- Close unauthorized tabs only at high confidence.
- Restore focus to the original tab.
- Maintain page and lifetime blocking counts.
- Manage enabled packaged rulesets and site exceptions.

### MAIN-world popup guard

Runs at `document_start`.

Responsibilities:

- Wrap `window.open()` while preserving the original function contract.
- Observe capture-phase click, pointer, aux-click, and keyboard activation events.
- Generate one-use, short-lived popup authorization tokens for legitimate actions.
- Preserve explicit middle-click, Ctrl-click, Meta-click, Shift-click, download, and approved authentication behavior.
- Publish only minimal event data through a narrow custom-event bridge.

The MAIN-world component must not contain extension secrets or durable settings because page scripts can inspect and interfere with it.

### Isolated content script

Responsibilities:

- Bridge messages between the MAIN-world script and service worker.
- Apply cosmetic selectors.
- Observe added DOM nodes.
- Score suspicious overlays.
- Disable pointer events before removing an overlay.
- Maintain per-page hidden-element counts.

### Network filtering

Version 1 uses packaged static rulesets generated during the build.

Initial categories:

- Base advertising.
- Tracking protection.
- Known redirect and popup endpoints.
- Selected tracking-parameter removal.

Dynamic rules are reserved for:

- Per-site exceptions.
- User-created rules in a later release.
- Temporary diagnostic rules.

### Cosmetic filtering

Version 1 supports:

- Generic CSS selectors.
- Domain-specific CSS selectors.
- Domain-specific exceptions.
- MutationObserver processing for dynamically inserted ads.

Deferred:

- Procedural selectors.
- Scriptlets.
- HTML filtering.
- Full third-party filter syntax compatibility.
- Anti-adblock circumvention.

## Popup classification

The classifier returns:

```ts
type PopupDecision = {
  action: "allow" | "block" | "observe";
  confidence: number;
  reasons: PopupReason[];
};
```

Candidate reasons:

- `strict-mode-disabled`
- `explicit-new-tab-gesture`
- `approved-popup-token`
- `no-recent-user-gesture`
- `synthetic-event`
- `cross-site-destination`
- `known-ad-destination`
- `unexpected-creation-timing`
- `authentication-flow`
- `download-flow`

Rules:

- Cross-origin navigation alone is never sufficient to block.
- Explicit new-tab gestures are allowed.
- Authentication and payment flows fail open unless positively identified as malicious.
- Early development runs uncertain classifications in observe-only mode.
- Every block records machine-readable reasons.

## Overlay scoring

Signals may include:

- Fixed or absolute positioning.
- Covers most of the viewport.
- High z-index.
- Near-zero opacity or transparent background.
- Pointer events enabled.
- No meaningful visible content.
- Suspicious iframe source.
- Appeared immediately before a hijacked click.

No element is removed from one signal alone. Common legitimate elements such as dialogs, cookie notices, navigation bars, captions, and video controls must be represented in negative tests.

## Storage

- `chrome.storage.sync`: user preferences and per-site modes.
- `chrome.storage.local`: counters, diagnostics, and migration state.
- `chrome.storage.session`: recent click context and short-lived popup tokens.

## Permissions

Expected initial permissions:

- `storage`
- `tabs`
- `declarativeNetRequest`
- `declarativeNetRequestWithHostAccess`
- Broad host access for cosmetic filtering and strict-mode behavior

Permissions must be documented in the README and extension UI. Avoid adding permissions that do not have a tested use.

## Repository layout

```text
clickshield/
├─ src/
│  ├─ background/
│  ├─ content/
│  ├─ main-world/
│  ├─ popup/
│  └─ shared/
├─ filters/
│  ├─ declarative/
│  └─ cosmetic/
├─ tools/
├─ tests/
│  ├─ fixtures/
│  ├─ unit/
│  └─ e2e/
├─ plans/
├─ manifest.json
├─ package.json
├─ tsconfig.json
├─ vitest.config.ts
└─ playwright.config.ts
```

## Technology choices

- TypeScript with strict compiler settings.
- Plain HTML and CSS for the extension popup.
- Vitest with a DOM-capable environment for unit tests.
- Playwright for extension-level browser tests.
- ESLint and Prettier for static quality checks.
- A small bundler suitable for multiple extension entry points.

A frontend framework is intentionally excluded from version 1.

## Testing strategy

### Unit tests

- Site-domain normalization.
- Site-mode resolution.
- Popup scoring and decision thresholds.
- Popup-token expiration and one-use behavior.
- Overlay scoring.
- Cosmetic selector selection.
- Statistics aggregation.

### Browser integration tests

Local fixtures will reproduce:

- Normal same-tab navigation.
- Explicit Ctrl-click and middle-click.
- Legitimate login popup.
- Synthetic `window.open()` call.
- First-click pop-under behavior.
- Transparent full-page overlay.
- Dynamically inserted ad container.
- Per-site Off, Standard, and Strict modes.

### Manual validation

Selected real sites may be tested only after deterministic fixture tests pass. Results must be recorded without committing site credentials, cookies, or copyrighted media.

## Security and privacy boundaries

- No browsing history is transmitted externally.
- No analytics or telemetry in version 1.
- Diagnostic logs stay local and are bounded.
- URLs stored in diagnostics should be reduced to the minimum needed for debugging.
- No remote executable code.
- No stream interception, DRM manipulation, authentication bypass, or paywall bypass.

## Version 1 success criteria

- Conventional ad and tracker requests are blocked on deterministic fixtures.
- Cosmetic ads are hidden without breaking fixture controls.
- Strict mode blocks fixture pop-unders and restores focus.
- Explicit new-tab gestures still work.
- Legitimate popup fixtures remain usable.
- Per-site mode changes take effect immediately and persist.
- Every blocked popup has an explainable decision record.
- Build, lint, type-check, unit tests, and browser tests pass from documented commands.

## Deferred work

- Firefox support.
- User filter subscriptions.
- Full filter-language compatibility.
- Remote filter updates.
- Scriptlets and anti-anti-adblock behavior.
- Cloud synchronization beyond browser settings sync.
- YouTube or other first-party video-ad manipulation.
