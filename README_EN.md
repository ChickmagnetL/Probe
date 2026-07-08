<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/icons/probe-logo-white-on-black.svg">
    <img src="./assets/icons/probe-logo-black-on-white.svg" alt="Probe" width="120">
  </picture>
</p>

<h1 align="center">Probe</h1>

<p align="center">
  English | <a href="./README.md">中文</a>
</p>

<p align="center">
  A readable home for your AI coding assistant session logs.<br/>
  Import sessions from Codex CLI and Claude Code, and replay every interaction through a visual interface.
</p>

<p align="center">
  <a href="https://github.com/ChickmagnetL/Probe/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/ChickmagnetL/Probe?style=flat-square"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-4A4A55?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square">
  <img alt="Built with Tauri" src="https://img.shields.io/badge/built%20with-Tauri%20v2-orange?style=flat-square">
</p>

---

## Why Probe

You use AI coding assistants like Codex CLI and Claude Code every day. They leave behind endless `.jsonl` session logs under `~/.codex` and `~/.claude` — but every time you want to look back, you're staring at tens of thousands of lines of raw JSON:

- What exactly did the AI do to fix that bug last time? Which tools did it call?
- How many tokens did this conversation cost? Where did it get stuck?
- How was a subagent dispatched, and what did it return?

**Probe turns those logs into an interface you can browse, search, and replay.** 

## Demo

https://github.com/user-attachments/assets/df564ce2-fa9c-4d70-acca-425f287938ad

## Core Features

**Multi-platform session import**
Currently supports Codex CLI and Claude Code. Import a single file, a whole directory, or let the app auto-scan and incrementally import.

**Graph view**
A node graph lays out the full flow of a conversation — user input, model replies, tool calls, command execution, subagent spawns — so the entire chain is visible at a glance. Node types can be filtered on demand.

![Graph view](./assets/graph.png)

**Timeline**
Browse events in the order they happened, and jump to any single step.

![Timeline view](./assets/timeline.png)

**Chat view**
Review the complete interaction between model and user in a familiar chat layout.

![Chat view](./assets/chat.png)

**Raw view**
The original `.jsonl` file, pretty-printed as JSON for easier inspection of the raw data.

![Raw view](./assets/raw.png)

**Multi-session management**
Sessions organized by project and date, with search and sorting. Session details are cached for instant access.

<p align="center">
  <img src="./assets/session.png" alt="Multi-session management" width="50%">
</p>

**Split view**
Split into up to four panes to preview and compare four different views at once. Click a node in one view, and the others jump to follow.

![Split view](./assets/split-screen.png)

---

## Installation

### macOS

**Option 1: Homebrew (recommended)**

```bash
brew install ChickmagnetL/probe/probe
```

The Homebrew build has the Gatekeeper quarantine attribute stripped, so it opens right after install.

Upgrade / uninstall:

```bash
brew upgrade probe
brew uninstall probe
```

**Option 2: GitHub Release DMG**

Download the `.dmg` from the [latest release](https://github.com/ChickmagnetL/Probe/releases/latest/download/Probe_aarch64.dmg):

1. Open the DMG and drag `Probe.app` into `/Applications`
2. If the first launch says the app is "damaged", that's Gatekeeper blocking it. Run this in the terminal:
   ```bash
   xattr -cr /Applications/Probe.app
   ```
3. Launch it again and it will open

### Windows

Download the `.exe` installer from the [latest release](https://github.com/ChickmagnetL/Probe/releases/latest/download/Probe_x64-setup.exe).

---

## Quick Start

1. Import a single session file you want to review, a folder of session files, or just wait for the app to auto-sync Codex CLI and Claude Code sessions on your machine.
2. Once imported, click a session in the sidebar list to start previewing.

---

## Tech Stack

Probe is a Tauri v2 desktop app with three layers:

| Layer | Tech | Responsibility |
|-------|------|----------------|
| Engine | Python | Parse JSONL, persist to SQLite, serve queries |
| Shell | Rust / Tauri v2 | Native window, IPC dispatch, manage engine subprocess |
| UI | React + TypeScript + Tailwind | Visual interface, interaction, local state |

See [`docs/`](./docs/) for more detailed technical documentation.

---

## Contributing

Issues for bugs and feature requests, and pull requests are all welcome.

Local development:

```bash
git clone https://github.com/ChickmagnetL/Probe.git
cd Probe

# 1. Install frontend dependencies
cd frontend && npm install && cd ..

# 2. Build the Python engine sidecar (requires Python ≥ 3.10 and pyinstaller)
./build.sh sidecar

# 3. Start desktop dev mode (spins up frontend, Rust shell, and engine together)
cd tauri && cargo tauri dev
```

Prerequisites: Node.js, Rust (with Tauri CLI), Python ≥ 3.10 and `pyinstaller`.

See [`docs/architecture.md`](./docs/architecture.md) for the full development guide.

## License

MIT

## Acknowledgements

The [Linux.Do](https://linux.do/) community
