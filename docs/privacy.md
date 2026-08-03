# Privacy

ClickShield has no analytics service, account system, advertising identifier, telemetry endpoint, or remote filter-update service. The extension does not send browsing data to a ClickShield-operated server.

## Stored data

### Synchronized site settings

Per-host Off, Standard, and Strict choices are stored under `sitePolicies` in `chrome.storage.sync`.

Chrome may synchronize this setting through the user's browser account when browser synchronization is enabled. ClickShield does not operate or receive that synchronized data.

### Local counters and diagnostics

`chrome.storage.local` contains:

- per-tab blocked-request and hidden-element counters
- lifetime blocked-request and hidden-element counters
- a bounded list of diagnostic category and reason records

These records use tab IDs, timestamps, categories, reasons, and counts. They are not intended to form a general browsing-history log. Tab state is removed when its tab closes, and the diagnostic list is capped.

Network counts are deliberately limited by the production permission model. ClickShield does not claim exact request-by-request production logging when Chrome does not expose that information under the selected permissions.

### Local learned deny hosts

`chrome.storage.local` may also contain `learnedDenyHosts`: hostnames added when Strict closes a known advertising tab, or when the user clicks **Block this site** in the popup. These hosts stay on-device, sync into Chrome dynamic network rules for this profile, and are never uploaded to a ClickShield server. The list is capped (500 hosts).

### Session-only popup correlation

`chrome.storage.session` contains versioned popup-correlation state for the current browser session:

- a recent source tab ID
- source and destination URLs needed for correlation
- a timestamp
- whether the attempt followed an approved or explicit new-context gesture
- whether the triggering event was synthetic
- bounded popup decisions and reasons

Unconsumed attempt records expire after 1.5 seconds. Decision records are capped at 50 entries. Session storage does not survive a new browser session.

Authorization tokens from the MAIN-world gesture tracker are never serialized into extension storage. The popup diagnostics UI displays only an origin or a redacted destination rather than the complete stored URL.

## Page access

The content scripts can inspect page structure and computed style information needed to:

- inject packaged cosmetic selectors
- estimate hidden elements
- score potential transparent click overlays
- restore elements modified by Strict mode
- publish sanitized popup-attempt evidence

ClickShield does not collect form values, keystroke contents, passwords, cookies, media contents, or page text for telemetry.

## Network behavior

The extension uses packaged declarative rules. It does not download executable code or filter lists at runtime. Normal page requests continue to be made by the browser; Chrome's declarative engine blocks matching requests locally.

## User controls

Users can:

- select Off, Standard, or Strict for a hostname
- clear recent popup decision diagnostics from the popup
- remove all extension data by uninstalling ClickShield or clearing its extension storage through the browser

## Non-goals

ClickShield does not bypass DRM, paywalls, authentication, subscriptions, access controls, or site entitlements. It is not designed to conceal user activity from the browser, network administrator, internet provider, website operator, or device owner.
