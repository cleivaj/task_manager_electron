"use strict";

// Configuración de la app: la URL de la web (KOVA_APP_URL la sobreescribe, útil
// para apuntar a local en desarrollo) y las rutas de los recursos empaquetados.
//
// Ojo con las rutas: en producción esto vive dentro del asar, y solo se empaqueta
// lo que lista `build.files` en package.json — si añades un fichero nuevo a
// `build/`, añádelo también ahí.

const path = require("node:path");
const { app } = require("electron");

const ROOT = path.join(__dirname, "..");

// Em dev (Electron não empacotado) apontamos para o `next dev`. A barra final é
// obrigatória: as rotas são construídas como `${APP_URL}timer-widget`.
const DEV_APP_URL = "http://localhost:3000/";
const PROD_APP_URL = "https://app.omnios.pt/";

// Prioridade: override explícito > dev local > produção.
// `app.isPackaged` só é fiável depois do `app` estar pronto, mas está
// disponível logo no require do módulo em Electron moderno.
const RAW_APP_URL = process.env.KOVA_APP_URL
    || (app && app.isPackaged ? PROD_APP_URL : DEV_APP_URL);

// Garante a barra final: as rotas fazem `${APP_URL}timer-widget`.
const APP_URL = RAW_APP_URL.endsWith("/") ? RAW_APP_URL : `${RAW_APP_URL}/`;
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
