# ClickShield Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a tested Manifest V3 Chromium extension that provides conventional ad/tracker blocking and opt-in protection against click hijacking, pop-unders, and transparent overlays.

**Architecture:** Package declarative network rules at build time, run cosmetic and overlay filtering in an isolated content script, run a minimal popup guard in the page MAIN world, and coordinate tab classification and settings through a background service worker. All new behavior follows test-first development.

**Tech Stack:** TypeScript, Manifest V3, Vitest, Playwright, ESLint, Prettier, npm, plain HTML/CSS.

---

## Execution rules

- Work on a dedicated feature branch or worktree.
- Complete tasks in order unless a documented dependency requires otherwise.
- For every behavioral function: write a failing test, run it and inspect the expected failure, implement the minimum behavior, then rerun the focused and full relevant suites.
- Keep commits narrow and reviewable.
- Do not add remote executable code, telemetry, stream manipulation, DRM handling, or paywall bypasses.
- Do not claim completion without fresh build, lint, type-check, unit-test, and browser-test evidence.

### Task 1: Initialize the TypeScript extension workspace

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `src/shared/.gitkeep`
- Create: `tests/unit/project-smoke.test.ts`
- Create: `vitest.config.ts`

**Steps:**

1. Add the initial smoke test that imports a constant from `src/shared/project.ts` and expects the extension name to equal `ClickShield`.
2. Run the focused test and verify it fails because `src/shared/project.ts` does not exist.
3. Add strict TypeScript configuration and the minimal `project.ts` export.
4. Add scripts: `build`, `typecheck`, `lint`, `format:check`, `test`, `test:unit`, and `test:e2e`.
5. Run unit tests, type-check, and lint.
6. Commit: `chore: initialize TypeScript extension workspace`.

### Task 2: Add deterministic build output and manifest validation

**Files:**
- Create: `manifest.json`
- Create: `tools/build-extension.ts`
- Create: `tools/validate-manifest.ts`
- Create: `tests/unit/manifest-validation.test.ts`
- Create: `src/background/service-worker.ts`
- Create: `src/content/content-script.ts`
- Create: `src/main-world/popup-guard.ts`
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.ts`
- Create: `src/popup/popup.css`

**Steps:**

1. Write failing tests for required Manifest V3 fields, expected entry points, and prohibited remote script URLs.
2. Run the manifest test and verify the expected failure.
3. Add a minimal valid manifest with only permissions already justified by the design.
4. Add a deterministic build script that emits `dist/` with bundled scripts, popup assets, and copied manifest.
5. Run `npm run build` and validate that all manifest-referenced files exist.
6. Add `dist/` to `.gitignore`.
7. Commit: `build: add deterministic extension packaging`.

### Task 3: Define shared message and decision contracts

**Files:**
- Create: `src/shared/messages.ts`
- Create: `src/shared/decisions.ts`
- Create: `src/shared/settings.ts`
- Create: `src/shared/types.ts`
- Create: `tests/unit/shared-contracts.test.ts`

**Steps:**

1. Write failing tests for exhaustive message validation and popup decision reason values.
2. Define `SiteMode = "off" | "standard" | "strict"`.
3. Define typed messages for click context, popup attempts, blocked actions, settings requests, and statistics updates.
4. Define `PopupDecision` with `allow`, `block`, and `observe` outcomes, confidence, and reasons.
5. Add runtime type guards for messages that cross extension boundaries.
6. Run tests and type-check.
7. Commit: `feat: define extension message contracts`.

### Task 4: Implement hostname normalization and site policy resolution

**Files:**
- Create: `src/background/site-policy-store.ts`
- Create: `tests/unit/site-policy-store.test.ts`

**Required cases:**

- Exact hostname mode.
- Parent-domain inheritance.
- More-specific subdomain override.
- Default Standard mode.
- Invalid URLs fail safely.
- Browser-internal pages return Off.
- IP addresses are treated as exact hosts.

**Steps:**

1. Write one failing test per behavior.
2. Implement pure domain normalization and policy resolution first.
3. Add a storage adapter using `chrome.storage.sync` behind an injectable interface.
4. Test the adapter with an in-memory implementation rather than mocking internal helper behavior.
5. Run focused and full unit suites.
6. Commit: `feat: add per-site protection policies`.

### Task 5: Build the extension popup and per-site mode control

**Files:**
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.ts`
- Modify: `src/popup/popup.css`
- Create: `src/popup/view-model.ts`
- Create: `tests/unit/popup-view-model.test.ts`

**Behavior:**

- Display current hostname.
- Show Off, Standard, and Strict choices.
- Persist changes immediately.
- Display page blocked-request and hidden-element counts.
- Explain Strict mode in one sentence.
- Disable controls on unsupported browser pages.

**Steps:**

1. Test the pure popup view model before wiring DOM code.
2. Implement the smallest accessible popup with native controls.
3. Add keyboard navigation and visible focus states.
4. Manually load the popup fixture and confirm mode changes persist.
5. Commit: `feat: add per-site protection controls`.

### Task 6: Add packaged declarative network rules

**Files:**
- Create: `filters/declarative/base.json`
- Create: `filters/declarative/tracking.json`
- Create: `filters/metadata.json`
- Create: `tools/validate-rulesets.ts`
- Create: `tests/unit/ruleset-validation.test.ts`
- Modify: `manifest.json`
- Modify: `tools/build-extension.ts`

**Behavior:**

- Package a deliberately small initial rule set.
- Ensure rule IDs are unique across files.
- Reject unsupported actions and malformed conditions during build.
- Record source, license, version, and generated date in metadata.
- Do not silently fetch rules at extension runtime.

**Steps:**

1. Write failing tests for duplicate IDs, invalid resource types, and missing metadata.
2. Add a small hand-reviewed rule fixture sufficient for deterministic tests.
3. Wire static rulesets into the manifest.
4. Add build-time validation and quota reporting.
5. Verify the unpacked build contains the expected rulesets.
6. Commit: `feat: add packaged network filtering rules`.

### Task 7: Implement network-block statistics

**Files:**
- Create: `src/background/statistics-store.ts`
- Modify: `src/background/service-worker.ts`
- Create: `tests/unit/statistics-store.test.ts`

**Behavior:**

- Track per-tab and lifetime counts.
- Reset tab counts when navigation starts.
- Bound retained diagnostic records.
- Never store full browsing history.
- Update the toolbar badge with the current tab count.

**Steps:**

1. Test pure aggregation and reset behavior.
2. Add a storage adapter for lifetime counters.
3. Wire supported declarative-network debug events only in development builds if needed; production counts must use APIs available under the selected permissions and store policy.
4. If exact per-request counts cannot be obtained without an unacceptable permission, document and implement an honest approximate or feature-limited counter rather than fabricating precision.
5. Commit: `feat: add bounded blocking statistics`.

### Task 8: Implement the cosmetic selector engine

**Files:**
- Create: `filters/cosmetic/generic.json`
- Create: `filters/cosmetic/site-specific.json`
- Create: `src/content/cosmetic-engine.ts`
- Create: `tests/unit/cosmetic-engine.test.ts`
- Create: `tests/fixtures/cosmetic-ads.html`

**Required cases:**

- Generic selector applies in Standard and Strict modes.
- Domain-specific selector applies only to matching domains.
- Exception suppresses a generic selector.
- Off mode applies nothing.
- Invalid selectors are rejected at build time.
- Legitimate fixture controls remain visible.

**Steps:**

1. Test selector resolution as a pure function.
2. Test CSS injection generation.
3. Add a conservative starter selector set.
4. Inject one style element per page rather than repeatedly editing individual nodes.
5. Track hidden-element estimates separately from network counts.
6. Commit: `feat: add basic cosmetic filtering`.

### Task 9: Handle dynamically inserted cosmetic ads

**Files:**
- Create: `src/content/mutation-observer.ts`
- Modify: `src/content/content-script.ts`
- Create: `tests/unit/mutation-observer.test.ts`

**Behavior:**

- Batch mutation processing.
- Avoid rescanning the entire document per mutation.
- Ignore extension-owned elements.
- Disconnect cleanly when mode changes to Off.
- Reconnect when protection is enabled.

**Steps:**

1. Use fake timers to test batching.
2. Verify multiple mutations result in one processing pass.
3. Implement bounded node collection and scheduling.
4. Add a regression test for observer recursion caused by extension style changes.
5. Commit: `feat: process dynamically inserted ads`.

### Task 10: Implement trusted user-gesture tracking

**Files:**
- Create: `src/main-world/trusted-click-tracker.ts`
- Create: `src/main-world/popup-token-store.ts`
- Create: `tests/unit/trusted-click-tracker.test.ts`
- Create: `tests/fixtures/legitimate-links.html`

**Required cases:**

- Trusted primary click.
- Middle-click.
- Ctrl-click and Meta-click.
- Shift-click.
- Keyboard activation.
- Synthetic event.
- Token expiration.
- Token is consumed once.
- A new click supersedes stale context.

**Steps:**

1. Model event data as plain records so classification can be tested without a browser.
2. Write failing tests for gesture interpretation and token lifecycle.
3. Implement the minimum token store using monotonic timestamps supplied by an injected clock.
4. Add capture-phase event listeners only after pure behavior passes.
5. Commit: `feat: track trusted popup gestures`.

### Task 11: Wrap `window.open()` safely

**Files:**
- Modify: `src/main-world/popup-guard.ts`
- Create: `src/main-world/event-bridge.ts`
- Create: `tests/unit/popup-guard.test.ts`
- Create: `tests/fixtures/window-open.html`

**Behavior:**

- Preserve allowed `window.open()` arguments and return behavior.
- Return `null` for blocked attempts.
- Do not block outside Strict mode.
- Publish a sanitized attempt record.
- Avoid exposing extension-only data to the page.
- Fail open if the guard encounters an internal error.

**Steps:**

1. Test against an injected original-open function.
2. Verify blocked and allowed paths.
3. Verify exceptions do not break page execution.
4. Wire the narrow custom-event bridge.
5. Commit: `feat: guard unauthorized window opens`.

### Task 12: Implement the popup classifier

**Files:**
- Create: `src/background/popup-classifier.ts`
- Create: `tests/unit/popup-classifier.test.ts`

**Required cases:**

- Strict mode disabled: allow.
- Explicit new-tab gesture: allow.
- Valid popup token: allow.
- Authentication flow: allow or observe.
- No user gesture plus known ad destination: block.
- Cross-site destination alone: observe, never block.
- Suspicious timing plus no gesture: observe until another strong signal exists.
- Synthetic event plus known ad destination: block.
- Missing evidence: observe.

**Steps:**

1. Express scoring weights and hard overrides in test data.
2. Test reasons as well as final actions.
3. Keep thresholds centralized and named.
4. Add property-style invariants: explicit approved gesture never blocks; cross-origin alone never blocks.
5. Commit: `feat: classify suspicious popup tabs`.

### Task 13: Implement the background tab guardian

**Files:**
- Create: `src/background/tab-guardian.ts`
- Modify: `src/background/service-worker.ts`
- Create: `tests/unit/tab-guardian.test.ts`

**Behavior:**

- Correlate a newly created tab with an originating tab and recent click context.
- Invoke the classifier.
- Run observe-only by default in development.
- Close only `block` decisions above the configured threshold.
- Restore focus to the originating tab after successful closure.
- Do not repeatedly focus-steal if the user manually selected another tab.
- Record a bounded decision log.

**Steps:**

1. Test the guardian against injected tab and window adapters.
2. Verify no tab mutation occurs for allow or observe outcomes.
3. Verify close-then-focus order.
4. Verify failed tab closure does not falsely increment blocked counts.
5. Commit: `feat: add explainable tab guardian`.

### Task 14: Persist transient correlation state safely

**Files:**
- Create: `src/background/session-state.ts`
- Modify: `src/background/tab-guardian.ts`
- Create: `tests/unit/session-state.test.ts`

**Behavior:**

- Store transient context in session storage.
- Recover after service-worker suspension.
- Expire stale click records.
- Clear state when tabs close.
- Never persist authorization tokens beyond the browser session.

**Steps:**

1. Test serialization, expiration, and cleanup.
2. Add migration/version handling for stored records.
3. Simulate service-worker restart by constructing a new store over the same in-memory session adapter.
4. Commit: `feat: preserve popup correlation across worker suspension`.

### Task 15: Implement conservative overlay scoring

**Files:**
- Create: `src/content/overlay-detector.ts`
- Create: `tests/unit/overlay-detector.test.ts`
- Create: `tests/fixtures/transparent-overlay.html`
- Create: `tests/fixtures/legitimate-dialogs.html`

**Signals:**

- Fixed or absolute position.
- Large viewport coverage.
- High z-index.
- Near-zero opacity or transparent background.
- Pointer events enabled.
- No meaningful content.
- Suspicious iframe source.
- Temporal relation to a blocked popup attempt.

**Steps:**

1. Write positive tests for synthetic overlay fixtures.
2. Write negative tests for dialogs, cookie notices, subtitles, menus, and video controls.
3. Implement scoring as a pure function over a normalized element snapshot.
4. Require multiple independent signals for a destructive action.
5. Commit: `feat: score transparent click overlays`.

### Task 16: Add reversible overlay mitigation

**Files:**
- Create: `src/content/overlay-mitigator.ts`
- Modify: `src/content/content-script.ts`
- Create: `tests/unit/overlay-mitigator.test.ts`

**Behavior:**

- First set `pointer-events: none` and mark the element.
- Remove only when confidence exceeds the higher removal threshold.
- Preserve original inline values for possible restoration.
- Restore mitigated elements when the site switches to Off.
- Never modify elements outside Strict mode.

**Steps:**

1. Test reversible style changes.
2. Test idempotence.
3. Test mode transition cleanup.
4. Integrate with batched mutation processing.
5. Commit: `feat: mitigate high-confidence overlays`.

### Task 17: Add decision diagnostics UI

**Files:**
- Create: `src/popup/diagnostics.ts`
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.ts`
- Create: `tests/unit/diagnostics-view-model.test.ts`

**Behavior:**

- Show recent blocked or observed popup decisions for the current site.
- Display plain-language reasons.
- Bound the number of entries.
- Provide a clear-local-diagnostics action.
- Do not display full sensitive URLs; show origin or redacted destination.

**Steps:**

1. Test redaction and reason formatting.
2. Add a collapsed diagnostics section.
3. Verify clearing diagnostics does not reset user settings.
4. Commit: `feat: expose popup decision reasons`.

### Task 18: Add Playwright extension fixtures

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/fixtures/extension-context.ts`
- Create: `tests/e2e/site-toggle.spec.ts`
- Create: `tests/e2e/network-blocking.spec.ts`
- Create: `tests/e2e/popup-protection.spec.ts`
- Create: `tests/e2e/overlay-protection.spec.ts`
- Create: `tests/fixtures/server.ts`

**Scenarios:**

- Build and load the unpacked extension.
- Standard mode blocks a deterministic ad request.
- Standard mode hides a cosmetic fixture.
- Off mode restores normal fixture behavior.
- Ctrl-click and middle-click open legitimate tabs.
- Strict mode closes a fixture pop-under and restores focus.
- Legitimate authentication-style popup remains open.
- Strict mode neutralizes a transparent overlay.
- Settings survive extension reload.
- Transient popup tokens do not survive a new browser session.

**Steps:**

1. Add one failing scenario at a time.
2. Serve fixtures from local origins so tests require no third-party site.
3. Capture trace and screenshot only on failure.
4. Keep all generated artifacts under `output/playwright/` and ignore them in Git.
5. Commit: `test: add extension browser coverage`.

### Task 19: Add CI and artifact validation

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `tools/check-dist.ts`
- Create: `tests/unit/dist-validation.test.ts`

**CI jobs:**

- Install from lockfile.
- Format check.
- Lint.
- Type-check.
- Unit tests.
- Production build.
- Validate `dist/` contents and manifest references.
- Run Playwright extension tests.
- Upload failure traces only when tests fail.

**Steps:**

1. Add a failing dist-validation test for a missing manifest target.
2. Implement the artifact checker.
3. Add CI with pinned major action versions.
4. Verify the workflow on a branch push.
5. Commit: `ci: verify extension build and browser tests`.

### Task 20: Document permissions, privacy, development, and limitations

**Files:**
- Modify: `README.md`
- Create: `docs/permissions.md`
- Create: `docs/privacy.md`
- Create: `docs/filter-sources.md`
- Create: `docs/testing.md`

**Required documentation:**

- What each permission enables.
- Why broad host access is needed.
- What data remains local.
- How packaged filter data is sourced and licensed.
- How to install the unpacked extension.
- How to run each verification command.
- Known limitations and deferred features.
- Clear statement that ClickShield does not bypass DRM, paywalls, authentication, or subscriptions.

**Steps:**

1. Write documentation against the actual implementation, not intended behavior.
2. Verify every documented command from a clean checkout.
3. Verify all links and file paths.
4. Commit: `docs: add development and privacy documentation`.

### Task 21: Run the final verification matrix

**Commands:**

```powershell
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
```

**Additional checks:**

1. Load `dist/` manually as an unpacked extension.
2. Confirm no manifest warnings.
3. Test Off, Standard, and Strict modes on local fixtures.
4. Confirm explicit new-tab gestures work.
5. Confirm blocked decisions include reasons.
6. Confirm diagnostics contain no unredacted sensitive URLs.
7. Confirm no remote executable code is referenced.
8. Review the final diff against both plan documents.
9. Commit only after all evidence is fresh.

**Final commit:** `chore: prepare ClickShield v1 development baseline`.

## Implementation handoff

Recommended execution mode: subagent-driven development in the implementation session, one task at a time, with a review checkpoint after every commit-sized task.

The first implementation session should stop after Tasks 1 through 5 for an architecture and developer-experience review before network rules or aggressive page behavior are added.
