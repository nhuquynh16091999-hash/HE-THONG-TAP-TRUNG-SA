"use client";

/**
 * Màn báo lỗi dùng chung cho mọi error boundary, và cơ chế TỰ CỨU khi trang
 * đang chạy bản build cũ.
 *
 * Vì sao cần: mỗi lần deploy, Next.js đặt tên mới cho toàn bộ file chunk
 * JavaScript. Tab nào đang mở từ trước vẫn giữ HTML cũ trỏ vào tên chunk cũ —
 * những file đó không còn trên máy chủ. Bấm vào bất cứ thứ gì cần nạp thêm code
 * là trình duyệt ném ChunkLoadError.
 *
 * Trước 12/09/2026 ứng dụng KHÔNG có error boundary nào, nên lỗi đó hiện ra dưới
 * dạng trang trắng với đúng một câu của Next.js: "Đã xảy ra lỗi ngoại lệ phía
 * máy khách". Không nói trang nào, không nói vì sao, không có gì bấm được.
 * Dính thật 11/09: sau khi deploy, tab đang mở bấm "Chạy đối soát" là trắng
 * trang — và vì yêu cầu chưa kịp gửi đi, máy chủ không có một dòng log nào.
 *
 * Nay: nhận ra lỗi kiểu đó thì tự tải lại trang MỘT lần (đủ để lấy bản mới),
 * và chỉ khi tải lại vẫn lỗi mới hiện màn báo — kèm nút bấm được.
 */

import { useEffect, useState } from "react";

/** Khoá chống tải lại vô tận: chỉ cho phép một lần tự cứu trong 30 giây. */
const KHOA = "talpha:tu-tai-lai-luc";
const CACH_NHAU_MS = 30_000;

/**
 * Lỗi do trang đang chạy bản build CŨ, sau khi máy chủ đã deploy bản mới.
 *
 * Hai kiểu, cả hai đều chỉ cần tải lại trang:
 *   • file chunk JavaScript đổi tên  → ChunkLoadError
 *   • mã Server Action đổi           → "Failed to find Server Action" (chính
 *     Next.js ghi thêm "This request might be from an older or newer
 *     deployment"). Log máy chủ ngày 11–12/09 có 92 lượt đúng lỗi này.
 */
function laBanCu(e: Error & { digest?: string }): boolean {
    const s = `${e?.name || ""} ${e?.message || ""}`;
    return /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed|Failed to find Server Action|older or newer deployment|unexpected response was received from the server/i.test(s);
}

function docKhoa(): number {
    try { return Number(sessionStorage.getItem(KHOA) || 0); } catch { return 0; }
}
function ghiKhoa(t: number) {
    try { sessionStorage.setItem(KHOA, String(t)); } catch { /* chế độ ẩn danh — bỏ qua */ }
}

export default function ErrorRecovery({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
    // "cuu" = đang tự tải lại, chỉ hiện dòng chờ thay vì màn báo lỗi đầy đủ.
    const [dangCuu, setDangCuu] = useState(false);

    useEffect(() => {
        console.error("[TALPHA] lỗi phía máy khách:", error);
        if (!laBanCu(error)) return;
        const now = Date.now();
        if (now - docKhoa() < CACH_NHAU_MS) return;   // vừa thử rồi, đừng quay vòng
        ghiKhoa(now);
        setDangCuu(true);
        window.location.reload();
    }, [error]);

    if (dangCuu) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                <p className="text-sm text-muted-foreground">Dashboard vừa được cập nhật — đang tải lại bản mới…</p>
            </div>
        );
    }

    const banCu = laBanCu(error);

    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
            <div className="w-full max-w-xl rounded-xl border border-rose-300 bg-rose-50/60 p-5 dark:border-rose-500/30 dark:bg-rose-500/5">
                <h2 className="mb-1 text-base font-semibold text-rose-700 dark:text-rose-400">
                    {banCu ? "Trang đang chạy bản cũ" : "Màn hình này gặp lỗi"}
                </h2>
                <p className="mb-3 text-sm text-muted-foreground">
                    {banCu
                        ? "Dashboard đã được cập nhật trong lúc tab này đang mở. Tải lại trang là xong — dữ liệu không mất gì."
                        : "Phần còn lại của dashboard vẫn dùng được. Thử lại màn hình này, hoặc tải lại trang."}
                </p>

                {/* Nội dung lỗi để dán vào tin nhắn báo lỗi — không bắt người dùng đi mở
                    bảng điều khiển trình duyệt mới biết chuyện gì xảy ra. */}
                <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-background/70 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                    {error?.name ? `${error.name}: ` : ""}{error?.message || "(không có nội dung lỗi)"}
                    {error?.digest ? `\n\nmã: ${error.digest}` : ""}
                </pre>

                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => window.location.reload()}
                        className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-orange-600"
                    >
                        Tải lại trang
                    </button>
                    {reset && (
                        <button
                            onClick={reset}
                            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-muted"
                        >
                            Thử lại màn hình này
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
