# Cross-platform multi-agent research

Date: 2026-08-13

## Category and target

NIGHT LOOP is a repository-local autonomous coding loop with deterministic acceptance gates. The requested extension adds a multi-agent coding control plane that runs natively on Windows and remains portable to Linux and macOS.

The narrow MVP is not a general conversational agent framework. It is a durable zero-interaction coding workflow that gives isolated, checkable task cards to Codex, Grok, Agy, or Claude, keeps their changes in Git worktrees, and accepts work only after the repository harness passes. After arming, no provider may ask for clarification, approval, confirmation, permission to edit, or other user input.

## Requested upstream

[`apsolut-agents` v0.7.1](https://github.com/apsolut/apsolut-agents/tree/v0.7.1) is a markdown-first workspace with task cards, an append-only log, Git-derived status, Git worktree isolation, provider command configuration, delegation caps, spend tracking, and unattended lanes. Its installer explicitly documents POSIX shell scripts running through Git Bash on Windows. The Tier 2 execution scripts depend on tools and process behavior such as `sh`, `awk`, `sed`, `grep`, `mktemp`, `timeout`, `nohup`, POSIX signals, and PID liveness checks. Sources: [README](https://github.com/apsolut/apsolut-agents/blob/v0.7.1/README.md), [installation model](https://github.com/apsolut/apsolut-agents/blob/v0.7.1/template/INSTALL.md), [delegation contract](https://github.com/apsolut/apsolut-agents/blob/v0.7.1/template/DELEGATION.md), and [provider policy](https://github.com/apsolut/apsolut-agents/blob/v0.7.1/template/HEARTBEAT.md).

The inspected tag resolves to commit `5ad36fb8e7a114e0cb08657bb2876e1994e6de04`. The local dry-run would install the full Tier 2 payload into `.apsolut-agents/`, stamp `VERSION` as `0.7.1`, and append bounded bootstrap blocks to both `CLAUDE.md` and `AGENTS.md`.

## Reference products

1. [`apsolut-agents`](https://github.com/apsolut/apsolut-agents/tree/v0.7.1) uses markdown instance files as durable state, task-card frontmatter as the work contract, atomic claim directories as locks, Git worktrees as isolation, provider commands in `HEARTBEAT.md`, and external command output under `runs/`.
2. [Claude Lane Stack](https://github.com/VKirill/claude-lane-stack) uses one project-manager agent, YAML task cards with owned paths and verification checks, detached writer processes, worktree isolation, acceptance receipts, and a separate night review rail. Its documented dependencies include shell-oriented tools such as `rsync` and `flock`, with Linux-specific background and sandbox mechanisms.
3. [Codex Orchestrator](https://github.com/wwhsaber/codex-orchestrator) keeps the main Codex session as architect, sends bounded five-part specs to worker or external CLI lanes, moves waiting and logging to a non-model supervisor, and requires the main session to verify results. It documents exact prompt-position differences for Grok and Agy.
4. [Microsoft AutoGen AgentChat](https://microsoft.github.io/autogen/stable/index.html) models agents and teams in Python and supports pause, resume, save, and load of nested team state. Its state shape is a versioned mapping of agent names to agent-specific state. It is a general multi-agent runtime, not a repository task-card and Git-worktree workflow. See [state management](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html).
5. [CrewAI](https://docs.crewai.com/) models agents, crews, tasks, processes, and flows. Flows provide routing, state persistence, and resume support, while tasks and processes provide sequential or hierarchical orchestration. It is a general application framework rather than a coding CLI lane supervisor.

## Feature matrix

| Capability | [`apsolut-agents`](https://github.com/apsolut/apsolut-agents/tree/v0.7.1) | [Claude Lane Stack](https://github.com/VKirill/claude-lane-stack) | [Codex Orchestrator](https://github.com/wwhsaber/codex-orchestrator) | [AutoGen](https://microsoft.github.io/autogen/stable/index.html) | [CrewAI](https://docs.crewai.com/) |
|---|---|---|---|---|---|
| Repository-local inspectable state | Markdown and Git | YAML, JSON receipts, and Git | Specs, snapshots, results, and logs | Serialized runtime state | Flow and crew runtime state |
| Coding CLI adapters | Configured command strings | Codex, Grok, Agy, and other writers | Codex, Grok, Agy, Claude, and others | Model clients and extensions | Model and tool integrations |
| Git worktree isolation | Yes | Yes | Adapter-dependent | No built-in repository contract | No built-in repository contract |
| Explicit task contract | Markdown frontmatter card | YAML card with owned paths and checks | Five-part bounded spec | Agent task and team messages | Task and process definitions |
| Durable background execution | POSIX shell supervisor | Detached OS controller | Non-model shell supervisor | Runtime-managed async execution | Flow execution and resume |
| Independent acceptance | External green command and foreman | Acceptance receipt plus night review | Main-session verification | User-defined termination and evaluation | Guardrails and callbacks |
| Native Windows execution without Unix utilities | No | Not documented | Not documented | Python runtime is portable, repository workflow is out of scope | Python runtime is portable, repository workflow is out of scope |

## Current repository evidence

- `scripts/night-loop.sh` requires Bash and tmux. tmux is not installed on the inspected Windows host.
- The `bash` command on PATH resolves to the Windows WSL launcher, not Git Bash. The requested no-WSL flow therefore fails before the upstream installer starts.
- Git Bash exists outside PATH and can complete the upstream dry-run, but relying on it would not satisfy a native PowerShell workflow.
- `.gitignore` excludes the entire `.apsolut-agents/` directory because it is personal coordination state. NIGHT LOOP must materialize any required pointer or local view when it creates a worktree instead of relying on Git to distribute the workspace.
- `.codex/hooks.json` contains an absolute path tied to this checkout, while `.claude/settings.json` correctly uses a project-relative environment path. Current [Codex hook documentation](https://learn.chatgpt.com/docs/hooks) says project hooks run with the session working directory, recommends resolving scripts from the Git root, and supports a Windows-specific `commandWindows` override.
- Bun 1.3.8, Git 2.55.0, Codex CLI 0.147.0, Grok CLI 1.0.3, Agy 1.1.12, and Claude Code 2.1.229 are installed on the inspected Windows machine.
- Current Grok supports a native `--cwd`, single-turn `-p`, prompt-file input, structured output, permission modes, and disabling nested subagents.
- Current Agy supports `--print`, `--mode`, `--print-timeout`, structured output, and permission controls. Its prompt placement differs from Grok and must be expressed by a typed adapter, not by appending one prompt argument to every provider command.
- Official OpenAI documentation describes stable `codex exec` non-interactive runs, workspace selection through `--cd`, stdin prompts using `-`, JSONL output, resume support, and native Windows sandboxing. Source: [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
- Bun documents cross-platform subprocess spawning, detached children on Windows and POSIX, output streams, exit promises, termination, and `unref()`. Source: [Bun child processes](https://github.com/oven-sh/bun/blob/main/docs/runtime/child-process.mdx).

## Derived implementation choice

Keep the upstream v0.7.1 workspace and file contracts, but make a Bun and TypeScript control plane the canonical executor on every operating system. This avoids a PowerShell-only fork and prevents Windows behavior from drifting away from Linux and macOS. Small `.ps1` and `.sh` entrypoints may call the same Bun program, but business logic, path handling, locking, provider argument construction, process supervision, and result parsing must live in one tested core.

Use deterministic fake provider executables in the hard test tier. Real Codex, Grok, and Agy calls are separate credential-gated smoke tests. A fake passing adapter proves command construction and state transitions, but it cannot prove a provider account is authenticated or that the current service accepts a live request.

## MVP boundary

Included:

- Pinned upstream Tier 2 workspace installed locally and fully excluded from public Git history.
- Native Windows setup, status, worktree, doctor, delegation, and loop supervision.
- The same Bun control plane on Windows, Linux, and macOS.
- Typed Codex, Grok, Agy, Claude, and fake-provider adapters.
- Provider-specific no-approval invocation, closed stdin after task delivery, no interactive terminal, and an interaction sentinel that fails any run which asks the owner a question.
- Atomic claims, bounded logs, timeouts, cancellation, retry rules, concurrency and depth caps, and harness-based acceptance.
- Deterministic unit and end-to-end tests, plus an operating-system CI matrix.
- Credential-gated live smoke tests that never push, publish, deploy, or use production data.
- External Windows, Linux, and macOS runner certification after the matrix definition is committed.

Deferred:

- A graphical dashboard.
- General chat-agent frameworks or model routing unrelated to coding task cards.
- Automatic production deployment or remote writes.
- Billing, authentication, or a hosted control plane.
