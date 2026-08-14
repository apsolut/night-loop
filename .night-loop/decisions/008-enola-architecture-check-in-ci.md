# 008: Enola architecture check as an advisory PR gate

Date: 2026-08-14. Status: adopted at the owner's request.

## Why

enola-labs/enola-action performs deterministic architectural regression
analysis (dependency cycles, layer violations, 11 explainers) by comparing a
pull request's base against its head. It fits the harness philosophy: local
only (tree-sitter plus graph algorithms, no models, no network calls at
analysis time), same commit always yields the same verdict, and it reports
findings as source annotations plus a job summary.

## Scope and tier

Runs in its own workflow on pull_request only, so the judge-certified push
matrix in ci.yml stays byte-identical to what M5/M6 carriers assert. Default
policy: fails only on a newly introduced dependency cycle; the other ten
explainers are advisory. That matches the ratchet's advisory tier: inform,
never revert. Promotion of more explainers to failing via fail-on is a future
attended decision.

## Supply-chain note

The action needs read-only contents access, verifies release checksums, and
does not execute repository scripts. Pinned to the v1 major.
