# Experiment Results Portal

Static, source-backed result portal for optimizer experiment comparisons.

## Current Scope

- Evidence Bento interface: research-oriented Bento workspace with protocol-deck navigation
- Suite-local optimizer benchmarks with explicit model, dataset, batch, and budget boundaries
- Protocol switching never combines incompatible suites into one chart or leaderboard
- Views: suite cards, suite leaderboard, selectable validation-loss curves, run detail, claim cards
- Ranking: suite-specific `leaderboard_rule.sort_by`
- Data source: curated static JSON snapshot in `data/portal-data.json`
- Direct-file mirror: generated `data/portal-data.js`
- Fast browser delivery: lightweight `data/portal-catalog.*` plus `data/suites/<suite_id>.*`
- Shared chart contract: `figure-runtime.js`
- Self-hosted Mona Sans and IBM Plex Mono WOFF2 assets with their OFL license files

This published snapshot is a presentation portal, not a live training monitor.
Remote absolute paths are replaced with public source labels.

## GitHub Pages

Serve this repository from `main` / root in GitHub Pages.
