/**
 * Next.js Instrumentation — chạy 1 lần khi server khởi động.
 * Catch ECONNRESET / ECONNABORTED errors để tránh PM2 restart loop.
 *
 * Root cause: EventSource (SSE) trong LiveFeed.tsx giữ kết nối liên tục.
 * Khi user đóng tab, server nhận ECONNRESET → uncaughtException → crash.
 * Fix: bắt các lỗi network "expected" ở process level, không crash.
 */
export function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
            const ignoredCodes = ["ECONNRESET", "ECONNABORTED", "EPIPE", "ENOTFOUND"];
            if (err.code && ignoredCodes.includes(err.code)) {
                // Client disconnected — expected behavior, không crash
                return;
            }
            // Lỗi thật → log và để Next.js xử lý bình thường
            console.error("[FAOS] Uncaught exception:", err);
        });

        process.on("unhandledRejection", (reason: unknown) => {
            const msg = String(reason);
            if (msg.includes("ECONNRESET") || msg.includes("aborted") || msg.includes("EPIPE")) {
                return;
            }
            console.error("[FAOS] Unhandled rejection:", reason);
        });
    }
}
