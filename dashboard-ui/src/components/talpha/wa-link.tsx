import { MessageCircle } from "lucide-react";
import { cn } from "./utils";

/**
 * Nút mở WhatsApp với khách, kèm tin XÁC NHẬN ĐƠN soạn sẵn (Sỹ Anh chốt 29/09/2026: chỉ UAE;
 * nút phải TO, đặt chỗ bấm ngay được vì ngày nào cũng xác nhận đơn với khách).
 *
 * `href` dựng sẵn ở máy chủ (lib/talpha/whatsapp.ts): nước không bật WhatsApp, hoặc số không
 * chắc, thì máy chủ trả null và nút không hiện — link sai là nhắn nhầm người.
 *
 *   md — trong bảng (Sổ đơn, danh sách vận đơn)
 *   lg — trên thẻ cảnh báo (Theo dõi vận đơn)
 */
export default function WaLink({ href, size = "md", className }: {
    href?: string | null; size?: "md" | "lg"; className?: string;
}) {
    if (!href) return null;
    const so = href.replace(/^https:\/\/wa\.me\//, "+").replace(/\?.*$/, "");
    return (
        <a href={href} target="_blank" rel="noopener noreferrer"
            title={`Mở WhatsApp ${so} — tin xác nhận đơn đã soạn sẵn, sửa được trước khi gửi`}
            className={cn("inline-flex flex-none items-center justify-center gap-1.5 rounded-lg bg-emerald-600 font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400",
                size === "lg" ? "px-4 py-2 text-sm" : "px-3 py-1 text-[12.5px]", className)}>
            <MessageCircle className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />WhatsApp
        </a>
    );
}
