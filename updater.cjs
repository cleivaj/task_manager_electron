"use strict";

// Actualizador Kova (soft update multi-plataforma):
//   • Fuente de versión: GitHub Releases del repo desktop (público) — la API
//     /releases/latest se lee sin token. El CI publica un Release por push a
//     `prod` con los instaladores de las 3 plataformas.
//   • Cada instalación comprueba al arrancar y cada 6 h; si hay versión nueva
//     anuncia (Notification nativa + item en el tray) y el clic descarga el
//     instalador correcto para la plataforma y lo abre:
//       win32  → .exe NSIS  (instala sobre la versión actual)
//       darwin → .dmg       (se monta; arrastrar a Applications — un .app sin
//                            firma no puede sustituirse a sí mismo en macOS,
//                            es una regla del SO, no de esta app)
//       linux  → .AppImage  (chmod +x y se ejecuta)
//   • Sin dependencias externas; falla silencioso (offline / rate-limit) y
//     reintenta en el siguiente tick.

const { app, net, shell, Notification } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const stream = require("node:stream");
const { pipeline } = require("node:stream/promises");

const UPDATE_REPO = "cleivaj/task_manager_electron";
const LATEST_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // cada 6 h
const FIRST_CHECK_DELAY_MS = 10 * 1000; // 10 s tras arrancar (la ventana ya está visible)
const NOTIFY_LABEL = "Kova";

// Debug solo visible en desarrollo (misma regla que main.cjs).
const dbg = (...args) => {
    if (!app.isPackaged) console.log("[kova-update]", ...args);
};

// Estado por sesión.
let announcedVersion = null; // solo se anuncia UNA vez por versión
let onStateChange = null; // el main reconstruye el menú del tray con esto

// --- Semver minimalista (0.1.5 / v0.1.10 → compara numérico, tolera prefijo v) ---
function parseSemver(v) {
    return String(v || "")
        .replace(/^v/i, "")
        .split(/[.-]/)
        .map((p) => parseInt(p, 10) || 0);
}

function isNewer(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d > 0;
    }
    return false;
}

// --- Feed: última release de GitHub (público, sin token) ---
async function fetchLatestRelease() {
    const res = await net.fetch(LATEST_API, {
        headers: {
            "User-Agent": "Kova-Desktop",
            Accept: "application/vnd.github+json",
        },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const json = await res.json();
    return {
        version: String(json.tag_name || "").replace(/^v/i, ""),
        url: json.html_url,
        notes: json.body || "",
        assets: (json.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url })),
    };
}

// El instalador correcto para esta plataforma/arquitectura.
function pickAsset(assets) {
    const name = (a) => String(a.name || "").toLowerCase();
    if (process.platform === "win32") {
        return assets.find((a) => name(a).endsWith(".exe"));
    }
    if (process.platform === "darwin") {
        const dmgs = assets.filter((a) => name(a).endsWith(".dmg"));
        if (process.arch === "arm64") return dmgs.find((a) => name(a).includes("arm64")) || dmgs[0];
        return dmgs.find((a) => !name(a).includes("arm64")) || dmgs[0];
    }
    if (process.platform === "linux") {
        return assets.find((a) => name(a).endsWith(".appimage"));
    }
    return null;
}

// Descarga el instalador a Descargas y lo abre (instala / monta / ejecuta).
async function downloadAndOpen(info) {
    const asset = pickAsset(info.assets);
    if (!asset) {
        shell.openExternal(info.url); // sin asset para esta plataforma → página del Release
        return;
    }
    try {
        dbg("downloading", asset.name);
        const res = await net.fetch(asset.url, { headers: { "User-Agent": "Kova-Desktop" } });
        if (!res.ok) throw new Error(`download ${res.status}`);
        const target = path.join(app.getPath("downloads"), asset.name);
        const ws = fs.createWriteStream(target);
        await pipeline(stream.Readable.fromWeb(res.body), ws);
        if (process.platform === "linux") {
            try { fs.chmodSync(target, 0o755); } catch { /* noop */ }
        }
        dbg("saved to", target);
        await shell.openPath(target);
    } catch (err) {
        dbg("download failed:", err?.message ?? err);
        // Si la descarga falla, al menos abrir la página del Release.
        shell.openExternal(info.url);
    }
}

function announce(info) {
    if (announcedVersion === info.version) return;
    announcedVersion = info.version;
    const n = new Notification({
        title: `${NOTIFY_LABEL} ${info.version} is available`,
        body: `You are on ${app.getVersion()}. Click to download and update.`,
    });
    n.on("click", () => { void downloadAndOpen(info); });
    n.show();
}

// Comprueba contra GitHub y actualiza el estado + el menú del tray.
async function checkForUpdates({ manual = false } = {}) {
    try {
        const info = await fetchLatestRelease();
        const current = app.getVersion();
        if (!isNewer(info.version, current)) {
            dbg("up to date (", current, ")");
            if (manual) {
                new Notification({
                    title: NOTIFY_LABEL,
                    body: `You are up to date (${current}).`,
                }).show();
            }
            return;
        }
        dbg("update available:", info.version, "current:", current);
        if (onStateChange) onStateChange(info);

        // Auto (no manual): solo molesta con Notification en app empaquetada;
        // en desarrollo el item del tray ya lo muestra. El check manual SIEMPRE
        // anuncia (así se prueba con `npm start`).
        if (manual || app.isPackaged) announce(info);
    } catch (err) {
        dbg("check failed:", err?.message ?? err); // offline / rate-limit: reintenta luego
    }
}

// Inicio: primer check con retardo + intervalo.
function startUpdater({ onState } = {}) {
    onStateChange = onState;
    setTimeout(() => { void checkForUpdates(); }, FIRST_CHECK_DELAY_MS);
    setInterval(() => { void checkForUpdates(); }, CHECK_INTERVAL_MS);
}

module.exports = {
    startUpdater,
    checkForUpdates,
    downloadUpdate: downloadAndOpen,
};
