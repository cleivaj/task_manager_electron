"use strict";

const { Notification, nativeImage } = require("electron");
const { ICON_PATH } = require("./config.cjs");

// Toasts nativos del SO, siempre desde el main process: el renderer los pide por
// IPC (window.desktop.notify) y el updater los usa desde aquí también.
//
// Dependencias inyectadas: el clic de una notificación enfoca la ventana y, si
// trae url, navega dentro de la app — pero eso lo decide quien monta la app
// (ver main.cjs), no este módulo.

let deps = { showWindow: () => {}, navigate: () => {} };

function init(dependencies) {
    deps = { ...deps, ...dependencies };
}

// Ícono de la app para ventanas y notificaciones. Lazy: se carga la primera vez
// que se necesita (dev: build/icon.png del repo; empaquetado: va dentro del asar
// gracias a build.files). null = no disponible.
let appIcon = undefined;
function getAppIcon() {
    if (appIcon === undefined) {
        const img = nativeImage.createFromPath(ICON_PATH);
        appIcon = img.isEmpty() ? null : img;
    }
    return appIcon ?? undefined;
}

// Se guarda una referencia persistente: sin ella, Windows/macOS pueden recolectar
// el objeto antes de mostrarlo y el toast nunca aparece.
let lastToast = null;
function showToast(title, body, onClick) {
    const n = new Notification({ title, body, icon: getAppIcon() });
    if (onClick) n.on("click", onClick);
    lastToast = n;
    n.show();
    return n;
}

// --- Dedupe global de notificaciones nativas ---
//
// SSE (shim) y poll fallback entregan la MISMA notificación al main process por
// caminos distintos. Deduplicar aquí (punto único) es más fiable que en el
// renderer, porque no depende del estado de cada página. La ventana de 2 min
// cubre con holgura el intervalo del poll (45s).
const DEDUPE_WINDOW_MS = 120_000;
const recentlyShown = new Map();

function isDuplicate(notificationId) {
    if (!notificationId) return false;
    const now = Date.now();
    // Limpieza perezosa: descarta entradas fuera de la ventana.
    for (const [id, ts] of recentlyShown) {
        if (now - ts > DEDUPE_WINDOW_MS) recentlyShown.delete(id);
    }
    const last = recentlyShown.get(notificationId);
    if (last !== undefined && now - last <= DEDUPE_WINDOW_MS) return true;
    recentlyShown.set(notificationId, now);
    return false;
}

// Notificación nativa con acción: al hacer clic abre la app (y navega si trae url).
// El notificationId (cuando viene) deduplica contra el mismo evento llegado por
// otro camino — SSE vs poll — evitando toasts repetidos.
function showNativeNotification({ title = "Omni", body = "", url, notificationId } = {}) {
    if (isDuplicate(notificationId)) return;
    showToast(title, body, () => {
        deps.showWindow();
        if (url) deps.navigate(url);
    });
}

module.exports = { init, showToast, showNativeNotification };
