"use strict";

// Kova desktop shell (PoC). Carga la app web existente (no un port) y añade la
// capa nativa: notificaciones del SO, tray con badge/autostart, close-to-tray y
// manejo de ventanas (la sala de llamada abre con window.open → nueva ventana
// Electron, los links externos → browser del sistema).
//
// La APP_URL se configura con KOVA_APP_URL (default: la instancia de producción).

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, net, shell, session, desktopCapturer, systemPreferences, WebContents } = require("electron");
const path = require("node:path");

const APP_URL = process.env.KOVA_APP_URL || "https://kova.cesar.wearemateria.com";
const APP_ORIGIN = () => { try { return new URL(APP_URL).origin; } catch { return APP_URL; } };

let mainWindow = null;
let tray = null;
let trayIcon = null;

// En Windows la notificación nativa solo aparece si la app tiene AppUserModelID.
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

// --- Permisos de media (cámara/mic/pantalla) ---
//
// En el navegador, getUserMedia dispara el prompt de Chromium y el propio
// navegador ya trae los permisos del SO. En Electron NO hay prompt: el
// renderer pregunta al main process vía session.setPermissionRequestHandler,
// y si la app no concede, getUserMedia falla (en Windows en silencio; en macOS
// ni siquiera llega si Info.plist no declara el uso de cámara/mic).
// Concedemos SOLO lo que la app usa y solo para el origin de la app.
function setupMediaPermissions() {
    const ses = session.defaultSession;

    // Comprobación síncrona (navigator.permissions.query, enumerateDevices…).
    ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        if (!isAppUrl(requestingOrigin)) return false;
        return permission === "media" || permission === "mediaKeySystem" || permission === "display-capture";
    });

    // Petición asíncrona (getUserMedia). En macOS hay que pedir el acceso al
    // SO explícitamente (TCC) — sin askForMediaAccess, la cámara/mic quedan
    // denegados aunque la app lo conceda.
    ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
        if (!isAppUrl(details?.securityOrigin ?? "")) {
            callback(false);
            return;
        }
        if (permission === "media") {
            if (process.platform === "darwin") {
                const mediaTypes = details?.mediaTypes ?? [];
                const wantsCamera = mediaTypes.includes("video");
                const wantsMic = mediaTypes.includes("audio");
                const asks = [];
                if (wantsCamera) asks.push(systemPreferences.askForMediaAccess("camera"));
                if (wantsMic) asks.push(systemPreferences.askForMediaAccess("microphone"));
                if (asks.length === 0) {
                    callback(true);
                    return;
                }
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

    // getDisplayMedia (compartir pantalla en la sala): en Electron no hay
    // picker nativo del SO; enumeramos fuentes con desktopCapturer y mostramos
    // un menú nativo para que el usuario elija qué compartir.
    ses.setDisplayMediaRequestHandler(async (request, callback) => {
        try {
            const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
            if (sources.length === 0) {
                callback({});
                return;
            }
            // El menú nativo no tiene evento "cancelar": si el usuario lo cierra
            // sin elegir, menu-will-close dispara el callback con streams vacíos
            // (getDisplayMedia rechaza → la web lo trata como cancelado). Un flag
            // evita responder dos veces cuando SÍ eligió una fuente.
            let done = false;
            const finish = (streams) => {
                if (done) return;
                done = true;
                callback(streams);
            };
            const template = sources.map((s) => ({
                label: s.name,
                click: () => finish({ video: { id: s.id, name: s.name } }),
            }));
            const wc = request.frame ? WebContents.fromFrame(request.frame) : undefined;
            const win = wc ? BrowserWindow.fromWebContents(wc) : undefined;
            const menu = Menu.buildFromTemplate(template);
            menu.on("menu-will-close", () => finish({}));
            menu.popup({ window: win });
        } catch {
            callback({});
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
        // Ícono de ventana (Linux/Windows; no macOS — el dock/DMG usa el .icns
        // que electron-builder genera desde build/icon.png).
        icon: path.join(__dirname, "build", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    win.once("ready-to-show", () => win.show());

    // window.open (la sala de llamada abre en nueva pestaña hoy) → nueva ventana
    // Electron; cualquier otro origin → browser por defecto del sistema.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isAppUrl(url)) {
            createAppWindow(url);
            return { action: "deny" };
        }
        shell.openExternal(url);
        return { action: "deny" };
    });

    // La app nunca navega fuera de su origin (un link malicioso no se lleva la ventana).
    win.webContents.on("will-navigate", (e, url) => {
        if (!isAppUrl(url)) {
            e.preventDefault();
            shell.openExternal(url);
        }
    });

    // Close-to-tray: cerrar la ventana la oculta; Quit real sale por el tray/menu.
    win.on("close", (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            win.hide();
        }
    });

    void win.loadURL(url);
    return win;
}

// Ícono del tray: usa el logo real de la app (fallback: pixel transparente).
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
    const menu = Menu.buildFromTemplate([
        { label: "Open Kova", click: () => showMainWindow() },
        {
            label: "Launch at login",
            type: "checkbox",
            checked: Boolean(app.getLoginItemSettings().openAtLogin),
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
        },
        // Diagnóstico rápido: verifica el camino SO (permisos/registro) sin
        // depender de SSE ni del login. Útil para depurar en remoto.
        {
            label: "Test notification",
            click: () => showNativeNotification({ title: "Kova", body: "Notifications are working on this device" }),
        },
        { type: "separator" },
        { label: "Quit Kova", click: () => quitApp() },
    ]);
    tray = new Tray(trayIcon);
    tray.setToolTip("Kova");
    tray.setContextMenu(menu);
    tray.on("click", () => showMainWindow());
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

// Notificación nativa (main process). Sin push provider: instantánea y fiable
// en macOS/Windows/Linux — es el punto de la PoC.
function showNativeNotification({ title = "Kova", body = "", url } = {}) {
    const n = new Notification({ title, body });
    n.on("click", () => {
        showMainWindow();
        if (url && isAppUrl(url)) void mainWindow?.loadURL(url);
    });
    n.show();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => showMainWindow());

    app.whenReady().then(async () => {
        app.isQuitting = false;

        // Cámara/mic/pantalla: sin esto getUserMedia falla en el shell.
        setupMediaPermissions();

        trayIcon = await loadTrayIcon();

        // Puente preload → main: la página pide una notificación nativa.
        ipcMain.on("notify", (_evt, payload) => showNativeNotification(payload));

        mainWindow = createAppWindow();
        createTray();

        // macOS: clic en el dock recrea la ventana.
        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) mainWindow = createAppWindow();
        });
        // Sin window-all-closed quit: la app vive en el tray hasta Quit explícito.
        app.on("window-all-closed", () => { /* no-op */ });
    });
}

app.on("before-quit", () => { app.isQuitting = true; });