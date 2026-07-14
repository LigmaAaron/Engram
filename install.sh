#!/bin/bash
# Sets up Engram on a fresh Mac: installs Ollama (with confirmation), pulls a
# qwen3.5 size matched to this machine's RAM/chip, then builds the menu bar app.
# Meant to be run via `curl ... | bash` — clones the repo itself, no manual
# git clone needed.
# ponytail: macOS-only, matches scripts/build-app.mjs which is already
# macOS-only (osacompile/JXA).
set -e

cat <<'LOGO'
▗▄▄▄▖▗▖  ▗▖ ▗▄▄▖▗▄▄▖  ▗▄▖ ▗▖  ▗▖
▐▌   ▐▛▚▖▐▌▐▌   ▐▌ ▐▌▐▌ ▐▌▐▛▚▞▜▌
▐▛▀▀▘▐▌ ▝▜▌▐▌▝▜▌▐▛▀▚▖▐▛▀▜▌▐▌  ▐▌
▐▙▄▄▖▐▌  ▐▌▝▚▄▞▘▐▌ ▐▌▐▌ ▐▌▐▌  ▐▌
LOGO

[ "$(uname -s)" = "Darwin" ] || { echo "Engram only runs on macOS."; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required (xcode-select --install), then re-run."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Node.js/npm is required: https://nodejs.org"; exit 1; }

REPO_DIR="$HOME/Engram"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" pull --ff-only
else
  git clone https://github.com/LigmaAaron/Engram.git "$REPO_DIR"
fi
cd "$REPO_DIR"

ARCH=$(uname -m)
RAM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))

# Tiers are qwen3.5's real published tags (ollama.com/library/qwen3.5).
TIERS=(0.8b 2b 4b latest 27b 35b)
i=0
[ "$RAM_GB" -ge 16 ] && i=1
[ "$RAM_GB" -ge 24 ] && i=2
[ "$RAM_GB" -ge 36 ] && i=3
[ "$RAM_GB" -ge 72 ] && i=4
[ "$RAM_GB" -ge 128 ] && i=5
# Intel Macs get no Metal acceleration from Ollama — drop a tier so it stays usable.
if [ "$ARCH" != "arm64" ] && [ "$i" -gt 0 ]; then i=$((i - 1)); fi
MODEL="qwen3.5:${TIERS[$i]}"

echo "Detected: $ARCH, ${RAM_GB}GB RAM -> pulling $MODEL"

if ! command -v ollama >/dev/null 2>&1; then
  read -p "Ollama isn't installed. Install it now via the official installer (ollama.com/install.sh)? [y/N] " yn
  [ "$yn" = "y" ] || [ "$yn" = "Y" ] || { echo "Ollama is required. Aborting."; exit 1; }
  curl -fsSL https://ollama.com/install.sh | sh
fi

ollama pull "$MODEL"

npm install
node scripts/build-app.mjs

echo "Done. Engram is in the menu bar. If $MODEL isn't the default model, pick it from the Settings dropdown in the app."
