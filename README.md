# Kova Desktop (PoC)

Thin Electron shell around the existing web app — **no port, no web changes**.

| What | How |
|---|---|
| Notifications | Native OS notifications fed by the **same SSE stream the web app already keeps open** (`/notification/stream`) — no push provider, no Firefox delays, no macOS web-push failures. |
| Window | Chromium loads the deployed app (configurable via `KOVA_APP_URL`). |
| Tray | Icon with "Open Kova", "Launch at login" toggle, Quit. |
| Close-to-tray | Closing the window hides it; Quit happens from the tray/menu. |
| Call room | `window.open` (the meeting opens in a new tab today) is intercepted → new Electron window. WebRTC works as-is (same Chromium engine). Screen share needs macOS **Screen Recording** permission (System Preferences). |
| External links | Always opened in the system browser, never inside the app window. |

## How the notification shim works (zero web changes)

1. The web app (as soon as you're logged in) keeps an SSE stream to `/notification/stream` and dispatches each event on `window` as a `CustomEvent("kova:realtime")` (`useRealtime` → `realtimeEvents.ts`).
2. `preload.cjs` injects a small script into the page's **main world** that listens to that bus.
3. On a `NOTIFICATION` event it builds a native notification kit (`actorName` + type label, same labels as `Notification.entity.ts`) and calls `window.desktop.notify(...)`.
4. `main.cjs` receives it over IPC and shows the OS notification. Clicking focuses the window.

Notifications are only shown when the window is **not focused** (the in-app bell covers the focused case) and only from the **main window** (the call window doesn't double-notify).

## Run (dev)

```bash
cd desktop
npm install
npm start                        # loads https://kova.cesar.wearemateria.com
KOVA_APP_URL=http://localhost:3000 npm start   # or your dev frontend
```

Requirements: Node 18+ (Electron downloads its own Chromium; no dev deps of the web app needed — the web app runs deployed).

### Arch Linux — skip the npm download entirely

Some npm versions (npm 12+) **block the Electron postinstall** that downloads
Chromium, leaving `npm start` dead with "Electron failed to install correctly".
The Arch way around it — use the distro's Electron, no download at all:

```bash
sudo pacman -S electron     # system Electron (official repos)
npm start:system            # uses /usr/lib/electron instead of the missing binary
```

(If `npm start` still fails on another distro, run
`node node_modules/electron/install.js` once by hand to fetch the binary, or
point `ELECTRON_OVERRIDE_DIST_PATH` at your distro's Electron.)

## Build installers

```bash
npm run dist:mac     # → dist/Kova-<version>.dmg   (needs macOS)
npm run dist:win     # → dist/Kova Setup <version>.exe (needs Windows or wine)
npm run dist:linux   # → dist/Kova-<version>.AppImage
```

## Honest limitations (PoC)

- **Not signed**: macOS Gatekeeper / Windows SmartScreen will warn until you add
  signing (Apple Developer $99/yr + notarization; Windows cert ~$200–300/yr).
- **No auto-update yet**: next step is `electron-updater` with a static feed you
  can host on cPanel (same zips you already upload).
- The label/actor mapping is a static copy in `preload.cjs`. The permanent
  integration (once the PoC proves itself) is calling `window.desktop?.notify(...)`
  from the web app where notifications are created — then the labels live in one
  place and the shell stops parsing the bus.
- Web push subscriptions are irrelevant here: the desktop app doesn't use them.
  Web users keep the existing push flow untouched.
- Linux tray needs a desktop environment with a tray/StatusNotifier (KDE/GNOME
  extension); notifications need `libnotify`.
- Logged-in session storage is the web app's own (`localStorage`/IndexedDB in
  this Electron profile). A v2 upgrade: encrypt tokens with Electron `safeStorage`
  (OS keychain) and scope the session to `app.getPath("userData")`.

## Roadmap (if the pilot sticks)

1. Sign + notarize, `electron-updater` on cPanel.
2. `safeStorage` for tokens, custom protocol `kova://call/<id>` deep links.
3. Badge/tray unread count (the app already knows `unreadCount`).
4. Bundle the `next` standalone build locally instead of loading the URL (faster first paint, offline shell).