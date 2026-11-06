"use strict";

const { ipcMain, clipboard } = require("electron");

// IPC preload → main. Canales:
//   • notify                → toast nativo (window.desktop.notify)
//   • clipboard:write       → copia texto al portapapeles (navegador Electron)
//   • timer-widget:open / :close → abre/cierra la ventana flotante
//   • timer-widget:expand   → expande/colapsa (caja ↔ botón redondo)
//   • timer-widget:move     → arrastra la ventana según el delta del rato
function registerIpc({ onNotify, timerWidget }) {
    ipcMain.on("notify", (_evt, payload) => onNotify(payload));

    // En Electron `navigator.clipboard` no es fiable (contexto/permisos): se usa
    // el módulo nativo del main process. La web cae a navigator.clipboard.
    ipcMain.on("clipboard:write", (_evt, text) => {
        if (typeof text === "string") clipboard.writeText(text);
    });

    ipcMain.on("timer-widget:open", () => timerWidget.open());
    ipcMain.on("timer-widget:close", () => timerWidget.close());
    ipcMain.on("timer-widget:expand", (_evt, value) => timerWidget.setExpanded(value));
    ipcMain.on("timer-widget:move", (_evt, { dx = 0, dy = 0 } = {}) => timerWidget.moveBy(dx, dy));
    // O renderer mede o conteúdo e pede a altura do estado expandido.
    ipcMain.on("timer-widget:height", (_evt, height) => timerWidget.setContentHeight(height));
}

module.exports = { registerIpc };
