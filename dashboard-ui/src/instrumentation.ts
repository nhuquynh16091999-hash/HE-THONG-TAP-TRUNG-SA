/**
 * Next.js Instrumentation — chạy 1 lần khi server khởi động.
 * Catch ECONNRESET / ECONNABORTED errors để tránh PM2 restart loop.
 *
 * Root cause: EventSource (SSE) trong LiveFeed.tsx giữ kết nối liên tục.
 * Khi user đóng tab, server nhận ECONNRESET → uncaughtException → crash.
 * Fix: bắt các lỗi network "expected" ở process level, không crash.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        // Sinh sẵn chìa nội bộ (data/.internal_token) ngay lúc khởi động — bot Zalo và việc
        // nền đọc file này để gọi API. Đợi tới lượt gọi đầu mới sinh thì bot chưa có chìa
        // nên chẳng bao giờ có "lượt gọi đầu". Xem lib/talpha/internal-token.ts.
        try {
            const { internalToken } = await import("@/lib/talpha/internal-token");
            internalToken();
        } catch (e) {
            console.error("[TALPHA] Không sinh được chìa nội bộ data/.internal_token:", e);
        }

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
