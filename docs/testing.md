# Development and testing

## Prerequisites

- Node.js 22.16.0 or newer
- npm
- A Chromium-based browser for manual unpacked-extension checks

Install the exact dependency graph from the lockfile:

```bash
npm ci
```

Install the Playwright Chromium build used by CI:

```bash
npx playwright install --with-deps chromium
```

On Windows, the `--with-deps` operating-system package step is generally unnecessary:

```powershell
npx playwright install chromium
```

## Commands

### Formatting

```bash
npm run format:check
```

Checks repository files with the pinned Prettier version. It does not rewrite files.

### Linting

```bash
npm run lint
```

Runs ESLint across the TypeScript and JavaScript project files.

### Type checking

```bash
npm run typecheck
```

Runs strict TypeScript checking without emitting files.

### Unit tests

```bash
npm run test:unit
```

Runs the Vitest unit suite, including manifest, rule, storage, popup-classification, overlay, and packaged-artifact validation.

### Production build

```bash
npm run build
```

Removes and recreates `dist/`, bundles the background, isolated-world, MAIN-world, and popup scripts, copies static assets and filters, and validates the packaged manifest.

### Packaged-artifact validation

```bash
npm run check:dist
```

Checks an existing `dist/` directory independently of the build process. The checker validates manifest references, popup asset references, packaged JSON, required support files, path containment, and the absence of TypeScript and source-map artifacts.

### Source and package verification

```bash
npm run verify
```

Runs formatting, linting, type checking, unit tests, the production build, and packaged-artifact validation.

### Browser tests

```bash
npm run test:e2e
```

Builds and validates the extension, then launches Playwright's bundled Chromium with `dist/` loaded as an unpacked extension.

The browser suite uses local deterministic fixture hosts under `*.clickshield.test`. Chromium maps those hosts to the local fixture server. No third-party website is required.

Current browser scenarios cover:

- packaged declarative network blocking
- Standard and Off cosmetic behavior
- Ctrl-click and middle-click preservation
- Strict known-ad pop-under closure
- opener focus restoration
- authentication-style popup preservation
- transparent-overlay mitigation and restoration

## Clean verification matrix

From a clean checkout:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run check:dist
npm run test:e2e
```

## Browser-test output

Playwright writes generated output under `output/playwright/`. The directory is ignored by Git.

The configuration retains traces and screenshots only for failed tests. GitHub Actions uploads `output/playwright/` only when the workflow fails, ignores an absent output directory, and retains uploaded failure artifacts for seven days.

## Manual unpacked-extension check

1. Run `npm run build` and `npm run check:dist`.
2. Open `chrome://extensions` in Chrome or Chromium.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository's `dist/` directory.
6. Confirm that Chrome reports no manifest errors.
7. Open a normal HTTP or HTTPS page and verify the popup shows the hostname and site modes.

Manual checks should use controlled local fixtures when testing popup or overlay behavior. Do not rely on an unrelated third-party site's current implementation as the only release evidence.
