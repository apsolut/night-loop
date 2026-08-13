# 003 - Single Claude product boundary

Date: 2026-08-13
Milestone: product-wide

## Decision
NIGHT LOOP ships as a single-agent Claude Code CLI loop. `.apsolut-agents/` is
ignored contributor tooling used to build this repository and is not installed,
read, copied, or required by NIGHT LOOP. Provider adapters, multi-agent delegation,
worktree orchestration, multiplexing, Omni, and provider competition remain outside
the active product backlog.

## Why
The original promise is one attended intake followed by one unattended Claude
session whose completion is independently verified. Mixing the maintainers' local
collaboration workspace into the runtime obscures that promise and adds unrelated
installation, coordination, and portability work.

## Reconsider only when
The single-agent Claude supervisor is released and a separately approved product
proposal supplies behavioral acceptance criteria for another runtime mode.
