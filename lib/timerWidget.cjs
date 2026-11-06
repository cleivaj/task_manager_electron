"use strict";

const { BrowserWindow, screen, shell } = require("electron");
const { APP_URL, ICON_PATH, PRELOAD_PATH, isAppUrl } = require("./config.cjs");

// Ventana flotante del cronómetro: dos tamaños — expandida (caja completa) y
// minimizada (un botón redondo). SIEMPRE encima de todo (alwaysOnTop) para
// seguir viendo los timers aunque el usuario esté en otra app (Photoshop…).
// Carga la ruta /timer-widget; el estado se sincroniza por BroadcastChannel
// (mismo origin), no por IPC. Solo una instancia.

let widgetWindow = null;
// Estado actual (para restaurar al abrir y al calcular la posición).
let expanded = true;

const WIDTH = 340;
const HEIGHT = 420;
const MINI = 64; // botón redondo (ancho = alto)
const MARGIN = 16;

// Posición anclada a la esquina inferior derecha del área de trabajo, para el
// tamaño dado (el botón y la caja quedan pegados al mismo rincón).
function cornerPosition(width, height) {
    const { workArea } = screen.getPrimaryDisplay();
    return {
        x: workArea.x + workArea.width - width - MARGIN,
        y: workArea.y + workArea.height - height - MARGIN,
    };
}

// Ao expandir/colapsar muda só o tamanho: a posição onde o utilizador deixou
// a janela é preservada (só se corrige se o novo tamanho sair do ecrã).
function applySize() {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const width = expanded ? WIDTH : MINI;
    const height = expanded ? HEIGHT : MINI;
    const [currentX, currentY] = widgetWindow.getPosition();
    const { workArea } = screen.getDisplayMatching(widgetWindow.getBounds());
    const x = Math.min(
        Math.max(currentX, workArea.x),
        workArea.x + workArea.width - width,
    );
    const y = Math.min(
        Math.max(currentY, workArea.y),
        workArea.y + workArea.height - height,
    );
    widgetWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
}

function create() {
    const width = expanded ? WIDTH : MINI;
    const height = expanded ? HEIGHT : MINI;
    const { x, y } = cornerPosition(width, height);

    widgetWindow = new BrowserWindow({
        width,
        height,
        x,
        y,
        show: false,
        frame: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: "#0b0f14",
        icon: ICON_PATH,
        webPreferences: {
            preload: PRELOAD_PATH,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // "screen-saver" mantém a janela acima de apps em fullscreen.
    widgetWindow.setAlwaysOnTop(true, "screen-saver");
    widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    widgetWindow.once("ready-to-show", () => widgetWindow.show());

    widgetWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (!isAppUrl(url)) shell.openExternal(url);
        return { action: "deny" };
    });

    widgetWindow.on("closed", () => {
        widgetWindow = null;
    });

    void widgetWindow.loadURL(`${APP_URL}timer-widget`);
    return widgetWindow;
}

function open() {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.show();
        return;
    }
    create();
}

function close() {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.close();
    }
    widgetWindow = null;
}

// Alterna entre a caja completa e o botão redondo. O renderer pede-o pela UI.
function setExpanded(next) {
    expanded = Boolean(next);
    applySize();
}

// Arrastar (frame:false não tem barra): o renderer envia o delta do rato.
function moveBy(dx, dy) {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const [x, y] = widgetWindow.getPosition();
    widgetWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
}

module.exports = { open, close, setExpanded, moveBy };
