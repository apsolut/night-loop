# Worked Example: Idea to Spec, with Real Research

> **NIGHT LOOP reconciliation (2026-06).** An example of the front half (`idea-to-product-pipeline.md`) on one sample target. NIGHT LOOP builds any such target; the SEO rank tracker here is illustrative, not the product. The product is the loop itself (`NIGHT-LOOP.md`).

A concrete run of the front half in `idea-to-product-pipeline.md`, using real, cited
competitor research (June 2026). The point is to show the riskiest step working: research
becoming a *checkable* backlog, not prose. The payoff at the bottom: the research
independently rediscovers the same data-source gate the hand-written PRD already has,
which is the strongest evidence the method is grounded and not hallucinating.

## Intake (the five answers, the only human input)

1. **Idea.** A dead-simple daily keyword rank tracker.
2. **Wedge.** Semrush and Ahrefs are powerful and heavy. The wedge is one niche (local
   service businesses), at a fraction of the price and setup, one screen that answers "are
   my rankings going up." Research cannot invent this; the human gives it.
3. **One user, one job.** A local-SEO freelancer. The job: see daily position movement for
   a client's keywords in one place.
4. **Hard constraints.** Inherit the repo stack (Bun, TS, libSQL, Playwright). No new deps
   without asking.
5. **Ground-truth seams.** Where do real ranking positions come from. Flagged gated up
   front (see M-INGEST below).

## Research / Discovery (real, cited)

Two reference products, current feature reads:

| Capability | Semrush Position Tracking | Ahrefs Rank Tracker | In MVP? |
|---|---|---|---|
| Track a set of keywords for a domain | Yes | Yes | Yes (core) |
| Daily position updates over time | Yes (daily) | Yes (daily on paid / boost) | Yes (core) |
| Position history / trend charts | Yes | Yes (position history charts) | Yes (core) |
| Desktop vs mobile | Yes | Yes | Yes |
| Location targeting (country / city / ZIP) | Yes (country, city, ZIP) | Yes (187 countries, city/ZIP) | Yes |
| Visibility / share of voice aggregate | Yes (visibility, share of voice) | Yes (Visibility score) | Yes |
| Competitor position comparison | Yes | Yes | Yes |
| SERP feature detection (snippets, PAA, AI Overviews, local pack) | Yes | Yes (19 features incl. AI Overviews) | Later (not MVP) |
| External report export (Looker Studio) | Yes | n/a | No (out of slice) |

The intersection of what both ship, filtered through the wedge and the one job, is the MVP
slice. SERP-feature detection and exports are real but deferred: they are not the one job.
This is the scope discipline that keeps the loop terminating; "do everything Semrush does"
is fifteen years of work.

## Derived spec: backlog.yaml with checkable acceptance criteria

Each criterion is behavioral and checkable against seeded data, per the ratchet rule. Note
that none of these say "build rank tracking." They say what number must equal what.

```yaml
- id: M0-harness
  depends_on: []
  gated: false
  acceptance:
    - "App builds with zero type errors; one smoke test passes"
    - "Headless render captures zero console errors; one screenshot baseline committed"

- id: M1-schema-seed
  depends_on: [M0-harness]
  gated: false
  acceptance:
    - "Migrations create domains, keywords, rankings tables"
    - "seed populates fixtures; a query returns the exact seeded ranking rows"

- id: M2-keyword-crud
  depends_on: [M1-schema-seed]
  gated: false
  acceptance:
    - "Add keyword via UI persists a row in keywords (asserted against the DB)"
    - "List renders all persisted keywords; delete removes from list AND table"

- id: M3-position-history
  depends_on: [M2-keyword-crud]
  gated: false
  acceptance:
    - "For a seeded keyword, the plotted position series equals the rankings rows for that keyword, point for point"
    - "The latest-position number on screen equals the max-date seeded row, not merely a chart that renders"

- id: M4-visibility-metric
  depends_on: [M3-position-history]
  gated: false
  acceptance:
    - "The displayed visibility score equals the aggregate computed directly from the seeded positions by the documented formula"
    - "Changing the date range changes the score to the value recomputed over that range"

- id: M5-competitor-compare
  depends_on: [M4-visibility-metric]
  gated: false
  acceptance:
    - "A second seeded domain's positions render alongside; the per-keyword delta shown equals the computed delta from the seed"

- id: M6-device-location-filter
  depends_on: [M3-position-history]
  gated: false
  acceptance:
    - "Toggling desktop/mobile shows exactly the seeded rows for that device dimension (assert the filtered set, not just that it changed)"

- id: M7-edge-states
  depends_on: [M3-position-history]
  gated: false
  acceptance:
    - "Loading, empty, and error states render for every data view, forced via Playwright, each without crashing"

- id: M-AUTH
  depends_on: [M0-harness]
  gated: true       # human owns the security surface
  acceptance:
    - "Signup creates a user; a protected route 401s without a session"

- id: M-BILLING
  depends_on: [M-AUTH]
  gated: true       # money movement, human owns it
  acceptance:
    - "Checkout works; webhook flips the subscription flag and is idempotent"

- id: M-INGEST
  depends_on: [M3-position-history]
  gated: hard-block # <-- the gate the research surfaced
  acceptance:
    - "Real daily positions come from live Google SERPs. There is NO in-loop ground truth and likely a SERP API or scraping with a ToS/legal surface. Do NOT fabricate positions and pass a rows-inserted test. STOP and get the human's data-source decision."
```

## The payoff

The research did not just produce a feature list. It independently rediscovered the one
decision a loop cannot make: ranking positions are an external, ground-truth-free input
(live Google SERPs), so ingestion is a hard block, exactly the M9 gate the hand-written
PRD already carries. When the "do what the big companies do" research and the human-authored
contract converge on the same gate from opposite directions, that is the signal the method
is grounded. The auto-derived backlog up to M-INGEST is buildable autonomously today; the
gate is where the human steps in, as designed.
