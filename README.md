<div align="center">

<h1>
  <img src="docs/images/lazyai-logo.png" alt="LazyAI" width="360">
</h1>

A keyboard-first terminal UI for Claude Code and Codex sessions
<br/>

[![npm](https://img.shields.io/npm/v/%40rafaeloviedo%2Flazyai?color=blue)](https://www.npmjs.com/package/@rafaeloviedo/lazyai)
[![npm downloads](https://img.shields.io/npm/dm/%40rafaeloviedo%2Flazyai)](https://www.npmjs.com/package/@rafaeloviedo/lazyai)
[![license](https://img.shields.io/npm/l/%40rafaeloviedo%2Flazyai)](LICENSE)
[![node](https://img.shields.io/node/v/%40rafaeloviedo%2Flazyai)](package.json)

![LazyAI: starting a new session, deleting a session, opening models, and opening keybindings](docs/gifs/lazy-ai.gif)

</div>

## Elevator Pitch

AI coding agents are great, but working on multiple tasks in parallel can get messy fast. I built LazyAI after finding myself with several terminals open at once, each running a different Claude Code session, constantly switching between them just to remember what was happening where.

LazyAI brings those sessions into a single terminal UI. Manage Claude Code and Codex sessions across projects, resume previous work, send prompts, switch models, approve tools, and keep track of what each agent is doing — without juggling a bunch of terminal windows.

LazyAI also has a Neovim plugin: [lazy-ai.nvim](https://github.com/RafaelOviedo/lazy-ai.nvim)

## Sponsorship

Support LazyAI by [sponsoring me on GitHub](https://github.com/sponsors/RafaelOviedo).

## Roadmap

Potential additions to LazyAI. This list captures ideas for future development; order of features is not fixed.

1. **More providers and models** — OpenCode, Gemini CLI, additional Agent Client Protocol (ACP)-compatible agents, and local models.
2. **Searchable model picker** — Search models, save favorites, and see supported capabilities.
3. **Project defaults** — Remember the preferred provider, model, and thinking level for each project.
4. **Unified session dashboard** — See sessions from all providers together.
5. **Per-session model selection** — Use different providers and models in different sessions simultaneously.
6. **Session search and filters** — Search titles and conversations; filter by project, provider, status, or date.
7. **Session organization** — Pin, rename, tag, and archive sessions.
8. **Agent-question dialogs** — Answer agents' multiple-choice and free-text questions inside LazyAI.
9. **Attention queue** — Jump to sessions waiting for approval, an answer, or review.
10. **Notifications** — Get notified when a session finishes, fails, or needs input.
11. **Live tool activity** — See commands, file edits, tool results, and errors as they happen.
12. **Better conversation navigation** — Search within a conversation, jump between messages, and preserve scroll position.
13. **Prompt drafts and history** — Keep drafts per session and reuse previous prompts.
14. **External-editor input** — Write longer prompts in your preferred editor.
15. **Reusable prompt templates** — Save prompts for reviews, debugging, testing, and implementation.
16. **Context attachments** — Add files, selected lines, Git diffs, or editor selections to prompts.
17. **Task queue** — Queue follow-up prompts, cancel queued work, and control concurrency.
18. **Git changes panel** — Browse changed files and inspect diffs inside LazyAI.
19. **Worktree per task** — Give concurrent coding tasks separate branches and working directories.
20. **Session branching** — Start an alternative conversation from an earlier message where supported.
21. **Cross-provider handoff** — Prepare a summary to continue work with another agent.
22. **Conversation export** — Export selected messages or entire conversations to Markdown.
23. **Agent/model comparisons** — Run the same task in isolated workspaces and compare changes and test results.
24. **Usage dashboard** — Track available token usage, limits, duration, and clearly labeled cost estimates.
25. **Provider diagnostics** — Explain missing installations, authentication issues, unavailable models, and incompatible versions.
26. **MCP and tool visibility** — Inspect connected tools, capabilities, and connection status.
27. **Deeper Neovim integration** — Send selections, open changed files, and jump between editor and session.
28. **Issue-to-task workflows** — Connect an issue to a session, worktree, test results, and pull request.
29. **Remote sessions** — Connect to agents running on another machine.
30. **Background execution** — Keep tasks running after closing the TUI and reconnect later.
31. **Persistent preferences** — Remember layout, filters, selections, and other settings.
32. **Customizable interface** — Themes, keybindings, compact layouts, and resizable panels.
33. **Command palette** — Search and execute app actions, such as starting a session or changing models, without remembering shortcuts.
34. **Extensible provider adapters** — Make adding future agents easier through a consistent integration interface.
35. **Direct model API support** — Connect directly to model services, with LazyAI managing the agent loop, tools, and conversation storage; a larger architectural expansion.

## Table of Contents

- [Elevator Pitch](#elevator-pitch)
- [Sponsorship](#sponsorship)
- [Roadmap](#roadmap)
- [Features](#features)
  - [Browse Projects and Sessions](#browse-projects-and-sessions)
  - [Resume and Prompt Sessions](#resume-and-prompt-sessions)
  - [Switch Providers and Models](#switch-providers-and-models)
  - [Approve Codex or Claude Code Tools](#approve-codex-or-claude-code-tools)
  - [Inspect Context and Usage](#inspect-context-and-usage)
- [Installation](#installation)
- [Usage](#usage)
  - [Keybindings](#keybindings)
- [Providers and Local Data](#providers-and-local-data)
- [Privacy and Transparency](#privacy-and-transparency)
- [Contributing](#contributing)
- [Donate](#donate)
- [License](#license)

## Features

### Browse Projects and Sessions

LazyAI reads local Claude Code and Codex history, groups sessions by project, and lets you jump through old work with `h`, `j`, `k`, `l`, and `Space`.

![LazyAI: browsing projects and sessions](docs/gifs/browse-projects-and-sessions.gif)

### Resume and Prompt Sessions

Press `Space` on a session to resume it, `n` to start a new one in the selected project, or `p` to send a follow-up prompt to the active session. The details panel follows the conversation as new messages arrive.

Sessions can work in parallel: start another with `n`, or activate an idle session with `Space` and prompt it with `p` while others are thinking. Starting a session opens its conversation. To watch another session's incoming messages, highlight it and press `w`. Finishing a response updates its status without changing your view or selection.

The session targeted by `p` and `i` keeps a green **Active** label alongside its status, such as **Active · Thinking...** or **Active · Completed**, even while you view another conversation.

![LazyAI: resuming and prompting sessions](docs/gifs/resume-and-prompt-sessions.gif)

### Switch Providers and Models

Press `m` to open the provider and model picker. LazyAI detects usable local providers at startup and rebuilds the dashboard when you switch between Claude Code and Codex.

Move between models with `j` / `k`, and choose a **Thinking level** with `h` / `l`. `Enter` applies both choices; `Esc` discards your changes. Available levels depend on the model. **Default** leaves effort to the provider; after an explicit override, it restores the session's original Codex effort or relaunches the same Claude session without an effort override. Changing only the thinking level keeps your active session and applies to the next prompt. Choices last until you exit LazyAI, and the status bar shows the selected level.

Codex levels come from its local model cache. Claude levels use the documented [Claude Code model capabilities](https://code.claude.com/docs/en/model-config#adjust-effort-level); unknown models show “Thinking level unavailable.” Provider settings and organization policies can limit the effort actually used.

![LazyAI: switching providers and models](docs/gifs/switch-providers-and-models.gif)

### Approve Codex or Claude Code Tools

When Codex or Claude Code asks for tool permission, LazyAI opens an in-terminal approval modal. Choose whether to allow once, allow for the session when available, or deny. `j` / `k` move between the choices, `Enter` confirms, and `Esc` denies.

Session-wide approval is only offered when the provider says the request supports it. LazyAI asks Codex to route escalations to this modal, so approvals appear here rather than following the `approval_policy` in `~/.codex/config.toml`.

![LazyAI: approving Codex or Claude Code tool requests](docs/gifs/approve-codex-or-claude-code-tools.gif)

### Inspect Context and Usage

The context panel shows session metadata, token information when transcripts provide it, and Codex usage-limit snapshots when saved telemetry is available.

![LazyAI: inspecting context and usage](docs/gifs/inspect-context-and-usage.gif)

## Installation

Install it globally with npm:

```sh
npm install -g @rafaeloviedo/lazyai
lazyai
```

You need Node.js 20 or newer and at least one configured provider:

- Claude Code, authenticated locally
- Codex, with the `codex` executable available and authenticated locally

LazyAI uses the directory you launch it from as the initial project path.

```sh
cd /path/to/your/project
lazyai
```

## Usage

1. LazyAI detects local providers at startup and prefers one with authentication and saved history.
2. Press `m` to open the provider and model picker. Move with `j` / `k`, then press `Enter`.
3. Move between panels with `h` and `l`.
4. In Projects, highlight a project and press `Space` to load its sessions.
5. In Sessions, press `w` to view a conversation, `Space` to resume it, or `d` to delete a Codex session.
6. Press `n` to start a new session or `p` to prompt the active session.
7. Press `i` to interrupt a running response, `?` for keybindings, or `q` to quit.

Prompting and interrupting target the session you started or resumed with `Space`. Moving the highlight or viewing a conversation with `w` does not change that active session. Each session accepts one turn at a time; other sessions can run independently. Provider/model selection remains unavailable while any session is working.

### Keybindings

Dashboard shortcuts apply while no modal is open.

| Key | Where | Action |
| --- | --- | --- |
| `h` / `l` | Dashboard | Focus the previous / next panel |
| `j` / `k` | Sessions, Projects | Highlight the next / previous item |
| `Space` | Projects | Select the highlighted project and load its sessions |
| `Space` | Sessions | Resume the highlighted session |
| `w` | Sessions | Open the highlighted conversation; retry a failed load |
| `n` | Dashboard | Open a new-session prompt for the selected project |
| `p` | Dashboard | Open a follow-up prompt for the active session |
| `i` | Dashboard | Interrupt the active session's response |
| `d` | Sessions | Open the delete confirmation for the highlighted Codex session |
| `m` | Dashboard | Open the provider and model picker |
| `j` / `k` | Details | Scroll down / up |
| `PageDown` / `PageUp` | Details | Scroll down / up in larger steps |
| `Home` / `End` | Details | Jump to the top / bottom of the conversation |
| `?` | Dashboard | Open keybinding help |
| `q` | Dashboard | Quit |
| `j` / `k` | Model picker, tool permissions | Move between choices |
| `h` / `l` | Model picker | Change thinking level for the highlighted model |
| `Enter` | Prompts, picker, confirmations | Submit the prompt or confirm the selected action |
| `Ctrl+J` | Prompt input | Insert a new line |
| `Esc` | Modals | Cancel or close; deny a pending tool permission request |

## Providers and Local Data

| Capability | Claude Code | Codex |
| --- | --- | --- |
| Browse projects, sessions, and conversations | Yes | Yes |
| Start, resume, prompt, and interrupt | Yes | Yes |
| Provider and model selection | Yes | Yes |
| Delete sessions | Not supported | Yes, with confirmation |
| Tool permission modal | Yes | Yes, for commands and file edits |
| Token/context information | When present in transcripts | When present in transcripts |
| Usage-limit snapshots | Not available | When present in saved telemetry |

Session history is read from these locations:

| Provider | Default history location | Data-directory override |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | `CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex/session_index.jsonl` and `~/.codex/sessions/**/*.jsonl` | `CODEX_HOME` |

Browsing history reads local files. Starting or prompting sessions talks to the selected provider through the Claude Agent SDK or Codex app-server and uses that provider's local authentication. Displayed context and usage information comes from saved records and may lag behind the provider's current state.

Model choices come from local provider metadata. A missing model list can mean missing or stale provider data. Authentication detection checks local credential files and API-key environment variables; it does not validate credentials with the provider.

## Privacy and Transparency

LazyAI is a local, open-source terminal client. It has no backend of its own, no accounts, and no telemetry. Everything you see on screen is read from files that Claude Code and Codex already wrote on your machine.

### What LazyAI does not do

- **No LazyAI server.** There is nowhere for LazyAI to send anything, because no such service exists. No analytics, no telemetry, no crash reporting, no usage pings, no update checks.
- **No network code of its own.** LazyAI's source contains no HTTP, socket, or WebSocket calls anywhere — no `fetch`, no `node:http`/`node:https`/`node:net`, no third-party analytics SDK.
- **No tokens stored, copied, or transmitted.** LazyAI never writes a credential anywhere, never displays one, never logs one, and never sends one.
- **No files written.** LazyAI's own code opens your provider data read-only. It creates no state file, cache, config, or log of its own, and it does not modify your transcripts.
- **No install-time scripts.** The package has no `postinstall` or other lifecycle hook.

### What LazyAI reads

All of it is local, and all of it is read-only:

| Provider | Files read | Purpose |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Session history and conversations |
| Claude Code | `~/.claude/settings.json`, `~/.claude.json` | Model list and signed-in account label |
| Claude Code | `~/.claude/.credentials.json` | Signed-in check only — see below |
| Codex | `~/.codex/session_index.jsonl`, `~/.codex/sessions/**/*.jsonl` | Session history and conversations |
| Codex | `~/.codex/config.toml`, `~/.codex/models_cache.json` | Model list |
| Codex | `~/.codex/auth.json` | Signed-in check and sign-in mode — see below |

`CLAUDE_CONFIG_DIR` and `CODEX_HOME` relocate these roots, and LazyAI honours both.

### How credentials are handled

To tell a signed-out provider from a signed-in one, LazyAI has to know whether a credential exists. It opens the credential file, checks that a token field is present and non-empty, and keeps **only the resulting yes/no** — `hasCredentials()` in [`src/app/registry/detect-providers.ts`](src/app/registry/detect-providers.ts) returns a `boolean`. The token value is never retained, displayed, logged, or sent anywhere. The same presence-only check applies to the `ANTHROPIC_API_KEY`, `CODEX_API_KEY`, and `OPENAI_API_KEY` environment variables.

Detection is entirely offline: LazyAI never validates a credential against the provider.

Two non-secret labels are read so the status panel can show who you are signed in as: the account email from `~/.claude.json` (`oauthAccount.emailAddress`) and Codex's `auth_mode` from `auth.json`. Both are only ever drawn in your own terminal.

### What does leave your machine

One thing, and only when you ask for it: **the prompts you send.** Starting, resuming, or prompting a session has to reach the model, so LazyAI hands it to the provider you selected:

- **Claude Code** — through Anthropic's official [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), which runs your locally installed `claude` (preferring your own CLI over the copy the SDK bundles).
- **Codex** — by spawning your local `codex app-server` and speaking JSON-RPC to it over stdin/stdout.

In both cases the request goes to Anthropic or OpenAI exactly as it would if you typed the same prompt into the CLI yourself, authenticated by that provider's own local credentials. LazyAI adds no destination of its own, and browsing history sends nothing at all.

Deleting a session is delegated to the provider too, never done behind its back: Codex deletions go out as a `thread/delete` request to `codex app-server`, and Claude Code session deletion is [deliberately unsupported](src/app/registry/provider-registry.ts) rather than implemented by unlinking transcripts directly.

### Verify it yourself

Please don't take the list above on trust — the whole point of it being open source is that you can check. From a clone of this repo:

```sh
# No outbound network calls in LazyAI's own code (expect: no matches)
grep -rnE "fetch\(|node:https?|node:net|node:dgram|node:tls|WebSocket|XMLHttpRequest" src/ index.ts

# No file writes or deletions in LazyAI's own code (expect: no matches)
grep -rnE "writeFile|appendFile|unlink|rmdir|mkdir|createWriteStream" src/ index.ts

# Every filesystem import is a read-only API
grep -rn "node:fs" src/ index.ts
```

The files worth reading in full are short:

- [`src/app/registry/detect-providers.ts`](src/app/registry/detect-providers.ts) — every line of credential handling lives here
- [`src/providers/claude/claude-session-repository.ts`](src/providers/claude/claude-session-repository.ts) and [`src/providers/codex/codex-session-repository.ts`](src/providers/codex/codex-session-repository.ts) — all transcript reading
- [`src/providers/claude/claude-sdk-client.ts`](src/providers/claude/claude-sdk-client.ts) and [`src/providers/codex/codex-app-server-client.ts`](src/providers/codex/codex-app-server-client.ts) — the only code that talks to a provider

LazyAI has just two runtime dependencies: `@anthropic-ai/claude-agent-sdk` (Anthropic's official SDK, and the component that talks to Anthropic on your behalf) and `@b9g/termdom` (the terminal renderer). If you audit the installed tree you will see further packages such as `express`, `hono`, and `cors`. Those arrive through the Agent SDK's dependency on `@modelcontextprotocol/sdk`, which ships transports for MCP servers; nothing LazyAI pulls in or calls uses them to send your data anywhere. `@b9g/termdom` depends only on text layout and parsing libraries (`bidi-js`, `css-tree`, `linebreak`, `parse5`, `nwsapi`, `arabic-persian-reshaper`).

Found something that contradicts any of this? Please [open an issue](https://github.com/RafaelOviedo/lazy-ai/issues) — it would be treated as a bug.

## Contributing

Issues and pull requests are welcome. The source is TypeScript, the terminal UI is built with [`@b9g/termdom`](https://www.npmjs.com/package/@b9g/termdom), and provider integrations live under `src/providers`.

## Donate

LazyAI isn’t my full-time job, but I spend my free time working on it. If you’d like to support the project, please consider [sponsoring me](https://github.com/sponsors/RafaelOviedo).

## License

ISC
