# CONSTITUTION.md

Definition of Done and standing gates for GravitonKV. A deliverable that fails its DoD is not done, regardless of how finished it looks.

## Definition of Done, per artifact

**A sweep cell is done when:** it ran on an on-demand Graviton4 instance with the pinned llama.cpp build (KLEIDIAI = 1 verified), N met the run standard (10 where under 10 minutes, 5 minimum), the first rep was discarded, the result JSON validates against the canonical schema, aggregates match a recompute from raw values, and the file is in S3 and committed.

**The harness is done when:** a person who did not build it runs `./run_sweep.sh --config sweeps/smoke.yaml` on a fresh Graviton instance and gets schema-valid output in under 15 minutes.

**A chart is done when:** it renders from generated data only, shows error bars and N, labels units on every axis, keeps the f16 baseline visible, uses the Okabe-Ito palette, and reads correctly in dark mode.

**The dashboard is done when:** the static export builds clean, every band renders real data, Lighthouse performance is 95 or above (below 90 is a build failure), and the OG image unfurls.

**The MCP server is done when:** a clean Claude account with only the pasted endpoint URL answers "what is the best KV config for a 32k-context workload on Graviton4?" with numbers sourced from the canonical results, and the stdio server installs via npx.

**The README is done when:** every benchmark table sits between generation markers and CI fails if the committed file differs from the regenerated one, the related-work section carries all mandated citations, and the limitations section leads with the decode regression.

**The video is done when:** it is under 3 minutes, shows real software running on the hardware it claims, has the headline number on screen in the first 15 seconds, and passes the measurement gate (duration, resolution, integrated loudness near -14 to -16 LUFS).

**The submission is done when:** a teammate who did not build the project completes the judge path (90-second page scan, then clone, repro, dashboard, MCP) without hitting a broken link, a private resource, or an unverifiable claim, checked from a logged-out browser.

## Never list

- Never hand-type a benchmark number in any artifact.
- Never present a Mac, CI, t4g, or spot-instance number as a finding.
- Never upgrade the pinned llama.cpp commit.
- Never drop below N=5 or skip the warmup discard.
- Never delete an anomaly, failed cell, or negative result.
- Never claim beyond the exact novelty sentence.
- Never commit a secret, a real .env, or a model file.
- Never use an em-dash.

## Ask-first list

- Any new model, KV config, context tier, chart, or MCP tool (scope decision required; default answer after July 25 is no).
- Any spend that would push cumulative AWS cost past the $180 soft cap.
- Any change to the results schema after it is frozen.
- Anything that would make the MCP server less than read-only.

## Demo flow (the path judges walk)

1. Devpost page: headline metric above the fold, before/after table, video embed, repo link, dashboard link.
2. Video: cold open on the headline number, live terminal on Graviton, dashboard tradeoff surface, MCP question answered, repro close.
3. Repo: README hero with badges and one-command repro, license visible in About, pilot and canonical results in place.
4. Dashboard: five bands, headline in band 1, methodology in band 5.
5. MCP: paste URL, ask the 32k question, get sourced numbers.
