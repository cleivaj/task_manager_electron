"use strict";

const { BrowserWindow, screen, shell } = require("electron");
const { APP_URL, ICON_PATH, PRELOAD_PATH, isAppUrl } = require("./config.cjs");

// Ventana flotante del cronómetro: dos tamaños — expandida (caja completa) y
// minimizada (un botón redondo). SIEMPRE encima de todo (alwaysOnTop) para
// seguir viendo los timers aunque el usuario esté en otra app (Photoshop…).
// Carga la ruta /timer-widget; el estado se sincroniza por BroadcastChannel
// (mismo origin), no por IPC. Solo una instancia.

let widgetWindow = null;
// Estado actual. Arranca EXPANDIDO: ao abrir o widget o utilizador quer ver
// os timers, não uma pílula que obriga a clicar. Os dois lados têm de concordar
// (React também arranca em `true`), senão a janela nasce com o tamanho errado.
let expanded = true;

const WIDTH = 340;
// Largura do compacto: medida pelo renderer (conteúdo real). Os valores são
// clamp para garantir que o HH:MM:SS nunca corta.
const COMPACT_MIN_WIDTH = 150;
const COMPACT_MAX_WIDTH = 320;
// 48px: o painel compacto preenche a janela sem padding.
const COMPACT_HEIGHT = 48;
const MARGIN = 16;

// Altura do card (título + breadcrumb + tempo). O painel já não tem header —
// o primeiro card é a pega de arrasto. Valores usados só para o clamp no main;
// o real vem do renderer, que mede o conteúdo.
const CARD_HEIGHT = 104;
const MIN_EXPANDED_HEIGHT = CARD_HEIGHT;
// No máximo 3 cards visíveis; a partir daí o renderer faz scroll interno.
const MAX_EXPANDED_HEIGHT = CARD_HEIGHT * 3;

// Altura pedida pelo renderer no último estado expandido (já clampada).
// Arranca no MÍNIMO (1 card): a janela cresce até ao conteúdo quando o
// renderer reportar a altura real. Arrancar no máximo fazia-a nascer grande e
// encolher — um "flash" visível em cada abertura do widget.
let expandedHeight = MIN_EXPANDED_HEIGHT;
// Largura pedida pelo renderer no estado compacto.
let compactWidth = COMPACT_MIN_WIDTH;

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
    const width = expanded ? WIDTH : compactWidth;
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
    const width = expanded ? WIDTH : compactWidth;
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


// Largura do compacto medida pelo renderer. Só redimensiona se o valor mudou
// e se a janela estiver colapsada (no expandido a largura é fixa).
function setCompactWidth(width) {
    const raw = Number(width);
    if (!Number.isFinite(raw)) return;
    const next = Math.max(COMPACT_MIN_WIDTH, Math.min(raw, COMPACT_MAX_WIDTH));
    if (next === compactWidth) return;
    compactWidth = next;
    if (!expanded) applySize();
}

// Arrastar (frame:false não tem barra): o renderer envia o delta do rato.
function moveBy(dx, dy) {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const [x, y] = widgetWindow.getPosition();
    widgetWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
}

module.exports = { open, close, setExpanded, moveBy, setContentHeight, setCompactWidth };
