# ClickShield

ClickShield is a Manifest V3 browser extension project focused on two forms of browsing interruption:

1. Traditional advertising and tracker blocking through declarative network and cosmetic filtering.
2. Click-hijack, pop-under, and transparent-overlay protection for user-enabled sites.

## Status

Foundation implementation is in progress on `agent/project-foundation`.

The current batch includes:

- strict TypeScript project configuration
- deterministic Manifest V3 packaging
- manifest security and entry-point validation
- shared site-mode, message, and popup-decision contracts
- automated formatting, linting, type-checking, unit tests, and build verification

## Initial scope

- Chromium/Chrome Manifest V3
- TypeScript
- Packaged declarative network rules
- Basic cosmetic filtering
- Per-site Off, Standard, and Strict modes
- Explainable popup classification
- Automated unit and browser-level tests

See `plans/` for the approved architecture and implementation sequence.
