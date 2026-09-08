# Lazy AI

Lazy AI is a Terminal UI for managing AI models.

It is built around a simple idea: if your assistant work already leaves useful state on your machine, you should be able to browse it quickly without opening another heavy app. Lazy AI reads persisted Codex session history from `~/.codex`, groups it by project, and presents the useful bits in a keyboard-first terminal UI.

> Early project note: Lazy AI is not published to npm yet. The current install flow is source-based, and the package install commands below are placeholders for the eventual public release.

## Preview

<!-- Add a screenshot of the main terminal dashboard here. -->
<!-- Suggested path: docs/images/lazy-ai-dashboard.png -->

![Lazy AI dashboard placeholder](docs/images/lazy-ai-dashboard.png)

<!-- Add a short GIF showing project/session navigation here. -->
<!-- Suggested path: docs/images/lazy-ai-navigation.gif -->

![Lazy AI navigation placeholder](docs/images/lazy-ai-navigation.gif)

## What It Does

Lazy AI gives you a compact terminal view over your local Codex history:

- Lists projects discovered from saved Codex sessions.
- Lists recent sessions for the selected project.
- Shows session metadata such as title, model, project path, and last update.
- Displays context-window usage when token telemetry is available.
- Displays the latest observed Codex usage-limit snapshot when available.
- Supports keyboard navigation between panels and list items.
- Includes an in-terminal help modal for keybindings.

The app currently treats `~/.codex/session_index.jsonl` and `~/.codex/sessions/**/*.jsonl` as its data source. It does not send session data anywhere.

## Concept

AI coding work can become fragmented fast: different projects, different sessions, different model choices, and different context states. Lazy AI is meant to be a lightweight control surface for that activity.

The project is intentionally terminal-native:

- It stays close to the workflow where coding agents are already used.
- It favors keyboard navigation over pointer-heavy interaction.
- It reads local state instead of requiring a hosted account or dashboard.
- It keeps the first version focused on visibility before adding session actions.

Long term, Lazy AI can become a small command center for local AI workflows: review previous sessions, understand context pressure, jump between projects, and eventually start or manage assistant work from one place.

## Installation

### From Source

Requirements:

- Node.js
- npm
- Existing Codex session data under `~/.codex`

Clone the repository and install dependencies:

```sh
git clone <repo-url>
cd lazy-ai
npm install
```

Run the development version:

```sh
npm run dev
```

Build the project:

```sh
npm run build
```

Run the built output:

```sh
npm start
```

Type-check without emitting files:

```sh
npm run check
```

### Future npm Package

Lazy AI is not on npm yet. Once published, the intended install flow will look like:

```sh
npm install -g lazyai
```

Then run it from any project directory:

```sh
lazyai
```

The current package name is already `lazy-ai`, but public package availability is still planned.

## Usage

Start Lazy AI from a project directory:

```sh
npm run dev
```

The app opens a terminal interface with project, session, context, detail, status, and keybinding panels.

Keybindings currently used by the app:

| Key | Action |
| --- | --- |
| `h` / left | Previous panel |
| `l` / right | Next panel |
| `j` / down | Next item in a focused list |
| `k` / up | Previous item in a focused list |
| `?` | Open help |
| `q` | Quit |

## Project Status

Lazy AI is in an early `0.0.x` stage. The core terminal shell and local session readers are in place, while richer session details and write actions are still being built.

Current focus:

- Reliable local Codex project/session discovery.
- Clear terminal layout for browsing session state.
- Token and usage-limit visibility.
- Keyboard-first navigation.

Planned areas:

- Fuller transcript and tool-activity detail views.
- Actions for creating or managing sessions.
- Packaged CLI distribution through npm.
- More screenshots, demo GIFs, and usage examples.

## Tech Stack

- TypeScript
- Node.js
- [`@b9g/termdom`](https://www.npmjs.com/package/@b9g/termdom) for terminal DOM rendering
- Local JSONL readers for Codex session data

## Development

Useful scripts:

```sh
npm run dev      # run from TypeScript with tsx
npm run build    # compile with TypeScript
npm run start    # run dist/index.js
npm run check    # type-check only
```

The app entry point is `index.ts`. The terminal page is assembled in `src/pages/home.ts`, with UI panels under `src/components` and Codex data readers under `src/repositories`.

## Image Slots

Use these slots when adding visual assets:

- `docs/images/lazy-ai-dashboard.png` - main dashboard screenshot.
- `docs/images/lazy-ai-navigation.gif` - short keyboard navigation demo.
- `docs/images/lazy-ai-context.png` - context and token usage close-up.
- `docs/images/lazy-ai-help.png` - help modal screenshot.

Suggested README placement:

<!-- Add a context/token usage screenshot here later. -->

![Lazy AI context placeholder](docs/images/lazy-ai-context.png)

<!-- Add a help modal screenshot here later. -->

![Lazy AI help placeholder](docs/images/lazy-ai-help.png)

## License

ISC
