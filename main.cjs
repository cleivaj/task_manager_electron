"use strict";

// Omni desktop shell — punto de entrada y ÚNICO sitio donde se conecta todo: el
// resto vive en ./lib, un módulo por responsabilidad (nada de un fichero de 500
// líneas). Aquí no hay lógica de negocio, solo el orden de arranque y el cableado
// entre módulos.
//
//   config.cjs         URL de la web, origin de confianza, rutas de los recursos
//   log.cjs            log de desarrollo (los builds empaquetados no imprimen)
//   platform.cjs       ajustes de arranque por SO (Windows / Linux)
//   permissions/       sesión: cámara/mic, compartir pantalla y TCC de macOS
//   window.cjs         ventanas, close-to-tray, navegación interna
//   tray.cjs           icono y menú del tray
//   notifications.cjs  toasts nativos del SO
//   ipc.cjs            canal "notify" que usa el preload
//   updates.cjs        auto-update (electron-updater o soft notifier)
//
// APP_URL se configura con KOVA_APP_URL (default: producción).

const { app } = require("electron");
const config = require("./lib/config.cjs");
const { dbg } = require("./lib/log.cjs");
const { configurePlatform } = require("./lib/platform.cjs");
const { setupPermissions } = require("./lib/permissions/index.cjs");
const notifications = require("./lib/notifications.cjs");
const windowManager = require("./lib/window.cjs");
const tray = require("./lib/tray.cjs");
const updates = require("./lib/updates.cjs");
const { registerIpc } = require("./lib/ipc.cjs");

// Antes de whenReady: switches de Chromium y ajustes del SO por plataforma.
configurePlatform();

// Quit real (el "Quit Omni" del tray): marca la intención para que el handler de
// `close` de la ventana no la oculte en vez de cerrarla.
function quitApp() {
    app.isQuitting = true;
    app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => windowManager.showMainWindow());

    app.whenReady().then(async () => {
        app.isQuitting = false;
        dbg("startup platform=", process.platform, "| electron=", process.versions.electron, "| node=", process.versions.node, "| url=", config.APP_URL);

        setupPermissions();
        notifications.init({
            showWindow: windowManager.showMainWindow,
            // El clic de una notificación con url solo navega dentro de la app.
            navigate: (url) => {
                if (config.isAppUrl(url)) windowManager.navigateMainWindow(url);
            },
        });
        registerIpc({ onNotify: notifications.showNativeNotification });

        windowManager.createMainWindow();

        // La ventana ya está en pantalla; el tray espera a la barra (Linux) y
        // recibe por inyección todo lo que no es asunto suyo.
        await tray.init({
            onOpen: windowManager.showMainWindow,
            onQuit: quitApp,
            onTestNotification: () =>
                notifications.showNativeNotification({
                    title: "Omni",
                    body: "Notifications are working on this device",
                }),
            onCheckForUpdates: updates.checkForUpdatesManual,
            getUpdateItems: updates.menuItems,
        });

        // Auto-update: el motor depende de la plataforma; cuando cambia de estado
        // (descargando / listo) se repinta el menú del tray.
        updates.start({ onState: () => tray.refreshMenu() });

        // macOS: clic en el dock recrea la ventana.
        app.on("activate", () => windowManager.ensureMainWindow());
        // La app vive en el tray hasta Quit explícito.
        app.on("window-all-closed", () => { /* no-op */ });
    });
}

app.on("before-quit", () => { app.isQuitting = true; });
