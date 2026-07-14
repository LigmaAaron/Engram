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

# A couple quick questions to personalize the assistant. `curl | bash` means
# stdin is the piped script itself, not the terminal — read from /dev/tty.
echo
echo "What will you mainly use Engram for?"
echo "  1) Student"
echo "  2) Developer"
echo "  3) Writer"
echo "  4) General / other"
read -p "> " uc </dev/tty
case "$uc" in
  1) USE_CASE=student ;;
  2) USE_CASE=developer ;;
  3) USE_CASE=writer ;;
  *) USE_CASE=general ;;
esac

echo
echo "How should the AI assistant talk to you?"
echo "  1) Detailed explanations"
echo "  2) Direct answers"
echo "  3) Concise / terse"
read -p "> " st </dev/tty
case "$st" in
  1) STYLE=detailed ;;
  3) STYLE=concise ;;
  *) STYLE=direct ;;
esac

node -e "
const fs = require('fs')
const path = 'data/state.json'
let s = {}
try { s = JSON.parse(fs.readFileSync(path, 'utf8')) } catch {}
s.settings = { ...(s.settings || {}), useCase: '$USE_CASE', style: '$STYLE' }
if (!s.links) {
  const sets = {
    student:   [['Gmail','https://mail.google.com','Mail'],['Classroom','https://classroom.google.com','ExternalLink'],['Calendar','https://calendar.google.com','Calendar'],['Drive','https://drive.google.com','Folder'],['Docs','https://docs.google.com','ExternalLink']],
    developer: [['GitHub','https://github.com','Terminal'],['Gmail','https://mail.google.com','Mail'],['Calendar','https://calendar.google.com','Calendar'],['Drive','https://drive.google.com','Folder'],['Docs','https://docs.google.com','ExternalLink']],
    writer:    [['Gmail','https://mail.google.com','Mail'],['Docs','https://docs.google.com','ExternalLink'],['Calendar','https://calendar.google.com','Calendar'],['Drive','https://drive.google.com','Folder'],['Notion','https://notion.so','ExternalLink']],
    general:   [['Gmail','https://mail.google.com','Mail'],['GitHub','https://github.com','Terminal'],['Calendar','https://calendar.google.com','Calendar'],['Drive','https://drive.google.com','Folder'],['Chat','https://chat.google.com','Message']],
  }
  s.links = (sets['$USE_CASE'] || sets.general).map(([label, url, icon]) => ({ label, url, icon }))
}
fs.mkdirSync('data', { recursive: true })
fs.writeFileSync(path, JSON.stringify(s))
"

ARCH=$(uname -m)
RAM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
FREE_GB=$(df -g "$HOME" | awk 'NR==2{print $4}')

# Tags are qwen3.5's real published sizes (ollama.com/library/qwen3.5), each
# with the min RAM it's comfortable at and its approximate download size.
# Apple Silicon's unified memory + Metal acceleration runs a given size on
# noticeably less RAM than Intel's CPU-only path, so they get separate
# ladders rather than one ladder with an Intel penalty.
if [ "$ARCH" = "arm64" ]; then
  TIERS=(4b latest 27b 35b 122b)
  MINRAM=(8 16 32 64 128)
  SIZES_GB=(4 7 17 24 81)
else
  TIERS=(0.8b 2b 4b latest 27b)
  MINRAM=(8 16 32 64 128)
  SIZES_GB=(1 3 4 7 17)
fi

i=-1
for idx in "${!MINRAM[@]}"; do
  [ "$RAM_GB" -ge "${MINRAM[$idx]}" ] && i=$idx
done
# Drop further (or disable AI entirely) until the model actually fits on
# disk, +2GB buffer for Ollama itself and everything else.
while [ "$i" -ge 0 ] && [ "$FREE_GB" -lt "$(( SIZES_GB[i] + 2 ))" ]; do i=$((i - 1)); done

if [ "$i" -lt 0 ]; then
  echo "Sorry, your device isn't capable of AI-powered features on Engram (needs 8GB+ RAM and a few GB of free disk space). Installing without AI."
  npm install
  node scripts/build-app.mjs
  echo "Done. Engram is in the menu bar — AI chat is unavailable on this device."
  exit 0
fi

MODEL="qwen3.5:${TIERS[$i]}"
echo "Detected: $ARCH, ${RAM_GB}GB RAM, ${FREE_GB}GB free disk -> pulling $MODEL"

if ! command -v ollama >/dev/null 2>&1; then
  read -p "Ollama isn't installed. Install it now via the official installer (ollama.com/install.sh)? [y/N] " yn </dev/tty
  [ "$yn" = "y" ] || [ "$yn" = "Y" ] || { echo "Ollama is required. Aborting."; exit 1; }
  curl -fsSL https://ollama.com/install.sh | sh
fi

ollama pull "$MODEL"

npm install
node scripts/build-app.mjs

echo "Done. Engram is in the menu bar. If $MODEL isn't the default model, pick it from the Settings dropdown in the app."
