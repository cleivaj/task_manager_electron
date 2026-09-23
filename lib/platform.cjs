"use strict";

const { app } = require("electron");

// Ajustes de arranque que dependen del sistema operativo. Se llama ANTES de
// app.whenReady(): los `commandLine` switches de Chromium no se pueden tocar
// después.
//
//   • Windows — AppUserModelID. Sin él Windows no muestra los toasts nativos
//     (los agrupa por ese id). No es un permiso: Windows no tiene gate de
//     cámara/mic/pantalla; los permisos viven en ./permissions.
//   • Linux — el stream de pantalla sale por PipeWire vía xdg-desktop-portal, y
//     Chromium solo lo usa corriendo en Wayland nativo con el capturador activo.
//   • macOS — nada aquí: sus permisos (TCC) se piden en runtime;
//     ver ./permissions/macos.cjs.
function configurePlatform() {
    if (process.platform === "win32") {
        app.setAppUserModelId("pt.omnios");
    }
    if (process.platform === "linux") {
        app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
        if (process.env.WAYLAND_DISPLAY) {
            app.commandLine.appendSwitch("ozone-platform-hint", "auto");
        }
    }
}

module.exports = { configurePlatform };
