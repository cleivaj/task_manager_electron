"use strict";

// Permisos TCC de macOS. La app no puede concederlos sola: cada uno tiene su
// propia vía y ninguna sirve para el otro.
//
//   • Cámara / micrófono → systemPreferences.askForMediaAccess(). Dispara el
//     prompt la primera vez; después devuelve el estado ya decidido.
//   • Grabación de pantalla → NO se pide con askForMediaAccess (solo acepta
//     "camera"/"microphone"). El prompt lo dispara la primera llamada a
//     desktopCapturer.getSources(), y el estado se consulta con
//     getMediaAccessStatus("screen").
//
// Solo se llama bajo `process.platform === "darwin"` (los getters de
// systemPreferences no existen en Linux; en Windows el gate es del propio SO).

const { systemPreferences } = require("electron");

// Promesas pendientes de askForMediaAccess para lo que pida el renderer.
// Array vacío = no hay nada que pedir (el caller concede directo sin esperar).
function mediaAccessRequests(mediaTypes = []) {
    const asks = [];
    if (mediaTypes.includes("video")) asks.push(systemPreferences.askForMediaAccess("camera"));
    if (mediaTypes.includes("audio")) asks.push(systemPreferences.askForMediaAccess("microphone"));
    return asks;
}

// "granted" | "denied" | "restricted" | "not-determined" (grabación de pantalla).
function screenRecordingStatus() {
    return systemPreferences.getMediaAccessStatus("screen");
}

// Un permiso denegado o restringido por el SO: no hay nada que capturar y
// reintentarlo sin cambiarlo en System Settings no sirve.
function isScreenRecordingBlocked(status) {
    return status === "denied" || status === "restricted";
}

module.exports = { mediaAccessRequests, screenRecordingStatus, isScreenRecordingBlocked };
