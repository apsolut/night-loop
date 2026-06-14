# NIGHT LOOP isolated runner. The jail where the agent may freely mkdir/delete/evolve code,
# with git as the undo net and network egress denied by default (configure at run, below).
#
# Build:  docker build -t night-loop .
# Run:    docker run --rm -it \
#           -v "$PWD:/work" \
#           -v "$HOME/.claude:/home/loop/.claude" \   # bring your Claude auth in
#           --cap-drop ALL \
#           night-loop
#
# Egress allowlist (recommended): run on a docker network with a firewall that permits only
# api.anthropic.com, api.tavily.com, api.perplexity.ai. The container alone does not enforce this.
#
# NOTE: verify the Bun and Claude Code install commands against current docs before trusting
# this unattended (package names / install scripts move).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git tmux curl ca-certificates unzip \
 && rm -rf /var/lib/apt/lists/*

# Bun (runs the TS hooks and the harness)
RUN curl -fsSL https://bun.sh/install | bash \
 && ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

RUN useradd -ms /bin/bash loop
USER loop
WORKDIR /work

# Tighten the runaway cap for unattended runs; raise once you trust a run.
ENV NIGHT_LOOP_MAX_STEPS=2000

CMD ["bash", "scripts/night-loop.sh"]
