"use strict";

const { app } = require("electron");

// Debug solo visible en desarrollo (`npm start`, app sin empaquetar).
// Los builds empaquetados (dmg/exe/AppImage) no imprimen nada.
function dbg(...args) {
    if (!app.isPackaged) console.log("[omni-debug]", ...args);
}

module.exports = { dbg };
