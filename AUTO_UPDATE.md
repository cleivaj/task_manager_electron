# Auto-update de Kova Desktop

> Referencia del sistema de actualización de la app de escritorio (shell Electron).
> Fecha: 2026-09-03 · Aplica al repo `cleivaj/task_manager_electron` (carpeta `desktop/`).

## Resumen

| Plataforma | ¿Update silencioso? | Estado |
|---|---|---|
| Windows (NSIS `.exe`) | ✅ Sí | **Implementado** — `electron-updater` descarga en segundo plano y pide reiniciar (sin certificado; SmartScreen puede avisar) |
| Linux (AppImage) | ✅ Sí | **Implementado** — ídem, el AppImage se reemplaza a sí mismo |
| Linux (instalado por `.pacman`) | ❌ | Soft notifier (aviso + descarga del AppImage) — el paquete se actualiza con el gestor |
| macOS (DMG) | ❌ No sin firma | Soft notifier hasta tener **Developer ID + notarización** ($99/año) |
| macOS (App Store) | Sí, pero vía Apple | La misma suscripción $99/año + sandbox + review — no recomendado |

**Regla de oro:** en macOS no existe auto-update gratuito. El SO (Squirrel.Mac) exige
que la app esté firmada con Developer ID. No es una limitación nuestra: es una regla
de Apple. Hasta que se tenga el certificado, macOS usa el *soft update* (aviso +
descarga del nuevo DMG), que es lo que ya está implementado.

## Lo que ya está implementado (soft update, las 3 plataformas)

Arquitectura: **dos motores dentro del shell** + **GitHub Releases** como canal único.
El motor depende de la plataforma (lo decide `setupUpdaters()` en `main.cjs`):

| Motor | Dónde corre | Qué hace |
|---|---|---|
| `electron-updater` (auto silencioso) | **Windows empaquetado** y **Linux AppImage** | Descarga en segundo plano (diferencial por blockmap), y al terminar notifica *"Kova X downloaded — restart to install"* + item en el tray **Restart & update** → `quitAndInstall()` |
| `updater.cjs` (soft notifier) | **macOS**, **Linux pacman** y **desarrollo** (`npm start`) | Poll a `releases/latest` (repo público → sin token), avisa y descarga el instalador correcto (`.dmg` / `.AppImage`) |

### Piezas

| Fichero | Qué hace |
|---|---|
| `desktop/updater.cjs` | Soft notifier: check GitHub API, semver, descarga+abre el instalador por plataforma |
| `desktop/main.cjs` | `setupUpdaters()` elige el motor por plataforma; eventos de `electron-updater` (available → downloaded → quitAndInstall); reconstruye el menú del tray |
| `desktop/package.json` | Dep `electron-updater` + `build.publish` (provider github) → cada build embebe `app-update.yml` y genera `latest.yml` / `latest-linux.yml` + blockmaps |
| `.github/workflows/desktop-build.yml` | CI: build de **mac + windows + linux** en paralelo y publicación de **una GitHub Release** por versión (tag `v{package.json.version}`) con instaladores + metadatos de update |

### Comportamiento

- **Cadencia:** check al arrancar (+10–15 s), luego cada 6 h, y manual vía tray → **Check for updates…** (siempre disponible).
- **Windows / Linux AppImage (auto):** `update-available` → tray muestra *"Downloading Kova X…"*; al terminar → notificación nativa "Kova X downloaded — click to restart and install" + tray **Restart & update** → `quitAndInstall()`. Sin clicks extra: solo reiniciar cuando ya está listo.
- **macOS / Linux pacman / dev (soft):** versión nueva → notificación "Kova X is available — click to download" + tray **Download Kova X** + **Release notes**.
  - **macOS** → descarga el `.dmg` (Intel vs Apple Silicon según `process.arch`) y lo monta → arrastrar a Applications.
  - **Linux pacman** → descarga el `.AppImage` (`chmod +x`) y lo ejecuta.
- **Check manual sin update** → "You are up to date (X.Y.Z)" en ambos motores. En desarrollo (`npm start`) el motor es el soft (electron-updater no tiene feed fuera del build) y el check manual anuncia, para poder probar.

### Cómo publicar una versión nueva (el canal)

1. Subir `version` en `desktop/package.json` (hoy: `0.1.5`). **El tag nace de ahí** — sin bump, la Release tiene la misma versión que los instalados y nadie ve update.
2. Push a la rama **`prod`** (o Actions → "Desktop build" → Run workflow).
3. El CI construye las 3 plataformas y crea/actualiza la Release `vX.Y.Z` **incluyendo los metadatos de update** (`latest.yml`, `latest-linux.yml`, blockmaps) que `electron-updater` necesita para localizar y verificar la descarga. Si la Release ya existe (re-run sin bump), la actualiza con `--clobber`; no rompe.
4. Los instalados detectan la Release en ≤ 6 h (o al reiniciar, o con Check for updates…). Windows/Linux lo descargan en segundo plano; macOS avisa para descargar el DMG.

No hay secrets que configurar: la publicación usa el `GITHUB_TOKEN` del runner
(`permissions: contents: write`).

### Probar el flujo

```bash
cd desktop && npm start
```
Tray → **Check for updates…** → si la última Release es más nueva que la versión local,
aparece la notificación y la sección "Download Kova X" en el menú.

## macOS: las dos rutas hacia el update silencioso

Ambas rutas cuestan **lo mismo**: Apple Developer Program, **$99/año**. La diferencia es todo lo demás.

### Ruta A — Developer ID + notarización (recomendada)

- La app se sigue distribuyendo como DMG fuera de la App Store (tu modelo actual).
- Con la app firmada, **Squirrel.Mac** (el motor de `electron-updater` en macOS) reemplaza el `.app` en silencio, sirviendo updates desde **tu propio canal** (la misma GitHub Release).
- Es el modelo de Slack, Teams, Discord, VS Code: ninguno está en la App Store y todos se actualizan solos en Mac.
- **Bonus grande:** la notarización elimina el aviso "no se puede verificar que no hay malware" — se acaba el ritual de `xattr -dr` / clic derecho → Abrir de las primeras DMGs.
- Es 100% compatible con el shell actual (tray, close-to-tray, permisos de cámara/mic/pantalla).

### Ruta B — Mac App Store (MAS)

- El update lo gestiona la propia App Store (sin `electron-updater`).
- Exige **sandbox** y un build MAS aparte; el shell actual (tray, `setPermissionRequestHandler`, etc.) choca con el sandbox → reescrituras.
- **Revisión de Apple en cada versión** → cada release espera en cola.
- Mismo precio ($99/año) que la Ruta A, con más fricción. Solo tiene sentido si el objetivo comercial es estar en la store.

> La App Store **no** es la única vía de auto-update en Mac — es la más restrictiva de
> las dos formas de gastar los mismos $99.

## Lo que falta: macOS silencioso (cuando exista el certificado)

Windows y Linux ya están en auto silencioso. Para que macOS se sume:

1. Comprar Apple Developer Program ($99/año) y generar un certificado **Developer ID Application** (+ credenciales de notarización).
2. En el job `mac` del CI: activar firma + notarización (`CSC_LINK` / `CSC_KEY_PASSWORD`, y `APPLE_ID` + app-specific password o `APPLE_API_KEY`), y añadir **zip** al target de mac (Squirrel.Mac actualiza desde `.zip` + `latest-mac.yml`, no desde el `.dmg`).
3. En `main.cjs`: `setupUpdaters()` ya tiene el camino preparado — basta con que darwin deje de ir por el soft notifier y pase al branch de `electron-updater` (y que el CI suba `latest-mac.yml` + `.zip` a la Release).
4. El soft notifier queda como fallback y vía manual en todas las plataformas.

## Notas y lecciones anotadas

- **macOS Screen Recording** (10.15+): es un permiso TCC *separado* de cámara/mic. Se pide la primera vez que se comparte pantalla y macOS **exige reiniciar la app** tras concederlo. Si queda `denied`, no se puede re-preguntar por código — hay que activarlo en System Settings → Privacy & Security → Screen Recording (o `tccutil reset ScreenCapture`).
- **Cámara/mic en macOS**: requieren `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` en el Info.plist (ya en `build.mac.extendInfo`) + `askForMediaAccess` por código.
- **`askForMediaAccess` solo acepta `camera` y `microphone`** — pasar `"screen"` lanza `Invalid media type`. El permiso de pantalla lo dispara `desktopCapturer.getSources()`.
- **`display-capture` en el handler de permisos** solo trae `requestingUrl` (no `securityOrigin`) — el guard de origen debe usar ambos (bug real que mató el screen share en Windows).
- **Linux Wayland**: el screen share sale por PipeWire → se necesita `--enable-features=WebRTCPipeWireCapturer` + Wayland nativo (ya en `main.cjs`).
- **`.pacman` no se auto-actualiza**: el paquete de Arch se actualiza con el gestor (`sudo pacman -U`). El canal de updates es el **AppImage**.
- **Las notificaciones nativas del SO** (chat, tasks, calls) son cosa del shim en `preload.cjs` + el stream SSE de la web — **no dependen** del sistema de updates. Son dos mecanismos independientes.

## Referencias

- electron-builder — Auto Update: "Code signing is required on macOS": https://www.electron.build/docs/features/auto-update
- Electron — Code Signing: "Squirrel.Mac requires the app to be signed for automatic updates to work at all": https://electronjs.org/docs/latest/tutorial/code-signing
