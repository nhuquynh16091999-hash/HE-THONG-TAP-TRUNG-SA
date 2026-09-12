"use client";

/**
 * Lưới hứng lỗi CUỐI CÙNG — bắt cả lỗi xảy ra trong chính layout gốc.
 * Vì nó thay thế toàn bộ tài liệu nên phải tự dựng <html> và <body>.
 *
 * Không dùng font/theme provider ở đây: nếu lỗi đến TỪ chúng thì gọi lại là
 * lỗi tiếp, và người dùng lại thấy trang trắng.
 */
import ErrorRecovery from "@/components/ui/error-recovery";
import "./globals.css";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
    return (
        <html lang="vi">
            <body className="bg-background text-foreground antialiased">
                <ErrorRecovery error={error} />
            </body>
        </html>
    );
}
