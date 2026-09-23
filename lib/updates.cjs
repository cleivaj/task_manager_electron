"use strict";

const { app, shell } = require("electron");
const softUpdater = require("../updater.cjs");
const { RELEASES_URL } = require("./config.cjs");
const { dbg } = require("./log.cjs");
const { showToast } = require("./notifications.cjs");

// Host del auto-update: elige el motor según plataforma y es el único que
// conoce el estado de la actualización. Quien pinta es el tray, así que aquí se
// expone (a) los items de menú del estado actual y (b) el "Check for updates…"
// manual; el tray no sabe nada de updaters.
//
//   • Windows empaquetado / Linux AppImage → electron-updater: descarga en
//     segundo plano y pide reiniciar (auto-update silencioso).
//   • macOS → soft notifier: sin firma Developer ID, Squirrel.Mac no puede
//     reemplazar la app (regla de Apple), así que avisa y descarga el DMG.
//   • Linux por pacman (sin APPIMAGE) y desarrollo (`npm start`) → soft notifier
//     (el feed de electron-updater no existe fuera del build).

let softInfo = null; // { version, url, notes, assets } — soft notifier
let autoUpdaterApi = null; // electron-updater (Windows / Linux AppImage)
let autoUpdateState = null; // { version, phase: "downloading" | "ready" }
let manualCheck = null; // el "Check for updates…" que toca según el motor
let onStateChange = () => {};

// Items del menú del tray para el estado actual (vacío = nada que anunciar).
function menuItems() {
    if (autoUpdateState) {
        const items = [{ type: "separator" }];
        if (autoUpdateState.phase === "ready") {
            items.push({
                label: `Restart & update to Omni ${autoUpdateState.version}`,
                click: () => {
                    try {
                        autoUpdaterApi?.quitAndInstall();
                    } catch {
                        /* noop */
                    }
                },
            });
        } else {
            items.push({ label: `Downloading Omni ${autoUpdateState.version}…`, enabled: false });
        }
        items.push({ label: "Release notes", click: () => shell.openExternal(RELEASES_URL) });
        return items;
    }

    if (softInfo) {
        // Soft notifier (macOS / Linux pacman / desarrollo): descarga manual.
        return [
            { type: "separator" },
            { label: `Download Omni ${softInfo.version}`, click: () => softUpdater.downloadUpdate(softInfo) },
            {
                label: "Release notes",
                click: () => {
                    if (softInfo.url) shell.openExternal(softInfo.url);
                },
            },
        ];
    }

    return [];
}

function checkForUpdatesManual() {
    return manualCheck ? manualCheck() : softUpdater.checkForUpdates({ manual: true });
}

// --- Motor A: soft notifier (GitHub Releases + descarga manual) --------------
function startSoftUpdater() {
    manualCheck = () => softUpdater.checkForUpdates({ manual: true });
    softUpdater.startUpdater({
        onState: (info) => {
            softInfo = info;
            onStateChange(); // el tray reconstruye el menú con la sección de update
        },
    });
}

// --- Motor B: electron-updater (auto-update silencioso) ----------------------
function startAutoUpdater() {
    const { autoUpdater } = require("electron-updater");
    autoUpdaterApi = autoUpdater;
    autoUpdater.autoDownload = true; // descarga en segundo plano; avisamos al estar listo
    autoUpdater.logger = {
        info: (m) => dbg("autoUpdater:", m),
        warn: (m) => dbg("autoUpdater warn:", m),
        error: (m) => dbg("autoUpdater error:", m),
    };

    let manualPending = false;
    let manualNotified = false; // evita doble toast (evento + resultado del check)
    const upToDate = () => showToast("Omni", `You are up to date (${app.getVersion()}).`);

    autoUpdater.on("update-available", (info) => {
        const version = info?.version || "";
        dbg("auto-update available:", version);
        manualPending = false;
        autoUpdateState = { version, phase: "downloading" };
        onStateChange();
    });

    autoUpdater.on("update-not-available", () => {
        dbg("auto-update: up to date");
        if (manualPending && !manualNotified) {
            manualNotified = true;
            manualPending = false;
            upToDate();
        }
    });

    autoUpdater.on("update-downloaded", (info) => {
        const version = info?.version || "";
        dbg("auto-update downloaded:", version);
        autoUpdateState = { version, phase: "ready" };
        onStateChange();
        showToast(`Omni ${version} downloaded`, "Click to restart and install the update.", () => {
            try {
                autoUpdater.quitAndInstall();
            } catch {
                /* noop */
            }
        });
    });

    autoUpdater.on("error", (err) => {
        dbg("autoUpdater error:", err?.message ?? err);
        // Un fallo de descarga (404, red…) no debe dejar el tray clavado en
        // "Downloading…": restauramos el menú base para que se pueda reintentar.
        if (autoUpdateState?.phase === "downloading") {
            autoUpdateState = null;
            onStateChange();
        }
        if (manualPending && !manualNotified) {
            manualNotified = true;
            manualPending = false;
            showToast("Omni", "Update check failed. Try again later.");
        }
        // Error en check automático: no molesta, el siguiente reintenta.
    });

    manualCheck = async () => {
        manualPending = true;
        manualNotified = false;
        try {
            const result = await autoUpdater.checkForUpdates();
            if (result === null) {
                manualPending = false;
                return; // updater inactivo (dev)
            }
            // La notificación normal sale por update-not-available; si el evento no
            // dispara (Windows a veces no lo emite en re-checks manuales), usamos el
            // resultado devuelto por checkForUpdates.
            if (!result.isUpdateAvailable && manualPending && !manualNotified) {
                manualNotified = true;
                manualPending = false;
                upToDate();
            }
        } catch (err) {
            dbg("manual check failed:", err?.message ?? err);
            if (manualPending && !manualNotified) {
                manualNotified = true;
                showToast("Omni", "Update check failed. Try again later.");
            }
            manualPending = false;
        }
    };

    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    setTimeout(check, 15000); // primer check poco después del arranque
    setInterval(check, 6 * 60 * 60 * 1000); // y luego cada 6 h
}

/**
 * Arranca el motor que toca. `onState` se llama cuando cambia el estado de la
 * actualización (para repintar el menú del tray).
 */
function start({ onState } = {}) {
    if (onState) onStateChange = onState;
    const appImage = process.platform === "linux" && Boolean(process.env.APPIMAGE);
    const soft = !app.isPackaged || process.platform === "darwin" || (process.platform === "linux" && !appImage);
    if (soft) startSoftUpdater();
    else startAutoUpdater();
}

module.exports = { start, menuItems, checkForUpdatesManual };
