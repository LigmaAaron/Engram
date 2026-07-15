# Engram

A local-first daily planner with an in-browser chat agent, backed by Ollama.

## Install

```
curl -fsSL https://raw.githubusercontent.com/LigmaAaron/Engram/main/install.sh | bash
```

Clones the repo to `~/Engram`, installs Ollama if needed, pulls a qwen3.5
model sized to your Mac's RAM and chip, then builds and launches the Engram
menu bar app.

macOS only.

## Extensions

Widgets/pages can be installed at runtime from git repos via the Extensions
page. To build one, start from
[engram-extension-template](https://github.com/LigmaAaron/engram-extension-template).
