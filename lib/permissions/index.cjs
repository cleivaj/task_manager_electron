"use strict";

// Permisos de la app, agrupados por lo que se concede (no por plataforma):
//
//   media.cjs        → cámara y micrófono (getUserMedia)
//   screen-share.cjs → compartir pantalla (getDisplayMedia)
//   macos.cjs        → los gates TCC del SO, que solo existen en macOS
//
// Se registran en la sesión por defecto, que es la única que usa la app.

const { session } = require("electron");
const { setupMediaPermissions } = require("./media.cjs");
const { setupScreenSharing } = require("./screen-share.cjs");

function setupPermissions(ses = session.defaultSession) {
    setupMediaPermissions(ses);
    setupScreenSharing(ses);
}

module.exports = { setupPermissions };
