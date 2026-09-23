"use strict";

// Configuración de la app: la URL de la web (KOVA_APP_URL la sobreescribe, útil
// para apuntar a local en desarrollo) y las rutas de los recursos empaquetados.
//
// Ojo con las rutas: en producción esto vive dentro del asar, y solo se empaqueta
// lo que lista `build.files` en package.json — si añades un fichero nuevo a
// `build/`, añádelo también ahí.

const path = require("node:path");

const ROOT = path.join(__dirname, "..");

const APP_URL = process.env.KOVA_APP_URL || "https://app.omnios.pt/";
const RELEASES_URL = "https://github.com/cleivaj/task_manager_electron/releases";

const ICON_PATH = path.join(ROOT, "build", "icon.png");
const TRAY_ICON_PATH = path.join(ROOT, "build", "tray.png");
const PRELOAD_PATH = path.join(ROOT, "preload.cjs");

// El origin de la app es la frontera de confianza: permisos de media, links que
// se abren dentro y navegación. Todo lo que no sea este origin sale al navegador.
function appOrigin() {
    try {
        return new URL(APP_URL).origin;
    } catch {
        return APP_URL;
    }
}

function isAppUrl(url) {
    try {
        return new URL(url).origin === appOrigin();
    } catch {
        return false;
    }
}

module.exports = {
    APP_URL,
    RELEASES_URL,
    ICON_PATH,
    TRAY_ICON_PATH,
    PRELOAD_PATH,
    appOrigin,
    isAppUrl,
};
