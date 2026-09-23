"use strict";

const { Menu, desktopCapturer, session } = require("electron");
const { dbg } = require("../log.cjs");
const macos = require("./macos.cjs");

// Compartir pantalla. Electron delega en nosotros qué fuente se concede, así que
// aquí vive el gate por permiso del SO (macOS) y el picker nativo.
//
// Criterio del picker:
//   • 0 o 1 fuentes → conceder (o cancelar) directo: un menú de un solo item bajo
//     el cursor se cierra con el mouse-up del click que lo abrió y pierde la
//     elección (bug real en Wayland).
//   • varias fuentes → menú nativo en el cursor. El click del item corre síncrono
//     antes de menu-will-close; la cancelación se difiere un tick para nunca
//     tragarse una elección real (bug real en Windows/Linux).

// Quién pide el stream (solo para el log).
function requesterUrl(request) {
    try {
        const frameUrl = request?.frame?.url;
        if (frameUrl) return frameUrl;
        return request?.securityOrigin ?? "(no origin)";
    } catch {
        return "(no origin)";
    }
}

async function onDisplayMediaRequest(request, callback) {
    // Electron lanza un TypeError si el request pide vídeo y el callback llega
    // sin stream (cancelación) — lo absorbemos; la web recibe el reject.
    const grant = (streams) => {
        try {
            callback(streams);
        } catch {
            /* cancel */
        }
    };

    dbg("[display-media] REQUEST video=", request?.videoRequested, "audio=", request?.audioRequested, "from=", requesterUrl(request));

    try {
        // macOS: Screen Recording es un permiso TCC independiente (10.15+). Si ya
        // está denegado, el prompt no se puede reintentar sin reiniciar la app.
        if (process.platform === "darwin") {
            const before = macos.screenRecordingStatus();
            dbg("[display-media] mac TCC screen status BEFORE:", before);
            if (macos.isScreenRecordingBlocked(before)) {
                dbg("[display-media] ABORT: Screen Recording denegado — activar en System Settings → Privacy & Security → Screen Recording y reiniciar la app");
                grant({});
                return;
            }
        }

        const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });

        // El primer getSources muestra el prompt del SO; si el user lo negó ahora,
        // no conceder.
        if (process.platform === "darwin") {
            const after = macos.screenRecordingStatus();
            dbg("[display-media] mac TCC screen status AFTER getSources:", after);
            if (macos.isScreenRecordingBlocked(after)) {
                dbg("[display-media] ABORT: user denied/restricted el prompt de Screen Recording");
                grant({});
                return;
            }
        }

        dbg("[display-media] sources found:", sources.length, "->", sources.map((s) => `${s.name} (${s.id})`).join(" | "));

        if (sources.length <= 1) {
            if (sources[0]) {
                dbg("[display-media] 1 source -> granting direct:", sources[0].name, "(", sources[0].id, ")");
                grant({ video: sources[0] });
            } else {
                dbg("[display-media] 0 sources -> nothing to grant");
                grant({});
            }
            return;
        }

        let done = false;
        const choose = (streams, picked) => {
            if (done) return;
            done = true;
            if (picked) dbg("[display-media] PICKED:", picked.name, "(", picked.id, ")");
            else dbg("[display-media] menu closed sin elección (cancel)");
            grant(streams);
        };
        const template = sources.map((s) => ({
            label: s.name,
            // Objeto DesktopCapturerSource COMPLETO: en Windows el capturador
            // necesita campos como display_id; un {id,name} parcial concede el
            // permiso pero el stream nunca nace.
            click: () => choose({ video: s }, s),
        }));
        const menu = Menu.buildFromTemplate(template);
        menu.on("menu-will-close", () => setTimeout(() => choose({}), 0));
        dbg("[display-media] showing native menu with", sources.length, "items");
        menu.popup();
    } catch (err) {
        dbg("[display-media] ERROR:", err?.message ?? err);
        grant({});
    }
}

function setupScreenSharing(ses = session.defaultSession) {
    ses.setDisplayMediaRequestHandler(onDisplayMediaRequest);
}

module.exports = { setupScreenSharing };
