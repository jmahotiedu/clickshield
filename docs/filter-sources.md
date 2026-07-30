# Filter sources

ClickShield currently ships a small, deterministic starter filter set. The extension does not fetch filter updates at runtime.

## Declarative network rules

The packaged network rules are stored in:

- [`filters/declarative/base.json`](../filters/declarative/base.json)
- [`filters/declarative/tracking.json`](../filters/declarative/tracking.json)

The current package contains 15 declarative rules. They cover a deliberately limited set of common advertising and tracking endpoints plus the deterministic local endpoint used by browser tests.

Rule metadata is recorded in [`filters/metadata.json`](../filters/metadata.json):

- source: `ClickShield hand-reviewed starter rules`
- license: `CC0-1.0`
- version: `2026.07.30`
- generated date: `2026-07-30`

The build rejects duplicate rule IDs, unsupported actions, unsupported resource types, malformed URL filters, missing metadata, and rule-resource paths that are not packaged locally.

## Cosmetic selectors

The packaged cosmetic configuration is stored in:

- [`filters/cosmetic/generic.json`](../filters/cosmetic/generic.json)
- [`filters/cosmetic/site-specific.json`](../filters/cosmetic/site-specific.json)

The current package contains seven generic selectors and no broad imported third-party cosmetic list. Selectors are validated during the build before they are copied into `dist/`.

## Update process

Filter changes are source changes and should be reviewed like code:

1. Modify the relevant JSON source file.
2. Update [`filters/metadata.json`](../filters/metadata.json) when the network-rule source, license, version, or generated date changes.
3. Add or update deterministic tests.
4. Run `npm run verify`.
5. Run `npm run test:e2e`.
6. Inspect the resulting `dist/filters/` directory.

A future imported list must preserve its original source and license information. It must also be transformed and packaged at build time rather than downloaded or executed by the installed extension.

## Scope

The starter set is not intended to match the coverage of mature community filter projects. False-positive control, transparent behavior, and reproducible packaging are prioritized over rule volume in this development baseline.
