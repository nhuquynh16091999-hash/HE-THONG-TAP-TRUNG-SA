"use client";

/**
 * Lỗi trong phạm vi /talpha — giữ được layout gốc nên còn nút "Thử lại màn
 * hình này" (React dựng lại nhánh cây mà không tải lại cả trang).
 */
import ErrorRecovery from "@/components/ui/error-recovery";

export default function TalphaError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return <ErrorRecovery error={error} reset={reset} />;
}
