---
name: intake
description: Turn an idea into a checkable .apsolut-loop/backlog.yaml via a few questions plus grounded competitor research. Run once at the start of a new project, before arming the NIGHT LOOP. This is the front half of idea-to-product-pipeline.md.
---

# Intake

Goal: convert "what I want to build" into a dependency-ordered backlog of milestones with
behavioral, seed-checkable acceptance criteria, so the NIGHT LOOP has a real contract. Run
this interactively (attended). It is the one human touch before days of autonomous building.

## 1. Ask the five questions (only what research cannot answer)
Ask conversationally, one at a time, and record the answers in `.apsolut-loop/intake.md`:
1. The idea in one line.
2. The wedge: why this instead of the incumbent. A pure clone has no reason to exist; this is
   the most important answer and research will never produce it.
3. The one user and the one job it must nail first.
4. Hard constraints: stack pins, budget, must-have or must-not integrations.
5. Ground-truth seams: where does real data come from, is there money, is anything
   irreversible. These get flagged gated up front.

## 1b. Front-load the owner decisions (so the night never has to ask)
The build runs gate-free only if the human-owned calls are made now, while the user is awake.
Before research, pin down and record in `.apsolut-loop/intake.md`: the data source (or that it is a
hard-block to defer), the auth approach, the billing model, and the wedge. Have the user provide
TEST credentials (test Stripe keys, a throwaway DB) and confirm seeded fixtures are the only data
the build touches. With these set, auth/billing/schema get built and tested overnight against
fakes and nothing waits for approval.

## 2. Research how the established players do it (grounded, cited)
- Identify the category and 3 to 5 reference products.
- Research each product's feature set, information architecture, core flows, and data-model
  shape. Use Tavily (`api.tavily.com`) and Perplexity Sonar (`api.perplexity.ai`) if
  `TAVILY_API_KEY` / `PERPLEXITY_API_KEY` are set; otherwise use WebSearch. Cite real sources.
- Build a feature matrix (rows = capabilities, columns = products). Every "product X does Y"
  must cite a source. An unsourced claim is a hallucinated spec; do not include it.

## 3. Derive the spec
- The MVP slice is the commonly-shipped capabilities filtered through the wedge and the one
  job. Defer everything else. Do not try to match the incumbent's full product.
- Write `.apsolut-loop/backlog.yaml`: milestones in dependency order, M0 (harness) first, each with
  behavioral acceptance criteria checkable against seeded data ("the number on screen equals
  the number computed from the seed", not "implemented").
- Mark `gated: true` for security surfaces (auth, billing): the loop BUILDS and TESTS these
  overnight against test credentials and flags them for a morning security review; it does not
  skip them. Mark `gated: hard-block` for milestones with no test ground truth (e.g. ingesting
  real live data): the loop SHELVES these to Blocked rather than fabricating data to pass.
- Update the `## Next` section of `.apsolut-loop/progress.md`, and seed `.apsolut-loop/constraints.md`
  project-conventions section from the hard constraints.

## 4. Spec-critic pass
Before showing the human, review the backlog adversarially: what is missing, which criterion
is prose rather than checkable, which capability is unsourced, what should be gated and is not.
Fix those, then proceed.

## 5. The one human gate
Show the derived backlog and the open questions (especially any hard-block data source). Get
approval or redirect. Then tell the user: arm the build with `bash scripts/night-loop.sh` (in
the Docker jail for an unattended multi-day run).

Do not start building here. Intake produces the contract; the NIGHT LOOP builds against it.
