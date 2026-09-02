"use strict";

// Kova desktop shell (PoC). Carga la app web existente (no un port) y añade la
// capa nativa: notificaciones del SO, tray con badge/autostart, close-to-tray y
// manejo de ventanas (la sala de llamada abre con window.open → nueva ventana
// Electron, los links externos → browser del sistema).
//
// La APP_URL se configura con KOVA_APP_URL (default: la instancia de producción).

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, net, shell } = require("electron");
const path = require("path");

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