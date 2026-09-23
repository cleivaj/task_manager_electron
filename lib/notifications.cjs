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

// Notificación nativa con acción: al hacer clic abre la app (y navega si trae url).
function showNativeNotification({ title = "Omni", body = "", url } = {}) {
    showToast(title, body, () => {
        deps.showWindow();
        if (url) deps.navigate(url);
    });
}

module.exports = { init, showToast, showNativeNotification };
