"use strict";

// Kova desktop shell: carga la app web existente y añade la capa nativa —
// notificaciones del SO, tray, close-to-tray y permisos de media (cámara/mic/
// pantalla). APP_URL se configura con KOVA_APP_URL (default: producción).

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, net, shell, session, desktopCapturer, systemPreferences } = require("electron");
const path = require("node:path");
const updater = require("./updater.cjs");

const APP_URL = process.env.KOVA_APP_URL || "https://kova.cesar.wearemateria.com";
const APP_ORIGIN = () => { try { return new URL(APP_URL).origin; } catch { return APP_URL; } };
const RELEASES_URL = "https://github.com/cleivaj/task_manager_electron/releases";

// Wayland: el stream de pantalla sale por PipeWire vía xdg-desktop-portal, y
// Chromium solo lo usa corriendo en Wayland nativo con el capturador activado.
if (process.platform === "linux") {
    app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
    if (process.env.WAYLAND_DISPLAY) {
        app.commandLine.appendSwitch("ozone-platform-hint", "auto");
    }
}

let mainWindow = null;
let tray = null;
let trayIcon = null;
let updateInfo = null; // { version, url, notes, assets } — soft notifier (macOS/pacman/dev)
let manualCheck = null; // engine activo para el item "Check for updates…" según plataforma
let autoUpdaterApi = null; // electron-updater (Windows / Linux AppImage empaquetado)
let autoUpdateState = null; // { version, phase: "downloading" | "ready" } — auto-update

// Windows: las notificaciones nativas solo aparecen con AppUserModelID.
if (process.platform === "win32") {
    app.setAppUserModelId("com.wearemateria.kova");
}

function isAppUrl(url) {
    try {
        return new URL(url).origin === APP_ORIGIN();
    } catch {
        return false;
    }
}

// Debug solo visible en desarrollo (`npm start`, app sin empaquetar).
// Los builds empaquetados (dmg/exe/pacman) no imprimen nada.
const dbg = (...args) => {
    if (!app.isPackaged) console.log("[kova-debug]", ...args);
};

// En el navegador getUserMedia muestra el prompt de Chromium y el navegador ya
// tiene los permisos del SO. En Electron no hay prompt: el renderer pregunta al
// main process y si no concedemos, getUserMedia falla. Concedemos solo lo que la
// app usa y solo para el origin de la app.
function setupMediaPermissions() {
    const ses = session.defaultSession;

    // Comprobación síncrona (navigator.permissions.query, enumerateDevices…).
    ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        if (!isAppUrl(requestingOrigin)) return false;
        return permission === "media" || permission === "mediaKeySystem" || permission === "display-capture";
    });

    ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
        // `media` trae securityOrigin; `display-capture` solo trae requestingUrl.
        const origin = details?.securityOrigin ?? details?.requestingUrl ?? "";
        if (!isAppUrl(origin)) {
            callback(false);
            return;
        }
        if (permission === "media") {
            // macOS: pedir el acceso TCC explícitamente (sin askForMediaAccess la
            // cámara/mic quedan denegadas aunque la app conceda).
            if (process.platform === "darwin") {
                const types = details?.mediaTypes ?? [];
                const asks = [];
                if (types.includes("video")) asks.push(systemPreferences.askForMediaAccess("camera"));
                if (types.includes("audio")) asks.push(systemPreferences.askForMediaAccess("microphone"));
                if (asks.length === 0) { callback(true); return; }
                Promise.all(asks).then((results) => callback(results.every(Boolean)));
                return;
            }
            callback(true);
            return;
        }
        if (permission === "mediaKeySystem" || permission === "fullscreen" || permission === "notifications" || permission === "display-capture") {
            callback(true);
            return;
        }
        callback(false);
    });

    ses.setDisplayMediaRequestHandler(async (request, callback) => {
        // Electron lanza un TypeError si el request pide vídeo y el callback llega
        // sin stream (cancelación) — lo absorbemos; la web recibe el reject.
        const grant = (streams) => {
            try { callback(streams); } catch { /* cancel */ }
        };
        const who = () => {
            try {
                const frameUrl = request?.frame?.url;
                if (frameUrl) return frameUrl;
                return request?.securityOrigin ?? "(no origin)";
            } catch {
                return "(no origin)";
            }
        };
        dbg("[display-media] REQUEST video=", request?.videoRequested, "audio=", request?.audioRequested, "from=", who());
        try {
            // macOS: Screen Recording es un permiso TCC independiente (10.15+) y NO
            // se pide con askForMediaAccess (solo acepta camera/microphone). El prompt
            // lo dispara la primera llamada a desktopCapturer.getSources(); el estado
            // se consulta con getMediaAccessStatus("screen").
            if (process.platform === "darwin") {
                const before = systemPreferences.getMediaAccessStatus("screen");
                dbg("[display-media] mac TCC screen status BEFORE:", before);
                if (before === "denied" || before === "restricted") {
                    dbg("[display-media] ABORT: Screen Recording denegado — activar en System Settings → Privacy & Security → Screen Recording y reiniciar la app");
                    grant({});
                    return;
                }
            }
            const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
            if (process.platform === "darwin") {
                const after = systemPreferences.getMediaAccessStatus("screen");
                dbg("[display-media] mac TCC screen status AFTER getSources:", after);
                // El primer getSources muestra el prompt del SO; si el user lo negó
                // ahora, no conceder.
                if (after === "denied" || after === "restricted") {
                    dbg("[display-media] ABORT: user denied/restricted el prompt de Screen Recording");
                    grant({});
                    return;
                }
            }
            dbg("[display-media] sources found:", sources.length, "->", sources.map((s) => `${s.name} (${s.id})`).join(" | "));
            // 0 o 1 fuentes: nada que elegir → conceder (o cancelar) directo. Un
            // menú de un solo item bajo el cursor se cierra con el mouse-up del
            // click que lo abrió y pierde la elección (bug real en Wayland).
            if (sources.length <= 1) {
                if (sources[0]) {
                    dbg("[display-media] 1 source -> granting direct:", sources[0].name, "(", sources[0].id, ")");
                    grant({ video: sources[0] });
                } else {
                    dbg("[display-media] 0 sources -> nothing to grant");
                    grant({});
                }
                return;
            }
            // Varias fuentes → menú nativo en el cursor. El click del item corre
            // síncrono antes de menu-will-close; la cancelación se difiere un tick
            // para nunca tragar una elección real (bug real en Windows/Linux).
            let done = false;
            const choose = (streams, picked) => {
                if (!done) {
                    done = true;
                    if (picked) dbg("[display-media] PICKED:", picked.name, "(", picked.id, ")");
                    else dbg("[display-media] menu closed sin elección (cancel)");
                    grant(streams);
                }
            };
            const template = sources.map((s) => ({
                label: s.name,
                // Objeto DesktopCapturerSource COMPLETO: en Windows el capturador
                // necesita campos como display_id; un {id,name} parcial concede
                // el permiso pero el stream nunca nace.
                click: () => choose({ video: s }, s),
            }));
            const menu = Menu.buildFromTemplate(template);
            menu.on("menu-will-close", () => setTimeout(() => choose({}), 0));
            dbg("[display-media] showing native menu with", sources.length, "items");
            menu.popup();
        } catch (err) {
            dbg("[display-media] ERROR:", err?.message ?? err);
            grant({});
        }
    });
}

function createAppWindow(url = APP_URL) {
    const win = new BrowserWindow({
        width: 1360,
        height: 860,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: "#0b0f14",
        // Ícono de ventana (Linux/Windows; macOS usa el .icns del DMG).
        icon: path.join(__dirname, "build", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    win.once("ready-to-show", () => win.show());

    // window.open (la sala abre en pestaña nueva hoy) → nueva ventana Electron;
    // cualquier otro origin → browser del sistema.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isAppUrl(url)) {
            createAppWindow(url);
            return { action: "deny" };
        }
        shell.openExternal(url);
        return { action: "deny" };
    });

    // La app nunca navega fuera de su origin.
    win.webContents.on("will-navigate", (e, url) => {
        if (!isAppUrl(url)) {
            e.preventDefault();
            shell.openExternal(url);
        }
    });

    // Close-to-tray: cerrar la ventana la oculta; Quit real sale por el tray.
    win.on("close", (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            win.hide();
        }
    });

    void win.loadURL(url);
    return win;
}

// Ícono del tray: el logo real de la app (fallback: pixel transparente).
async function loadTrayIcon() {
    try {
        const res = await net.fetch(APP_URL + "/logotipo.png");
        if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const img = nativeImage.createFromBuffer(buf);
            if (!img.isEmpty()) return img.resize({ width: 18, height: 18 });
        }
    } catch {
        // fallback abajo
    }
    return nativeImage.createFromDataURL(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    );
}

function createTray() {
    const template = [
        { label: "Open Kova", click: () => showMainWindow() },
    ];
    // Auto-update (electron-updater): descargando o listo para reiniciar.
    if (autoUpdateState) {
        template.push({ type: "separator" });
        if (autoUpdateState.phase === "ready") {
            template.push({
                label: `Restart & update to Kova ${autoUpdateState.version}`,
                click: () => { try { autoUpdaterApi?.quitAndInstall(); } catch { /* noop */ } },
            });
        } else {
            template.push({ label: `Downloading Kova ${autoUpdateState.version}…`, enabled: false });
        }
        template.push({ label: "Release notes", click: () => shell.openExternal(RELEASES_URL) });
    } else if (updateInfo) {
        // Soft notifier (macOS / Linux pacman / desarrollo): descarga manual.
        template.push({ type: "separator" });
        template.push({
            label: `Download Kova ${updateInfo.version}`,
            click: () => updater.downloadUpdate(updateInfo),
        });
        template.push({
            label: "Release notes",
            click: () => { if (updateInfo.url) shell.openExternal(updateInfo.url); },
        });
    }
    template.push(
        { type: "separator" },
        {
            label: "Launch at login",
            type: "checkbox",
            checked: Boolean(app.getLoginItemSettings().openAtLogin),
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
        },
        { label: "Test notification", click: () => showNativeNotification({ title: "Kova", body: "Notifications are working on this device" }) },
        { label: "Check for updates…", click: () => (manualCheck ? manualCheck() : updater.checkForUpdates({ manual: true })) },
        { type: "separator" },
        { label: "Quit Kova", click: () => quitApp() },
    );
    // El Tray se crea UNA sola vez; los cambios de estado solo reconstruyen el
    // menú. En Windows, crear un Tray nuevo sin destruir el anterior deja
    // iconos duplicados acumulándose en la bandeja.
    if (!tray) {
        tray = new Tray(trayIcon);
        tray.setToolTip("Kova");
        tray.on("click", () => showMainWindow());
    }
    tray.setContextMenu(Menu.buildFromTemplate(template));
}

// Auto-update por plataforma:
//   • Windows empaquetado / Linux AppImage → electron-updater: descarga en
//     segundo plano y pide reiniciar (auto-update silencioso).
//   • macOS → soft notifier: sin firma Developer ID, Squirrel.Mac no puede
//     reemplazar la app (regla de Apple), así que avisa y descarga el DMG.
//   • Linux instalado por pacman (sin APPIMAGE) y desarrollo (`npm start`) →
//     soft notifier (el feed de electron-updater no existe fuera del build).
function setupUpdaters() {
    const appImage = process.platform === "linux" && Boolean(process.env.APPIMAGE);
    const soft = !app.isPackaged || process.platform === "darwin" || (process.platform === "linux" && !appImage);

    if (soft) {
        manualCheck = () => updater.checkForUpdates({ manual: true });
        updater.startUpdater({
            onState: (info) => {
                updateInfo = info;
                if (tray) createTray(); // reconstruye el menú con la sección de update
            },
        });
        return;
    }

    // Auto-update real (win32 empaquetado / Linux AppImage).
    const { autoUpdater } = require("electron-updater");
    autoUpdaterApi = autoUpdater;
    autoUpdater.autoDownload = true; // descarga en segundo plano; avisamos al estar listo
    autoUpdater.logger = {
        info: (m) => dbg("autoUpdater:", m),
        warn: (m) => dbg("autoUpdater warn:", m),
        error: (m) => dbg("autoUpdater error:", m),
    };
    let manualPending = false;
    let manualNotified = false; // evita doble toast (evento + resultado del check)
    const upToDate = () => showToast("Kova", `You are up to date (${app.getVersion()}).`);

    autoUpdater.on("update-available", (info) => {
        const version = info?.version || "";
        dbg("auto-update available:", version);
        manualPending = false;
        autoUpdateState = { version, phase: "downloading" };
        if (tray) createTray();
    });
    autoUpdater.on("update-not-available", () => {
        dbg("auto-update: up to date");
        if (manualPending && !manualNotified) {
            manualNotified = true;
            manualPending = false;
            upToDate();
        }
    });
    autoUpdater.on("update-downloaded", (info) => {
        const version = info?.version || "";
        dbg("auto-update downloaded:", version);
        autoUpdateState = { version, phase: "ready" };
        if (tray) createTray();
        showToast(`Kova ${version} downloaded`, "Click to restart and install the update.", () => {
            try { autoUpdater.quitAndInstall(); } catch { /* noop */ }
        });
    });
    autoUpdater.on("error", (err) => {
        dbg("autoUpdater error:", err?.message ?? err);
        // Un fallo de descarga (404, red…) no debe dejar el tray clavado en
        // "Downloading…": restauramos el menú base para que se pueda reintentar.
        if (autoUpdateState?.phase === "downloading") {
            autoUpdateState = null;
            if (tray) createTray();
        }
        if (manualPending && !manualNotified) {
            manualNotified = true;
            manualPending = false;
            showToast("Kova", "Update check failed. Try again later.");
        }
        // Error en check automático: no molesta, el siguiente reintenta.
    });

    manualCheck = async () => {
        manualPending = true;
        manualNotified = false;
        try {
            const result = await autoUpdater.checkForUpdates();
            if (result === null) { manualPending = false; return; } // updater inactivo (dev)
            // La notificación normal sale por update-not-available; si el evento
            // no dispara (Windows a veces no lo emite en re-checks manuales),
            // usamos el resultado devuelto por checkForUpdates.
            if (!result.isUpdateAvailable && manualPending && !manualNotified) {
                manualNotified = true;
                manualPending = false;
                upToDate();
            }
        } catch (err) {
            dbg("manual check failed:", err?.message ?? err);
            if (manualPending && !manualNotified) {
                manualNotified = true;
                showToast("Kova", "Update check failed. Try again later.");
            }
            manualPending = false;
        }
    };
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    setTimeout(check, 15000); // primer check poco después del arranque
    setInterval(check, 6 * 60 * 60 * 1000); // y luego cada 6 h
}

function showMainWindow() {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
}

function quitApp() {
    app.isQuitting = true;
    app.quit();
}

// Ícono de la app para ventanas y notificaciones. Lazy: se carga la primera
// vez que se necesita (dev: build/icon.png del repo; empaquetado: va dentro
// del asar gracias a build.files). null = no disponible.
let appIcon = undefined;
function getAppIcon() {
    if (appIcon === undefined) {
        const img = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png"));
        appIcon = img.isEmpty() ? null : img;
    }
    return appIcon ?? undefined;
}

// Toast nativo. Se guarda una referencia persistente: sin ella, Windows/macOS
// pueden recolectar el objeto antes de mostrarlo y el toast nunca aparece.
let lastToast = null;
function showToast(title, body, onClick) {
    const n = new Notification({ title, body, icon: getAppIcon() });
    if (onClick) n.on("click", onClick);
    lastToast = n;
    n.show();
    return n;
}

// Notificación nativa desde el main process (el preload la pide vía IPC).
function showNativeNotification({ title = "Kova", body = "", url } = {}) {
    showToast(title, body, () => {
        showMainWindow();
        if (url && isAppUrl(url)) void mainWindow?.loadURL(url);
    });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => showMainWindow());

    app.whenReady().then(async () => {
        app.isQuitting = false;
        dbg("startup platform=", process.platform, "| electron=", process.versions.electron, "| node=", process.versions.node, "| url=", APP_URL);
        setupMediaPermissions();

        trayIcon = await loadTrayIcon();
        ipcMain.on("notify", (_evt, payload) => showNativeNotification(payload));

        mainWindow = createAppWindow();
        createTray();

        // Auto-update: el motor depende de la plataforma (electron-updater en
        // Windows/Linux AppImage; soft notifier en macOS, pacman y desarrollo).
        setupUpdaters();

        // macOS: clic en el dock recrea la ventana.
        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) mainWindow = createAppWindow();
        });
        // La app vive en el tray hasta Quit explícito.
        app.on("window-all-closed", () => { /* no-op */ });
    });
}

app.on("before-quit", () => { app.isQuitting = true; });
