"use strict";

// Preload (mundo aislado): expone `window.desktop` a la app e inyecta el shim
// en el MAIN WORLD de la página — porque el bus realtime de Kova (kova:realtime)
// despacha CustomEvents en el `window` del main world, no del aislado.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
    platform: process.platform,
    isDesktop: true,
    // La página pide una notificación nativa → main process → Notification del SO.
    notify: (payload) => ipcRenderer.send("notify", payload),
});

// Los mismos labels que front/src/modules/notification/domain/entities/Notification.entity.ts
// (NOTIFICATION_LABEL). Duplicados aquí para que el shell sea cero-cambios en la web.
const NOTIFICATION_LABELS = {
    TASK_ASSIGNED: "assigned you to a task",
    TASK_COMMENTED: "commented on a task",
    TASK_COMPLETED: "marked a task as done",
    TASK_IN_VALIDATION: "sent a task to validation",
    TASK_REOPENED: "reopened a task",
    EVENT_REMINDER: "reminds you about an event",
    EVENT_INVITED: "added you to an event",
    EVENT_REMOVED: "removed you from an event",
    EVENT_CANCELLED: "cancelled an event",
    GROUP_ADDED: "added you to a group chat",
    GROUP_MENTIONED: "mentioned you in a group chat",
    TEAM_ADDED: "added you to a team",
    TEAM_REMOVED: "removed you from a team",
    TASK_MENTIONED: "mentioned you in a comment",
    CHAT_MESSAGE: "sent you a message",
    GROUP_MESSAGE: "sent a message in a group chat",
    TASK_DELETED: "deleted a task",
    PROJECT_MEMBER_REMOVED: "removed you from a project",
    EVENT_UPDATED: "updated an event",
    GROUP_REMOVED: "removed you from a group chat",
    GROUP_DELETED: "deleted a group chat",
    WORKSPACE_INVITED: "invited you to a workspace",
    TASK_DUE_SOON: "reminds you about a task",
    PROJECT_DELETED: "deleted a project",
    WORKSPACE_MEMBER_REMOVED: "removed you from a workspace",
    CALL_INVITED: "invited you to a video call",
};

// Shim inyectado en el main world. Traduce en notificaciones nativas del SO:
//   1. El bus realtime de la app (kova:realtime, alimentado por el stream SSE
//      /notification/stream que la web mantiene abierto).
//   2. Un POLL FALLBACK a /notification/latest (auth por query token, misma
//      ruta que /stream): si el stream SSE de la app muere (horas en tray,
//      token, red), las notificaciones SIGUEN llegando al centro del SO.
//      El token/workspace/api se leen de la pushSession en IndexedDB (la misma
//      que usa el service worker). Dedupe compartido: nada tosta dos veces.
//   • Notifica SIEMPRE (apps de escritorio nativas como Teams/WhatsApp notifican
//     aunque la ventana esté enfocada). Solo se excluye la ventana de llamada
//     (window.opener).
const SHIM = `(() => {
    const LABELS = ${JSON.stringify(NOTIFICATION_LABELS)};
    const POLL_MS = 45000;        // cadencia del poll fallback
    const FIRST_POLL_DELAY_MS = 5000;
    const RECENT_WINDOW_MS = 120000; // solo tosta lo creado en los últimos 2 min
    const MAX_SEEN = 600;
    const seen = new Set();

    function remember(id) {
        seen.add(id);
        if (seen.size > MAX_SEEN) seen.clear(); // cota de memoria; la ventana de 2 min evita re-toasts
    }

    // --- Camino 1: bus realtime (SSE de la app) ---
    function fromBus(detail) {
        if (!detail || detail.type !== "NOTIFICATION") return;
        if (window.opener) return;
        const id = detail.notificationId || "";
        if (!id || seen.has(id)) return;
        remember(id);
        const type = detail.notificationType || "";
        const label = LABELS[type] || "you have a new notification";
        const actor = detail.data && typeof detail.data.actorName === "string"
            ? detail.data.actorName.trim()
            : "";
        const body = actor
            ? actor + " " + label
            : label.charAt(0).toUpperCase() + label.slice(1);
        if (window.desktop && typeof window.desktop.notify === "function") {
            window.desktop.notify({ title: "Kova", body });
        }
    }

    window.addEventListener("kova:realtime", (e) => {
        const detail = e && e.detail;
        if (detail && detail.type === "NOTIFICATION") fromBus(detail);
    });

    // --- Camino 2: poll fallback a /notification/latest ---
    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open("kova_push_session", 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions");
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function readSession() {
        try {
            const db = await openDb();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction("sessions", "readonly");
                const get = tx.objectStore("sessions").get("current");
                get.onsuccess = () => resolve(get.result || null);
                get.onerror = () => reject(get.error);
            });
        } catch {
            return null;
        }
    }

    async function pollLatest() {
        if (window.opener || !window.desktop) return;
        const session = await readSession();
        const token = session && session.notificationToken;
        const workspaceId = session && session.workspaceId;
        const apiUrl = session && session.apiUrl;
        if (!token || !workspaceId || !apiUrl) return;

        try {
            const url = apiUrl + "/notification/latest"
                + "?token=" + encodeURIComponent(token)
                + "&workspaceId=" + encodeURIComponent(workspaceId);
            const res = await fetch(url);
            if (!res.ok) return;
            const json = await res.json();
            const items = (json && json.payload && json.payload.notifications) || [];
            const cutoff = Date.now() - RECENT_WINDOW_MS;
            for (const n of items) {
                if (!n || !n.id || seen.has(n.id)) continue;
                const created = n.createdAt ? new Date(n.createdAt).getTime() : NaN;
                if (Number.isNaN(created) || created < cutoff) continue;
                remember(n.id);
                if (window.desktop && typeof window.desktop.notify === "function") {
                    window.desktop.notify({ title: n.title || "Kova", body: n.body || "" });
                }
            }
        } catch {
            // red/offline: el siguiente tick reintenta
        }
    }

    setTimeout(() => {
        pollLatest();
        setInterval(pollLatest, POLL_MS);
    }, FIRST_POLL_DELAY_MS);
})();`;

function injectShim() {
    const script = document.createElement("script");
    script.textContent = SHIM;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectShim, { once: true });
} else {
    injectShim();
}
