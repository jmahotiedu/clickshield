# ClickShield

ClickShield is a Chromium Manifest V3 extension for conventional ad and tracker blocking plus opt-in protection against click hijacking, pop-unders, and transparent overlays.

This repository is a development baseline. It is not published in a browser extension store.

## Protection modes

ClickShield stores a mode for each hostname:

- **Off**: disables ClickShield's cosmetic filtering and Strict page protections for that hostname and restores reversible overlay changes.
- **Standard**: applies packaged declarative network rules and conservative cosmetic selectors.
- **Strict**: includes Standard behavior and adds popup correlation, high-confidence pop-under closure, and reversible transparent-overlay mitigation.

More-specific subdomain settings override inherited parent-domain settings. The default for ordinary HTTP and HTTPS pages is Strict.

## Current capabilities

- packaged Manifest V3 declarative network rules
- packaged generic and site-specific cosmetic selectors
- per-site Off, Standard, and Strict controls
- batched handling of dynamically inserted page elements
- trusted primary, middle, modifier, and keyboard gesture recognition
- expiring, one-use popup authorization in the page MAIN world
- explainable popup classification with conservative safety invariants
- high-confidence known-ad tab closure with guarded focus restoration
- reversible transparent-overlay mitigation in Strict mode
- bounded local counters and redacted recent-decision diagnostics
- deterministic TypeScript build and independent `dist/` validation
- Vitest unit tests and Playwright Chromium extension tests

## Install as an unpacked extension

1. Install dependencies and build the package:

   ```bash
   npm ci
   npm run build
   npm run check:dist
   ```

2. Open `chrome://extensions` in Chrome or Chromium.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the generated `dist/` directory.
6. Confirm that the browser reports no manifest errors.

The build targets Chrome 111 or newer.

## Development

The project requires Node.js 22.16.0 or newer.

Run the complete source and package gate:

```bash
npm ci
npm run verify
```

Install Playwright's Chromium build and run the browser suite:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

See [development and testing](docs/testing.md) for every command, local fixtures, browser-test artifacts, and the clean verification matrix.

## Architecture

- Chrome's declarative network engine applies packaged static rules.
- An isolated content script manages cosmetic filtering and overlay mitigation.
- A minimal MAIN-world script tracks approved gestures and guards `window.open()`.
- A background service worker correlates popup attempts, classifies created tabs, stores bounded state, and performs high-confidence enforcement.
- The extension popup resolves the active hostname, changes its mode, displays counts, and shows redacted recent decisions.

No runtime code or filter list is downloaded from a remote server.

## Documentation

- [Permissions](docs/permissions.md)
- [Privacy and stored data](docs/privacy.md)
- [Filter sources and licensing](docs/filter-sources.md)
- [Development and testing](docs/testing.md)
- [Approved implementation plan](plans/2026-07-30-clickshield-implementation.md)

## Known limitations

- Packaged static network rules are currently enabled globally. Selecting Off restores cosmetic and overlay changes and disables Strict handling, but it does not yet add a per-domain exception to Chrome's static declarative rules.
- Production request counts are intentionally limited because the selected permissions do not expose detailed production match events.
- The starter network and cosmetic filters are small and hand-reviewed; they do not provide the coverage of mature community filter projects.
- Authentication-style destinations remain open or observe-only by design.
- Popup and overlay classification is conservative and may allow ambiguous behavior rather than risk closing a legitimate tab or removing a legitimate control.
- Automated browser coverage uses deterministic local Chromium fixtures. Broader browser-version and real-site compatibility testing is deferred.
- Firefox and Safari are not supported by the current build.

## Explicit non-goals

ClickShield does not bypass DRM, paywalls, authentication, subscriptions, account entitlements, geographic access controls, or other access restrictions. It does not modify video streams or attempt to unlock paid content.
