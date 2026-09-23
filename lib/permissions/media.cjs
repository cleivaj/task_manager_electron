"use strict";

const { session } = require("electron");
const { isAppUrl } = require("../config.cjs");
const macos = require("./macos.cjs");

// En el navegador getUserMedia muestra el prompt de Chromium y el navegador ya
// tiene los permisos del SO. En Electron no hay prompt: el renderer pregunta al
// main process y, si no concedemos, getUserMedia falla. Concedemos solo lo que la
// app usa y solo para el origin de la app.

// Comprobación síncrona (navigator.permissions.query, enumerateDevices…).
function onPermissionCheck(_webContents, permission, requestingOrigin) {
    if (!isAppUrl(requestingOrigin)) return false;
    return permission === "media" || permission === "mediaKeySystem" || permission === "display-capture";
}

function onPermissionRequest(_webContents, permission, callback, details) {
    // `media` trae securityOrigin; `display-capture` solo trae requestingUrl.
    const origin = details?.securityOrigin ?? details?.requestingUrl ?? "";
    if (!isAppUrl(origin)) {
        callback(false);
        return;
    }
    if (permission === "media") {
        // macOS: pedir el acceso TCC explícitamente (sin askForMediaAccess la
        // cámara/mic quedan denegadas aunque la app conceda). Fuera de macOS el
        // SO ya lo gestiona él y conceder aquí es lo que hace sonar el dispositivo.
        if (process.platform === "darwin") {
            const asks = macos.mediaAccessRequests(details?.mediaTypes ?? []);
            if (asks.length === 0) {
                callback(true);
                return;
            }
            Promise.all(asks).then((results) => callback(results.every(Boolean)));
            return;
        }
        callback(true);
        return;
    }
    if (permission === "mediaKeySystem" || permission === "fullscreen" || permission === "notifications" || permission === "display-capture") {
        callback(true);
        return;
    }
    callback(false);
}

function setupMediaPermissions(ses = session.defaultSession) {
    ses.setPermissionCheckHandler(onPermissionCheck);
    ses.setPermissionRequestHandler(onPermissionRequest);
}

module.exports = { setupMediaPermissions };
