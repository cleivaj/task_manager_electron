"use strict";

const { app, Tray, Menu, nativeImage } = require("electron");
const { execFile } = require("node:child_process");
const { TRAY_ICON_PATH } = require("./config.cjs");
const { dbg } = require("./log.cjs");

// Tray (bandeja / barra del sistema). Es la única puerta al "Quit Omni" y al
// "Check for updates…", así que existe en todas las plataformas y vive hasta el
// Quit explícito.
//
// El menú se compone de lo que este módulo sabe (abrir, "Launch at login", probe
// de notificación, quit) más los items de update que le pasa el updater — el tray
// no sabe nada de updaters, solo pinta.
//
// Linux/Wayland: el StatusNotifierItem se registra UNA sola vez, al crear el
// Tray. Si la barra todavía no expone `org.kde.StatusNotifierWatcher` —login, con
// la app arrancando en paralelo al shell— el registro se pierde en silencio y el
// icono no vuelve hasta reiniciar la app. Por eso esperamos al watcher antes de
// crearlo (si no podemos comprobarlo, creamos como siempre).

const TRAY_WATCHER = "org.kde.StatusNotifierWatcher";

let tray = null;
let trayIcon = null;
let deps = null;

// Ícono del tray: la marca de Omni empaquetada con la app (build/tray.png).
// Antes se pedía `/logotipo.png` por red, que era el logo de la marca anterior;
// además así el tray funciona sin conexión (fallback: pixel transparente).
async function loadTrayIcon() {
    try {
        const img = nativeImage.createFromPath(TRAY_ICON_PATH);
        if (!img.isEmpty()) return img.resize({ width: 18, height: 18 });
    } catch {
        // fallback abajo
    }
    return nativeImage.createFromDataURL(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    );
}

// ¿Existe ya el StatusNotifierWatcher en el bus de sesión? null = no hay forma de
// comprobarlo (sin dbus-send) → no bloqueamos el arranque por esto.
function trayHostPresent() {
    return new Promise((resolve) => {
        execFile(
            "dbus-send",
            [
                "--session",
                "--print-reply",
                "--dest=org.freedesktop.DBus",
                "/org/freedesktop/DBus",
                "org.freedesktop.DBus.NameHasOwner",
                `string:${TRAY_WATCHER}`,
            ],
            { timeout: 2000 },
            (err, stdout) => {
                if (err) resolve(null);
                else resolve(/boolean\s+true/.test(String(stdout)));
            },
        );
    });
}

async function waitForTrayHost(timeoutMs = 20000) {
    if (process.platform !== "linux") return;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const present = await trayHostPresent();
        if (present === null) return;
        if (present) return;
        if (Date.now() >= deadline) {
            dbg("tray: sin StatusNotifierWatcher tras", timeoutMs, "ms; se crea igual");
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

function buildMenu() {
    return [
        { label: "Open Omni", click: () => deps.onOpen() },
        ...deps.getUpdateItems(),
        { type: "separator" },
        {
            label: "Launch at login",
            type: "checkbox",
            checked: Boolean(app.getLoginItemSettings().openAtLogin),
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
        },
        { label: "Test notification", click: () => deps.onTestNotification() },
        { label: "Check for updates…", click: () => deps.onCheckForUpdates() },
        { type: "separator" },
        { label: "Quit Omni", click: () => deps.onQuit() },
    ];
}

// Reconstruye el menú con el estado actual. Lo llama el wiring del arranque y el
// updater cuando cambia de fase.
function refreshMenu() {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate(buildMenu()));
}

/**
 * Crea el tray. Dependencias inyectadas (el tray no importa ventana ni updater):
 *   onOpen, onQuit, onTestNotification, onCheckForUpdates, getUpdateItems
 */
async function init(dependencies) {
    deps = dependencies;
    if (!trayIcon) trayIcon = await loadTrayIcon();
    await waitForTrayHost();

    // El Tray se crea UNA sola vez; los cambios de estado solo reconstruyen el
    // menú. En Windows, crear un Tray nuevo sin destruir el anterior deja iconos
    // duplicados acumulándose en la bandeja.
    if (!tray) {
        tray = new Tray(trayIcon);
        tray.setToolTip("Omni");
        tray.on("click", () => deps.onOpen());
    }
    refreshMenu();
}

module.exports = { init, refreshMenu };
