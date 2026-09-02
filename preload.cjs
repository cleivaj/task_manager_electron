"use strict";

// Preload (mundo aislado): expone `window.desktop` a la app y inyecta el shim
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

// Shim inyectado en el main world: escucha el bus realtime de la app (el mismo
// stream SSE que la web ya mantiene abierto, /notification/stream) y traduce
// cada evento NOTIFICATION en una notificación nativa del SO.
//   • Solo notifica cuando la app NO está enfocada (el sino in-app ya cubre el
//     caso enfocado) y solo desde la ventana principal (no la de llamada).
const SHIM = `(() => {
    const LABELS = ${JSON.stringify(NOTIFICATION_LABELS)};
    window.addEventListener("kova:realtime", (e) => {
        const detail = e && e.detail;
        if (!detail || detail.type !== "NOTIFICATION") return;
        if (document.hasFocus() || window.opener) return;
        const type = detail.notificationType || "";
        const label = LABELS[type] || "you have a new notification";
        const actor = detail.data && typeof detail.data.actorName === "string"
            ? detail.data.actorName.trim()
            : "";
        const body = actor
            ? actor + " " + label
            : label.charAt(0).toUpperCase() + label.slice(1);
        if (window.desktop && typeof window.desktop.notify === "function") {
            window.desktop.notify({ title: "Kova", body, tag: detail.notificationId || type });
        }
    });
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