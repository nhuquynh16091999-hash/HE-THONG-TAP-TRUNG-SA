/**
 * Trần dung lượng file tải lên.
 *
 * Vercel chặn cứng thân request ở 4,5MB và trả lỗi 413 — không cấu hình tăng
 * được. Đặt 4MB để còn chỗ cho phần bao ngoài của multipart. Chạy ở máy thì ổ
 * đĩa là của mình, cho rộng hơn.
 */
export const MAX_UPLOAD_BYTES = process.env.VERCEL ? 4 * 1024 * 1024 : 16 * 1024 * 1024;

export function tooBigMessage(): string {
    const mb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);
    return `File quá ${mb}MB — cắt bớt kỳ rồi tải lại` +
        (process.env.VERCEL ? " (nền Vercel chặn cứng ở 4,5MB)" : "");
}
