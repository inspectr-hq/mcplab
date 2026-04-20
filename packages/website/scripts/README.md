# Website Validation Scripts

This folder contains post-build scripts for link quality and sitemap checks.

## Commands

```bash
npm run check:all
npm run build:check
npm run check:links
npm run check:deadlinks
npm run check:sitemap
npm run check:sitemap:diff
```

## Scripts

- `check-trailing-slashes.mjs`: fails if internal page links miss trailing slashes.
- `check-dead-links.mjs`: fails if internal page links point to missing routes.
- `check-sitemap-status.mjs`: checks deployed sitemap + robots.txt health.
- `compare-sitemaps.mjs`: compares built sitemap URLs with a local cached baseline.

## Notes

- `check:links` and `check:deadlinks` read from `packages/website/dist`.
- `check:sitemap` targets `https://mcplab.inspectr.dev` by default.
- Override site host for sitemap scripts with `SITE_URL`, for example:

```bash
SITE_URL="https://preview.example.com" npm run check:sitemap
```
