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
const COMPACT_WIDTH = 240;
const COMPACT_HEIGHT = 56;
const MARGIN = 16;

// Altura do card (título + breadcrumb + tempo) e do header. Usadas para o
// clamp no main; o valor real vem do renderer (mede o conteúdo).
const CARD_HEIGHT = 104;
const HEADER_HEIGHT = 37;
const MIN_EXPANDED_HEIGHT = HEADER_HEIGHT + CARD_HEIGHT + 16;
// No máximo 3 cards visíveis; a partir daí o renderer faz scroll interno.
const MAX_EXPANDED_HEIGHT = HEADER_HEIGHT + CARD_HEIGHT * 3 + 16;

// Altura pedida pelo renderer no último estado expandido (já clampada).
let expandedHeight = MAX_EXPANDED_HEIGHT;

// Posición anclada a la esquina inferior derecha del área de trabajo, para el
// tamaño dado (el botón y la caja quedan pegados al mismo rincón).
function cornerPosition(width, height) {
    const { workArea } = screen.getPrimaryDisplay();
    return {
        x: workArea.x + workArea.width - width - MARGIN,
        y: workArea.y + workArea.height - height - MARGIN,
    };
}

// Ao expandir/colapsar muda só o tamanho. A posição preserva-se ancorada ao
// canto inferior direito: o widget vive lá, e crescer para a esquerda/para cima
// evita que a pílula salte quando expira.
function applySize() {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const width = expanded ? WIDTH : COMPACT_WIDTH;
    const height = expanded ? expandedHeight : COMPACT_HEIGHT;
    const [currentX, currentY] = widgetWindow.getPosition();
    const [, currentHeight] = widgetWindow.getSize();
    const { workArea } = screen.getDisplayMatching(widgetWindow.getBounds());

    // Mantém a borda direita e a borda inferior onde estavam.
    const rightEdge = currentX + widgetWindow.getSize()[0];
    const bottomEdge = currentY + currentHeight;

    let x = rightEdge - width;
    let y = bottomEdge - height;

    x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width);
    y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height);

    widgetWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
}

function create() {
    const width = expanded ? WIDTH : COMPACT_WIDTH;
    const height = expanded ? expandedHeight : COMPACT_HEIGHT;
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

// Alterna entre a caixa completa e o estado compacto. O renderer pede-o por hover.
function setExpanded(next) {
    expanded = Boolean(next);
    applySize();
}

// Altura pedida pelo renderer para o estado expandido. Clamp entre 1 e 3 cards
// (+ header). Não força resize se o valor não mudou.
function setContentHeight(height) {
    const raw = Number(height);
    if (!Number.isFinite(raw)) return;
    const next = Math.max(MIN_EXPANDED_HEIGHT, Math.min(raw, MAX_EXPANDED_HEIGHT));
    if (next === expandedHeight) return;
    expandedHeight = next;
    if (expanded) applySize();
}

// Arrastar (frame:false não tem barra): o renderer envia o delta do rato.
function moveBy(dx, dy) {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const [x, y] = widgetWindow.getPosition();
    widgetWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
}

module.exports = { open, close, setExpanded, moveBy, setContentHeight };
