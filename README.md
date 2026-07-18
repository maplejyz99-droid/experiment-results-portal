# Experiment Results Portal

Static, source-backed result portal for optimizer experiment comparisons.

## Current Scope

- Active suites: `modded-nanogpt Track 3`, `Llama 124M`
- Planned formal-data suite: `Llama 210M`
- Placeholder views: `Llama 210M`, `muP scaling`, `Llama 583M`, `Llama 720M`, `MoE 520M`, `Memory / Speed`
- Views: suite cards, suite leaderboard, selectable validation-loss curves, run detail, claim cards
- Ranking: suite-specific `leaderboard_rule.sort_by`
- Data source: curated static JSON snapshot in `data/portal-data.json`
- Direct-file mirror: generated `data/portal-data.js`
- Shared chart contract: `figure-runtime.js`

This published snapshot is a presentation portal, not a live training monitor.
Remote absolute paths are replaced with public source labels.

## GitHub Pages

Serve this repository from `main` / root in GitHub Pages.
