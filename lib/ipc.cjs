"use strict";

const { ipcMain } = require("electron");

// IPC preload → main. Un único canal hoy: el renderer pide un toast nativo
// (`window.desktop.notify` en preload.cjs) y el main lo muestra con el resto de
// notificaciones.
function registerIpc({ onNotify }) {
    ipcMain.on("notify", (_evt, payload) => onNotify(payload));
}

module.exports = { registerIpc };
