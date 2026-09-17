# Lazy AI

A keyboard-first terminal UI for working with **Claude Code and Codex** sessions.

Browse projects and conversations, pick a provider and model, and start or continue assistant work from one dashboard. Lazy AI reads your local session history and connects to the providers' runtimes when you run session actions.

> Early development (`0.0.1`). Run from source using the instructions below; the repository does not yet configure a global `lazyai` command.

<!-- Once the asset exists, uncomment this preview:
![Lazy AI: browsing projects, resuming a session, and switching providers](docs/images/lazy-ai-demo.gif)
-->

## Features

- **Two providers:** Claude Code and Codex, with a shared provider and model picker.
- **Project browsing:** discover projects from saved sessions and select which project's history to view.
- **Conversation details:** read persisted messages with Markdown rendering and keyboard scrolling; the view refreshes while a response runs.
- **Session actions:** start a session, resume saved work, send follow-up prompts, or interrupt a response.
- **Context visibility:** inspect session metadata and token usage when available, plus persisted usage-limit snapshots for Codex.
- **Tool permissions:** approve or deny Claude Code tool requests inside the terminal.
- **Session deletion:** delete Codex sessions after confirmation.

## Getting Started

You need Node.js, npm, and a configured Claude Code or Codex installation. Authenticate with the provider you intend to use before running session actions. Codex actions require the `codex` executable to be available; Claude Code actions use the bundled Agent SDK and can use an installed `claude` executable.

```sh
git clone https://github.com/RafaelOviedo/lazy-ai.git
cd lazy-ai
npm install
npm run dev
```

To build and run the compiled app:

```sh
npm run build
npm start
```

The app uses its working directory as the initial project path. To launch the built app from another project:

```sh
cd /path/to/your/project
node /path/to/lazy-ai/dist/index.js
```

Existing history populates the project and session lists. You can also start a new session in the initial directory when there is no saved history.

## Workflow

1. Lazy AI detects local providers at startup, preferring one with authentication and saved history.
2. Press `m` to open the provider and model picker. Move with `j` / `k` or the up/down arrows, then press `Enter` to select a model.
3. Move between panels with `h` and `l`. In **Projects**, highlight a project and press `Space` to load its sessions.
4. In **Sessions**, move freely with `j` / `k` or the arrow keys, then press `w` to open the highlighted session's conversation in **Details**. Press `Space` to resume it, or `n` to start a new session in the selected project.
5. Press `p` to send a follow-up to the active session. Enter your prompt and press `Enter` to submit; use `Ctrl+J` for a new line.
6. Follow the response in **Details**. Press `i` to interrupt it, or `q` to quit.

Prompting targets the session you started or resumed. Moving the highlight updates session metadata and leaves the opened conversation and its scroll position in place. Pressing `w` opens a conversation without making it the active session or moving keyboard focus. Starting or resuming a session, or submitting a follow-up prompt, opens that session's conversation so you can follow its response. Switching projects clears Details. Provider and model selections last for the current app process; switching rebuilds the dashboard, so resume a session again before prompting it.

### Keyboard Shortcuts

Dashboard shortcuts apply while no modal is open.

| Key | Where | Action |
| --- | --- | --- |
| `h` / `l` | Dashboard | Focus the previous / next panel |
| `j` / `k` or `↓` / `↑` | Sessions, Projects | Highlight the next / previous item |
| `Space` | Projects | Select the highlighted project and load its sessions |
| `Space` | Sessions | Resume the highlighted session |
| `w` | Sessions | Open the highlighted conversation; retry a failed load |
| `n` | Dashboard | Open a new-session prompt for the selected project |
| `p` | Dashboard | Open a follow-up prompt for the active session |
| `i` | Dashboard | Interrupt the response being generated |
| `d` | Sessions | Open the delete confirmation for the highlighted Codex session |
| `m` | Dashboard | Open the provider and model picker |
| `j` / `k` or `↓` / `↑` | Details | Scroll down / up |
| `PageDown` / `PageUp` | Details | Scroll down / up in larger steps |
| `Home` / `End` | Details | Jump to the top / bottom of the conversation |
| `?` | Dashboard | Open keybinding help |
| `q` | Dashboard | Quit |
| `j` / `k` or `↓` / `↑` | Model picker, tool permissions | Move between choices |
| `Enter` | Prompts, picker, confirmations | Submit the prompt or confirm the selected action |
| `Ctrl+J` | Prompt input | Insert a new line |
| `Esc` | Modals | Cancel or close; deny a pending tool permission request |

### Claude Code Tool Permissions

When Claude Code requests permission to run a tool, Lazy AI opens a modal with the tool details. Choose **Allow once**, **Allow for the rest of this session** when offered, or **Deny**, then press `Enter`. Pressing `Esc` denies the request. Session-wide approval is only offered when the request supports it.

## Providers and Local Data

| Capability | Claude Code | Codex |
| --- | --- | --- |
| Browse projects, sessions, and conversations | Yes | Yes |
| Start, resume, prompt, and interrupt | Yes | Yes |
| Provider and model selection | Yes | Yes |
| Delete sessions | Not supported | Yes, with confirmation |
| Tool permission modal | Yes | Not implemented |
| Token/context information | When present in transcripts | When present in transcripts |
| Usage-limit snapshots | Not available | When present in saved telemetry |

Session history is read from these locations:

| Provider | Default history location | Data-directory override |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | `CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex/session_index.jsonl` and `~/.codex/sessions/**/*.jsonl` | `CODEX_HOME` |

Browsing history reads local files. Starting or prompting sessions communicates with the selected provider through the Claude Agent SDK or Codex app-server and uses that provider's authentication. Displayed context and usage information comes from saved records and may lag behind the provider's current state.

Model choices come from local provider metadata. A missing model list can reflect missing or stale provider data. Authentication detection checks local credential files and API-key environment variables; it does not validate credentials with the provider.

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run TypeScript directly with `tsx` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run `dist/index.js` |
| `npm run check` | Type-check without emitting files |

The app uses TypeScript, Node.js, [`@b9g/termdom`](https://www.npmjs.com/package/@b9g/termdom), and the Claude Agent SDK.

```text
index.ts          Terminal setup, startup detection, and rendering
src/app/          Provider registry and shared app configuration
src/entities/     Session, project, provider, and model types and state
src/features/     Session actions and tool-approval coordination
src/providers/    Claude Code and Codex readers and runtime clients
src/components/   Terminal panels and modals
src/pages/        Dashboard composition and keyboard shortcuts
src/shared/       Rendering, paths, process, and modal helpers
```

## Adding Screenshots and Demo GIFs

Record a short video, trim it, then convert it to a GIF. For a first demo, aim for 10–20 seconds showing project selection, a resumed session, and the provider picker. Use a readable terminal font and crop the recording to the app.

On macOS, press `Shift+Command+5`, choose **Record Selected Portion**, and record the terminal area. See [Apple's screen-recording instructions](https://support.apple.com/en-us/102618).

With [FFmpeg](https://ffmpeg.org/download.html) installed, run this from the repository root, replacing `recording.mov` with your recording's path:

```sh
mkdir -p docs/images
ffmpeg -ss 0 -t 15 -i recording.mov \
  -filter_complex "[0:v]fps=12,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" \
  -loop 0 docs/images/lazy-ai-demo.gif
```

This takes the first 15 seconds, scales to 1,000 pixels wide at 12 fps, and creates a looping GIF. The [`palettegen` and `paletteuse` filters](https://ffmpeg.org/ffmpeg-filters.html#palettegen) create and apply a color palette. Adjust `-ss` for the starting time and `-t` for the duration; reduce width or frame rate if the result is too large. Aim for a few megabytes while keeping terminal text readable.

Commit the GIF, then uncomment the preview near the top of this README or add:

```md
![Lazy AI: browsing projects, resuming a session, and switching providers](docs/images/lazy-ai-demo.gif)
```

Screenshots work the same way:

```md
![Lazy AI dashboard](docs/images/lazy-ai-dashboard.png)
```

Only add an image link once its file exists. GitHub resolves these [relative image paths](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#relative-links) within the repository. Keep the original recording for future edits; it does not need to be committed.

## License

ISC
