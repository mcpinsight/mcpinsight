# MCPInsight

Analytics for MCP servers in AI coding agents. Local-first CLI + web dashboard for Claude Code and Codex (with Cursor, Windsurf, Copilot on the roadmap).

> **Status — pre-launch (Day 13 of 30).** The CLI is not yet on npm. See [Run it locally today](#run-it-locally-today) to try the current build, or [join the waitlist](https://mcpinsight.dev) for the launch email.

On launch (May 2026), the CLI will scan your `~/.claude/projects/` (and `~/.codex/sessions/` once the Codex parser ships in Week 3), write a local SQLite database at `~/.mcpinsight/data.db`, and open a dashboard showing which MCP servers you actually use, which ones sit idle, and which ones confuse your agent with overlapping tool names.

## What it does

- **Per-server breakdown** across all your AI coding sessions. Which MCP servers get called? How often? With what success rate?
- **Health Score**: a 0–100 number per server based on activation, success rate, tool utilization, tool-name clarity, and token efficiency. Helps you decide what to remove.
- **Multi-client**: one database, normalized view across Claude Code, Codex, and (soon) Cursor.
- **Local-first**: no account, no cloud upload by default. Your session logs stay on your machine.
- **Opt-in community data**: anonymous aggregates fuel the [State of MCP](https://mcpinsight.dev/state-of-mcp) quarterly report.

## What it isn't

- Not a real-time observability tool — polling-based, ~5s lag by design.
- Not an agent runtime — we read sessions, we don't intercept them.
- Not a team dashboard in v0 — Team tier arrives in month 6.

## Run it locally today

Until the npm release, build from source:

```bash
pnpm install
pnpm --filter @mcpinsight/core build
pnpm --filter @mcpinsight/cli build
node packages/cli/dist/index.js scan
```

Full CLI reference, DB path, and table schema: [`packages/cli/README.md`](packages/cli/README.md).

## Install (post-launch)

The commands below will work once `@mcpinsight/cli` is published to npm (target: end of Week 4, ~2026-05-12).

```bash
# One-shot (recommended for first-time)
npx mcpinsight

# Global install
npm install -g mcpinsight

# Activate Pro
mcpinsight activate
```

## Status

Pre-launch. v0.x. Public launch: May 2026.

- ✅ Claude Code parser + normalizer (Day 12, ships 99.6% line coverage)
- ✅ SQLite aggregator + `mcpinsight scan` with incremental rescans (Day 13)
- ✅ INV-01 git-derived project identity
- 🚧 `mcpinsight top` + `servers` commands (Day 14, current sprint)
- 🚧 Codex parser (Week 3)
- 🚧 Web dashboard (Week 3)
- 🚧 Licensing + opt-in telemetry (Week 4)
- 🚧 Health Score v2 (Week 3)
- 📋 Cursor parser (Q2 2026)
- 📋 Team tier (month 6)

## Privacy

- All parsing runs locally. Your session content never leaves your machine.
- Telemetry is **opt-in**. Opted-in data is anonymous aggregates (server names, call counts) — never session content, prompts, or tool arguments.
- Detailed schema: [docs/telemetry-schema.md](docs/telemetry-schema.md).

## Contributing

This is a solo project for the first 12 months. Issues and PRs welcome — we triage weekly. See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow expectations.

For architecture, see [CLAUDE.md](CLAUDE.md) and the [ADRs](docs/adr/).

## License

Code: MIT. State of MCP reports: CC-BY-4.0.

## Links

- Website: [mcpinsight.dev](https://mcpinsight.dev)
- Blog: [mcpinsight.dev/blog](https://mcpinsight.dev/blog)
- Twitter/X: [@mcpinsight](https://twitter.com/mcpinsight)
- Issues: [github.com/mcpinsight/mcpinsight/issues](https://github.com/mcpinsight/mcpinsight/issues)
