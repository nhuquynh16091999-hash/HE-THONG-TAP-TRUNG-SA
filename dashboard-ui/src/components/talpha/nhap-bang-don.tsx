"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════
   BẢNG ĐƠN ĐỐI TÁC NẠP LÚC NÀO

   Sổ đơn và toàn bộ màn Đối soát COD đọc từ kho `tracking` — kho đó CHỈ đổi khi
   việc nền 6h sáng chạy, hoặc khi có người bấm "Đọc bảng đối tác". Không nói ra
   thì số của tuần trước trông y hệt số hôm nay: ngày 16/09/2026 Sỹ Anh mở màn
   Đối soát COD và hỏi vì sao nó đứng yên — số khi đó nạp từ 09/09, đã bảy ngày.
   ═══════════════════════════════════════════════════════════════════ */

export type NhapBangDon = {
    luc: string | null;
    nguon?: string | null;
    so_don?: number;
    /** Số mã vận đơn bị nhiều dòng Sheet dùng chung. */
    ma_trung?: number;
};

const GIO = 3_600_000;

function gioVN(iso: string) {
    const d = new Date(iso);
    const p = (o: Intl.DateTimeFormatOptions) => d.toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", ...o });
    return `${p({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} ngày `
        + `${p({ day: "2-digit" })}/${p({ month: "2-digit" })}`;
}

function tuoiChu(gio: number) {
    if (gio < 1) return "vừa nạp xong";
    if (gio < 24) return `${Math.floor(gio)} giờ trước`;
    return `${Math.floor(gio / 24)} ngày trước`;
}

export default function ThanhNhapBangDon({ n, gioCanhBao = 24 }: { n?: NhapBangDon | null; gioCanhBao?: number }) {
    if (!n) return null;
    const gio = n.luc ? (Date.now() - Date.parse(n.luc)) / GIO : Infinity;
    const cu = !n.luc || gio > gioCanhBao;

    return (
        <div className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2.5 text-[13px]",
            cu
                ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
                : "border-border bg-muted/40 text-muted-foreground",
        )}>
            {cu ? <AlertTriangle className="h-4 w-4 flex-none" /> : <RefreshCw className="h-4 w-4 flex-none" />}
            <span>
                Bảng đơn đối tác:{" "}
                {n.luc
                    ? <><b className="font-semibold">nạp lúc {gioVN(n.luc)}</b> ({tuoiChu(gio)})</>
                    : <b className="font-semibold">chưa nạp lần nào</b>}
                {typeof n.so_don === "number" && n.so_don > 0 && <> · {n.so_don.toLocaleString("vi-VN")} đơn</>}
            </span>
            <span className={cn("flex-1", cu ? "" : "text-muted-foreground/80")}>
                {cu
                    ? "Số dưới đây là của lần nạp đó, KHÔNG phải hôm nay. Máy tự nạp 6h sáng mỗi ngày — muốn có ngay thì sang tab Theo dõi vận đơn bấm “Đọc bảng đối tác”."
                    : "Máy tự nạp lúc 6h sáng mỗi ngày; cần ngay thì bấm “Đọc bảng đối tác” ở tab Theo dõi vận đơn."}
            </span>
            {/* Lỗi nằm trong chính Sheet — chỉ người giữ Sheet sửa được, nên phải nói ở
                mọi màn đọc từ Sheet, kể cả màn Đối soát COD vốn không có danh sách cảnh báo. */}
            {!!n.ma_trung && (
                <span className="flex basis-full items-start gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                    {n.ma_trung} mã vận đơn bị nhiều dòng trong Sheet dùng chung — danh sách cần sửa ở tab Sổ đơn hàng.
                </span>
            )}
        </div>
    );
}
