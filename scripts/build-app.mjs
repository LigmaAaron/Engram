// Builds dist/AaronOS.app: a launcher bundle, not an Electron app — the
// "app" is the existing browser page, this just starts the dev server
// (which already boots Ollama via predev) and opens it in the default browser.
// ponytail: hardcodes this machine's project path. Personal single-Mac tool,
// not meant to run standalone on another machine — add relocatable pathing
// (Contents/Resources copy of the repo) if that ever changes.
import { mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import { execSync } from 'node:child_process'

const PROJECT_DIR = process.cwd()
const APP = 'dist/AaronOS.app'
const PORT = 5173

await rm(APP, { recursive: true, force: true })
await mkdir(`${APP}/Contents/MacOS`, { recursive: true })

await writeFile(`${APP}/Contents/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>AaronOS</string>
  <key>CFBundleIdentifier</key><string>com.aaronchen.aaronos</string>
  <key>CFBundleExecutable</key><string>AaronOS</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><false/>
</dict>
</plist>
`)

await writeFile(`${APP}/Contents/MacOS/AaronOS`, `#!/bin/bash
cd "${PROJECT_DIR}" || { osascript -e 'display alert "AaronOS" message "Project folder not found at ${PROJECT_DIR}"'; exit 1; }

if ! curl -s -o /dev/null "http://localhost:${PORT}"; then
  nohup npm run dev >/tmp/aaronos.log 2>&1 &
fi

for i in $(seq 1 60); do
  curl -s -o /dev/null "http://localhost:${PORT}" && break
  sleep 0.5
done

open "http://localhost:${PORT}"
`)
await chmod(`${APP}/Contents/MacOS/AaronOS`, 0o755)

execSync(`cd dist && zip -qr AaronOS.app.zip AaronOS.app`)
console.log(`built ${APP} and ${APP}.zip`)
