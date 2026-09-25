# xpi-session-naming

**English** · [简体中文](./README.zh-CN.md)

**A Pi Coding Agent extension that names each session after the topic of its first real exchange**, so the session list stays readable instead of filling up with timestamps.
**一个在首轮有效对话结束后自动给 Pi 会话命名的扩展**, 让会话列表显示主题而不是时间戳。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

```text
> /xpi-session-naming
```

## Why

Every session you open starts untitled, so a day of work leaves a list of indistinguishable entries and the conversation you had an hour ago is unreachable. This extension names a session the moment its first real exchange settles — e.g. `[deepseek-v4.1-flash] - 订阅页埋点梳理` — then gets out of the way. It watches the `agent_settled` event, decides whether the turn was worth naming, asks one isolated completion on the configured topic model (default `mimo-v2.6-flash`) for a topic, validates the answer, and writes the name exactly once. A manual rename always wins, a failure never disturbs the conversation, and the session's active model is never touched.

Every extension in this repository starts from the same four rules:

- **No build step.** Pi loads `./src/index.ts` directly. No `dist/`, no bundler, no committed artifacts.
- **Pi-native UI.** Rendering goes through `ctx.ui.*` and `@earendil-works/pi-tui`. It never hijacks the terminal or pulls in a competing terminal framework.
- **No heavy runtime dependencies.** Host-provided APIs plus strict types; `typebox` for tool schemas, and nothing else unless it earns its place.
- **Strict gates, no exceptions.** TypeScript strict, Biome, and Vitest must all pass before any commit.

It also stays inside its lane: an extension is a plugin loaded into the Pi main process, not a separate service. If a task needs a process boundary, say so in an ADR before adding one.

## Tech stack

- [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/), versions pinned in [`mise.toml`](./mise.toml)
- [Pi Coding Agent](https://github.com/earendil-works/pi) — the host, its extension API, and `@earendil-works/pi-tui`
- TypeScript strict (`target: ES2024`, `module: NodeNext`)
- [Biome](https://biomejs.dev/) for lint and format
- [Vitest](https://vitest.dev/) as the test runner

## Install

Requires a working Pi installation. The package is loaded straight from source, so there is nothing to build first.

```bash
pi install git:github.com/<owner>/xpi-session-naming@<ref>
```

| Where | Command |
| --- | --- |
| Global (user settings) | `pi install git:github.com/<owner>/xpi-session-naming@<ref>` |
| This project only (`.pi/settings.json`) | `pi install -l git:github.com/<owner>/xpi-session-naming@<ref>` |

`pi install` writes to `~/.pi/agent/settings.json`; `-l` writes to the project settings, which Pi installs automatically once the project is trusted. A pinned git ref is not moved by `pi update`.

```bash
pi list                              # installed packages
pi update --extensions               # update packages and reconcile pinned refs
pi remove git:github.com/<owner>/xpi-session-naming
```

Package-level debugging uses npm or git remote sources on purpose: a local-path install only records a reference to your working copy and leaves a stale entry in settings the moment you forget to `pi remove` it.

## Usage

| Command | Description |
| --- | --- |
| `/xpi-session-naming` | Show the extension status and the loaded version |
| `/xpi-session-naming-model` | Pick the model that names sessions, from the same list as `/model-name` |

### How a session gets named

- **Trigger** — every completed user turn (`agent_settled`). A meaningful first turn (more than 10 code points, slash commands excluded) names the session immediately; a trivial first turn (`hello`, `/command`) waits for the second completed turn.
- **Name format** — `[<primary-model-id>] - <topic>`. The provider prefix of the model id is stripped; the topic is a validated single-line Simplified Chinese phrase (requested ≤ 20 characters, accepted ≤ 30).
- **Topic model** — one bounded completion on the model chosen with `/xpi-session-naming-model`, defaulting to `mimo-v2.6-flash` (provider `MIMO` first, then any configured provider exposing the same model id), 15s timeout, carrying only the first two user messages (500 code points each). A stored choice wins only while its provider still exists and has configured auth; otherwise the default chain runs, and no usable topic model means the session simply stays unnamed.
- **Guards** — an existing name is never overwritten (checked before and after the model call), only one attempt runs at a time, and the topic model is invoked through `ctx.modelRegistry.streamSimple()`, so generating a name can neither switch the conversation's model nor touch settings.
- **Failure boundary** — every failure is returned as data and reported with a short `ctx.ui.notify` warning that contains neither prompt nor topic text; unexpected exceptions are swallowed. Naming never blocks or alters the conversation.

Reads: the current branch's message entries and the session name. Writes: the session name, and only when there is none yet.

### Configuration

`/xpi-session-naming-model` writes `<agent-dir>/xpi-session-naming.json` (default `~/.pi/agent/xpi-session-naming.json`):

```json
{ "topicModel": { "provider": "MIMO", "id": "mimo-v2.6-flash" } }
```

A missing, unreadable, or malformed file means "no choice", and naming falls back to the default chain. The file holds a provider/model-id reference only — no credential ever lands there. The choice is re-read on every turn, so picking a model applies to the next turn without `/reload`.

## Development

```bash
mise install                         # pinned Node.js and pnpm
pnpm install
```

| Gate | Command |
| --- | --- |
| Types | `pnpm typecheck` — `tsc --noEmit` |
| Lint and format | `pnpm -w run lint` — Biome across the repository |
| Tests | `pnpm test` — Vitest (`vitest run --passWithNoTests`) |

All three must pass before committing. Run `pnpm -w run lint` explicitly at the workspace root; the wrapper occasionally misreads a bare `pnpm run lint` as an unknown recursive command.

Two ways to run the extension while working on it:

```bash
pi -e ./src/index.ts                 # smoke test: load once, current run only
```

```bash
ln -s "$(pwd)" ~/.pi/agent/extensions/xpi-session-naming   # live loop: /reload inside Pi
```

`pi -e` writes nothing to settings; the symlink is picked up from the extensions directory and is removed with `rm`.

## Directory structure

```text
.
├── mise.toml / package.json / biome.jsonc / tsconfig.json / pnpm-workspace.yaml
├── AGENTS.md / CONTEXT.md / DESIGN.md
├── docs/                      # Git workflow and repository guardrails
└── src/
    ├── index.ts               # Extension entrypoint (register function, `agent_settled` hook)
    ├── naming-run.ts          # One naming attempt per run: guards, outcome
    ├── naming-eligibility.ts  # Turn classification and naming decision
    ├── session-name.ts        # `[model-id] - topic` composition
    ├── topic-model.ts         # Isolated topic completion via `ctx.modelRegistry`
    ├── topic-model-config.ts  # `<agent-dir>/xpi-session-naming.json` read/write
    ├── topic-text.ts          # Prompt construction and topic validation
    ├── ui/                    # `ctx.ui` components (`model-picker.ts` for the picker)
    └── *.test.ts              # Vitest coverage for each module above
```

## Design baseline

This project adopts the [Google Labs DESIGN.md format](https://github.com/google-labs-code/design.md) tailored for terminal TUI interfaces. See [`DESIGN.md`](./DESIGN.md) for the design tokens (colors, monospace typography, spacing, and component definitions).

## Conventions & constraints

- **Glossary** — [`CONTEXT.md`](./CONTEXT.md) defines the repository's unified terminology; terms must not drift in code, docs, or commits.
- **Token safety** — credentials and secret tokens are never written into code, logs, examples, or documentation.
- **Git discipline** — read [`docs/GIT-WORKFLOW.md`](./docs/GIT-WORKFLOW.md) and [`docs/GITHUB-GUARD.md`](./docs/GITHUB-GUARD.md) before committing or pushing. No feature branch by default: commit directly on `main` in small Conventional Commits; force pushes and history rewrites are never allowed.
- **Agent contract** — [`AGENTS.md`](./AGENTS.md) is the single source of truth for this repository. When an oral agreement, older code, or this README disagrees with it, `AGENTS.md` wins.

## Credits

- [Pi Coding Agent](https://github.com/earendil-works/pi) by [earendil-works](https://github.com/earendil-works) — the host this extension plugs into. The extension API, the `ctx.ui` contract, and the package manifest format are theirs.

## License

MIT
