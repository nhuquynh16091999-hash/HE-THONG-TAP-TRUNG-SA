"use client";

import { useCallback, useEffect, useState } from "react";
import { QrCode, RefreshCw, X } from "lucide-react";

/*
 * Băng cảnh báo bot Zalo mất đăng nhập + quét QR ngay trên dashboard (12/11/2026).
 * Chỉ giám đốc thấy (shell chỉ gắn khi me.full; route /api/talpha/zalo-bot cũng chặn).
 * Bot đang chạy bình thường thì không hiện gì.
 */
type QrState = { buoc: "dang_tao" | "cho_quet" | "da_quet" | "tu_choi" | "loi"; lan?: number; soLan?: number; hetHan?: string; ten?: string; loi?: string } | null;
type TrangThai = {
    co_file: boolean; bot_chay?: boolean; ok?: boolean; nick?: string | null; vao_luc?: string | null;
    mat_tu?: string | null; loi?: string | null; can_quet?: boolean; qr?: QrState; nhip?: string | null;
};

const gio = (s?: string | null) => (s ? new Date(s).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "?");

export default function ZaloBotBanner() {
    const [tt, setTt] = useState<TrangThai | null>(null);
    const [dangQuet, setDangQuet] = useState(false);      // đã bấm "Quét QR", đang theo dõi
    const [vuaXong, setVuaXong] = useState(false);
    const [loiBam, setLoiBam] = useState<string | null>(null);
    const [, setTick] = useState(0);

    const tai = useCallback(async () => {
        try {
            const r = await fetch("/api/talpha/zalo-bot", { cache: "no-store" });
            if (!r.ok) return;
            const d = (await r.json()) as TrangThai;
            setTt((cu) => {
                if (cu && cu.ok === false && d.ok) setVuaXong(true);
                return d;
            });
            if (d.ok) setDangQuet(false);
        } catch { /* mạng chập chờn — lần sau */ }
    }, []);

    useEffect(() => {
        tai();
        const id = setInterval(tai, dangQuet ? 2000 : 60_000);
        return () => clearInterval(id);
    }, [tai, dangQuet]);

    // Đếm ngược hạn mã QR.
    useEffect(() => {
        if (!dangQuet) return;
        const id = setInterval(() => setTick((x) => x + 1), 1000);
        return () => clearInterval(id);
    }, [dangQuet]);

    const batDauQuet = async () => {
        setLoiBam(null);
        try {
            const r = await fetch("/api/talpha/zalo-bot", { method: "POST" });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
            setDangQuet(true);
            setTt((cu) => (cu ? { ...cu, qr: { buoc: "dang_tao" } } : cu));
        } catch (e: any) { setLoiBam(String(e?.message || e)); }
    };

    if (!tt || !tt.co_file) return null;

    if (vuaXong && tt.ok) {
        return (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                <span>✅ Bot Zalo đã đăng nhập lại{tt.nick ? ` (nick ${tt.nick})` : ""} lúc {gio(tt.vao_luc)}. Các nhóm ADS + VẬN ĐƠN nhận tin lại từ mốc kế tiếp.</span>
                <button onClick={() => setVuaXong(false)} className="shrink-0 rounded p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900" aria-label="Đóng"><X className="h-4 w-4" /></button>
            </div>
        );
    }

    if (tt.bot_chay === false) {
        return (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                ⚠️ <b>Bot Zalo không chạy</b> — lần cuối báo về lúc {gio(tt.nhip)}. Các nhóm ADS + VẬN ĐƠN không nhận tin. Báo Claude kiểm tra máy chủ (pm2 talpha-zalo-alerts).
            </div>
        );
    }

    if (tt.ok) return null;

    const qr = tt.qr;
    const conGiay = qr?.hetHan ? Math.max(0, Math.round((Date.parse(qr.hetHan) - Date.now()) / 1000)) : null;
    return (
        <div className="space-y-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <b>🔴 Bot Zalo mất đăng nhập từ {gio(tt.mat_tu)}</b> — các nhóm ADS + VẬN ĐƠN đang không nhận tin.
                    {!tt.can_quet && <span className="block text-xs opacity-80">Có thể chỉ rớt mạng, bot đang tự thử lại. Quá 15 phút chưa hết thì bấm quét QR.</span>}
                    {tt.loi && <span className="block text-xs opacity-70">Lỗi: {tt.loi}</span>}
                </div>
                {!dangQuet && (
                    <button onClick={batDauQuet} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-red-600 px-3 py-2 font-medium text-white hover:bg-red-700">
                        <QrCode className="h-4 w-4" /> Quét QR đăng nhập lại
                    </button>
                )}
            </div>
            {loiBam && <div className="text-xs">Không gửi được yêu cầu: {loiBam}</div>}
            {dangQuet && (
                <div className="flex flex-col gap-4 rounded-lg bg-white p-4 text-foreground dark:bg-[#131210] sm:flex-row sm:items-center">
                    <div className="flex h-56 w-56 shrink-0 items-center justify-center rounded-lg border border-border bg-white">
                        {qr?.buoc === "cho_quet"
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={`/api/talpha/zalo-bot?qr=1&lan=${qr.lan || 0}`} alt="Mã QR đăng nhập Zalo" className="h-52 w-52" />
                            : <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />}
                    </div>
                    <div className="space-y-2 text-sm">
                        {(!qr || qr.buoc === "dang_tao") && <p>Bot đang làm mã QR (khoảng 5–10 giây)…</p>}
                        {qr?.buoc === "cho_quet" && (
                            <>
                                <p className="font-medium">Mở Zalo trên điện thoại của <b>nick bot (Hoàng Rin)</b> → bấm biểu tượng quét QR → quét mã bên cạnh → bấm <b>Xác nhận</b>.</p>
                                <p className="text-muted-foreground">Mã {qr.lan}/{qr.soLan}{conGiay !== null ? ` · còn ${conGiay} giây` : ""} — hết hạn thì bot tự làm mã mới.</p>
                            </>
                        )}
                        {qr?.buoc === "da_quet" && <p className="font-medium">Đã quét{qr.ten ? ` bởi "${qr.ten}"` : ""} — bấm <b>Xác nhận đăng nhập</b> trên điện thoại.</p>}
                        {qr?.buoc === "tu_choi" && <p>Điện thoại đã từ chối đăng nhập.</p>}
                        {qr?.buoc === "loi" && <p>Chưa đăng nhập được: {qr.loi}</p>}
                        {(qr?.buoc === "tu_choi" || qr?.buoc === "loi") && (
                            <button onClick={batDauQuet} className="rounded-lg bg-red-600 px-3 py-1.5 text-white hover:bg-red-700">Làm mã mới</button>
                        )}
                        <p className="text-xs text-muted-foreground">Đừng mở Zalo PC / Zalo Web bằng nick bot — Zalo chỉ cho một phiên web, mở là bot bị đá ra.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
