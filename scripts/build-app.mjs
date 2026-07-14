// Builds dist/Engram.app: a launcher bundle, not an Electron app — the
// "app" is the existing browser page, this just starts the dev server
// (which already boots Ollama via predev), opens it in the default browser,
// and puts a menu bar icon up with a "Stop Engram" item. Runs as a
// background agent — no Dock tile, no app menu.
// ponytail: hardcodes this machine's project path. Personal single-Mac tool,
// not meant to run standalone on another machine — add relocatable pathing
// (Contents/Resources copy of the repo) if that ever changes.
import { mkdir, writeFile, chmod, rm, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'

const PROJECT_DIR = process.cwd()
const APP = 'dist/Engram.app'
// Apps launched from inside ~/Documents get a restricted sandbox applied
// by macOS that breaks child-process cwd access (confirmed: identical
// bundle launched from ~/Applications works, from dist/ under Documents
// doesn't). So the runnable copy lives in ~/Applications; dist/Engram.app.zip
// stays the release artifact.
const INSTALLED_APP = `${homedir()}/Applications/Engram.app`
const PORT = 5173

// The whole app is this JXA (JavaScript for Automation) script. osacompile
// (below) turns it into a real applet bundle whose executable lives *inside*
// Engram.app — that's what makes macOS name it "Engram" and host a menu bar
// status item.
// ponytail: earlier tries — a bash launcher that spawned `osascript … &`,
// and a `#!/usr/bin/osascript` shebang script as the bundle executable —
// both failed: the shebang makes /usr/bin/osascript (outside the bundle) the
// real process, so macOS can't tie it back to Engram.app and calls it
// "osascript" in the Dock/menu bar. osacompile keeps the executable in the
// bundle, which fixes the identity.
const SCRIPT = `function run() {
  var PROJECT_DIR = '${PROJECT_DIR}'
  var PORT = ${PORT}
  var ICON_PATH = PROJECT_DIR + '/public/menubar-icon.svg'
  var LOG_PATH = '/tmp/Engram.log'

  var se = Application.currentApplication()
  se.includeStandardAdditions = true

  function shq(s) { return "'" + s.replace(/'/g, "'\\\\''") + "'" }
  function sh(cmd) {
    try { return se.doShellScript(cmd) } catch (e) { return '' }
  }

  // Kill any previous instance still holding the port (e.g. a launch that
  // didn't get a clean quit) so we always start fresh instead of just
  // reattaching to whatever's running.
  sh('lsof -ti tcp:' + PORT + ' | xargs -r kill 2>/dev/null; sleep 1')

  // Finder launches apps with a minimal PATH (no ~/.local/bin, no Homebrew) —
  // add the usual node/npm install locations. Start the dev server detached
  // and capture its pid so Stop/Quit can kill it.
  var devPid = sh(
    'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; ' +
    'cd ' + shq(PROJECT_DIR) + ' && (npm run dev >' + LOG_PATH + ' 2>&1 & echo $!)'
  ).trim()

  function killServer() {
    sh('pkill -P ' + devPid + ' 2>/dev/null; kill ' + devPid + ' 2>/dev/null; lsof -ti tcp:' + PORT + ' | xargs -r kill 2>/dev/null')
  }

  for (var i = 0; i < 60; i++) {
    if (sh('curl -s -o /dev/null -w "%{http_code}" http://localhost:' + PORT + ' || true') === '200') break
    delay(0.5)
  }
  sh('open http://localhost:' + PORT)

  // Deferred until after all the shell work: loading AppKit spins up
  // background threads, and forking (doShellScript) in an already-Cocoa'd
  // process corrupts the child (npm crashed with uv_cwd EPERM). Import it
  // only once we're done forking.
  ObjC.import('AppKit')

  ObjC.registerSubclass({
    name: 'EngramMenuDelegate',
    methods: {
      'open:': {
        types: ['void', ['id']],
        implementation: function () { sh('open http://localhost:' + PORT) },
      },
      'quit:': {
        types: ['void', ['id']],
        implementation: function () { killServer(); $.NSApplication.sharedApplication.terminate(this) },
      },
      'applicationWillTerminate:': {
        types: ['void', ['id']],
        implementation: function () { killServer() },
      },
    },
  })

  var delegate = $.EngramMenuDelegate.alloc.init
  var app = $.NSApplication.sharedApplication
  app.delegate = delegate
  // Accessory: no Dock tile, no app menu — pure menu bar agent.
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory)

  // Template mode makes AppKit auto-recolor the icon black/white to match
  // the menu bar's light/dark state — no theme detection needed here.
  var item = $.NSStatusBar.systemStatusBar.statusItemWithLength(-1)
  var icon = $.NSImage.alloc.initByReferencingFile(ICON_PATH)
  icon.setTemplate(true)
  icon.setSize($.NSMakeSize(18, 18))
  item.button.image = icon

  var menu = $.NSMenu.alloc.init
  var openItem = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Open Engram', 'open:', '')
  openItem.target = delegate
  menu.addItem(openItem)
  var quitItem = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Quit', 'quit:', '')
  quitItem.target = delegate
  menu.addItem(quitItem)
  item.menu = menu

  app.run
}
`

// Compile the script into a proper applet bundle.
await rm(APP, { recursive: true, force: true })
const scriptFile = `${tmpdir()}/engram-menubar.jxa`
await writeFile(scriptFile, SCRIPT)
await mkdir('dist', { recursive: true })
execSync(`osacompile -l JavaScript -o ${APP} ${scriptFile}`)
await rm(scriptFile, { force: true })

// Copy app icon if it exists, and point the bundle at it.
const iconKey = existsSync('public/AppIcon.icns')
  ? '\n  <key>CFBundleIconFile</key><string>AppIcon</string>'
  : ''
if (existsSync('public/AppIcon.icns')) {
  await copyFile('public/AppIcon.icns', `${APP}/Contents/Resources/AppIcon.icns`)
}

// Replace osacompile's stock Info.plist: give it Engram's identity and mark
// it a background agent (LSUIElement). CFBundleExecutable must stay "applet"
// — that's the compiled binary osacompile produced.
await writeFile(`${APP}/Contents/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Engram</string>
  <key>CFBundleIdentifier</key><string>com.aaronchen.engram</string>
  <key>CFBundleExecutable</key><string>applet</string>${iconKey}
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleSignature</key><string>aplt</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Engram starts and stops its local dev server.</string>
</dict>
</plist>
`)

// Re-sign: editing Info.plist invalidates osacompile's adhoc signature.
execSync(`codesign --force --sign - ${APP} 2>/dev/null || true`)

execSync(`cd dist && rm -f Engram.app.zip && zip -qr Engram.app.zip Engram.app`)

await rm(INSTALLED_APP, { recursive: true, force: true })
await mkdir(`${homedir()}/Applications`, { recursive: true })
execSync(`cp -R ${APP} "${INSTALLED_APP}"`)

console.log(`built ${APP} and ${APP}.zip, installed to ${INSTALLED_APP}`)
