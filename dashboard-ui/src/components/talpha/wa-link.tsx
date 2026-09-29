import { MessageCircle } from "lucide-react";
import { cn } from "./utils";

/**
 * Nút mở khung chat WhatsApp với khách (Sỹ Anh yêu cầu 29/09/2026). `href` dựng sẵn ở máy chủ
 * (lib/talpha/whatsapp.ts, luật mã nước ở talpha_rules.json → markets.*.phone); số không chắc
 * thì máy chủ trả null và nút không hiện — link sai là nhắn nhầm người.
 *
 *   compact — chip "WA" nhỏ đặt cạnh số điện thoại trong bảng dày
 *   button  — nút "WhatsApp" cạnh nút "Gọi"
 */
export default function WaLink({ href, variant = "compact", className }: {
    href?: string | null; variant?: "compact" | "button"; className?: string;
}) {
    if (!href) return null;
    const so = href.replace(/^https:\/\/wa\.me\//, "+");
    if (variant === "button") {
        return (
            <a href={href} target="_blank" rel="noopener noreferrer" title={`Nhắn WhatsApp ${so}`}
                className={cn("inline-flex flex-none items-center rounded-lg border border-emerald-300 px-2.5 py-1.5 text-[12px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10", className)}>
                <MessageCircle className="mr-1 h-3 w-3" />WhatsApp
            </a>
        );
    }
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" title={`Nhắn WhatsApp ${so}`}
            aria-label={`Nhắn WhatsApp ${so}`}
            className={cn("ml-1.5 inline-flex items-center gap-0.5 rounded-[3px] bg-emerald-100 px-1 align-middle font-sans text-[9.5px] font-semibold text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25", className)}>
            <MessageCircle className="h-2.5 w-2.5" />WA
        </a>
    );
}
