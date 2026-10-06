"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

/*
 * Nút "Cài app" (PWA, Sỹ Anh yêu cầu 06/10/2026) — đặt cuối menu trái.
 *
 *   • Android / máy tính (Chrome, Edge, Cốc Cốc…): trình duyệt bắn sự kiện beforeinstallprompt
 *     khi trang đủ điều kiện cài (HTTPS + manifest + service worker) → bấm nút là hiện hộp cài.
 *   • iPhone / iPad: Safari KHÔNG có sự kiện đó, Apple bắt cài tay qua nút Chia sẻ → nút mở
 *     hướng dẫn hai bước.
 *   • Đang chạy như app rồi (display-mode standalone) → không hiện gì.
 *
 * Cũng là nơi đăng ký service worker (public/sw.js) — chỉ khi trang chạy HTTPS hoặc localhost,
 * trình duyệt mới cho đăng ký.
 */

type SuKienCai = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function dangLaApp(): boolean {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(display-mode: standalone)").matches
        || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function laIphone(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    // iPadOS 13+ tự xưng là Mac — nhận bằng màn cảm ứng.
    return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

export default function NutCaiApp() {
    const [suKien, setSuKien] = useState<SuKienCai | null>(null);
    const [iphone, setIphone] = useState(false);
    const [daLaApp, setDaLaApp] = useState(true);   // mặc định ẩn tới khi biết chắc
    const [moHuongDan, setMoHuongDan] = useState(false);

    useEffect(() => {
        if ("serviceWorker" in navigator && window.isSecureContext) {
            navigator.serviceWorker.register("/sw.js").catch(() => { /* không đăng ký được thì vẫn dùng web bình thường */ });
        }
        const nhan = (e: Event) => { e.preventDefault(); setSuKien(e as SuKienCai); };
        const xong = () => { setSuKien(null); setDaLaApp(true); };
        window.addEventListener("beforeinstallprompt", nhan);
        window.addEventListener("appinstalled", xong);
        // Đọc môi trường sau khi gắn vào trang (tránh lệch giữa bản dựng máy chủ và trình duyệt).
        const t = setTimeout(() => { setDaLaApp(dangLaApp()); setIphone(laIphone()); }, 0);
        return () => {
            clearTimeout(t);
            window.removeEventListener("beforeinstallprompt", nhan);
            window.removeEventListener("appinstalled", xong);
        };
    }, []);

    if (daLaApp || (!suKien && !iphone)) return null;

    const bam = async () => {
        if (suKien) {
            await suKien.prompt();
            const kq = await suKien.userChoice;
            if (kq.outcome === "accepted") setSuKien(null);
        } else {
            setMoHuongDan(true);
        }
    };

    return (
        <>
            <button
                onClick={bam}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-orange-600 hover:to-red-600"
            >
                <Download className="h-4 w-4" /> Cài app vào máy
            </button>

            {moHuongDan && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => setMoHuongDan(false)}>
                    <div className="w-full max-w-sm rounded-2xl bg-card p-5 text-sm text-foreground shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="mb-3 flex items-center justify-between">
                            <p className="text-base font-semibold">Cài app trên iPhone</p>
                            <button onClick={() => setMoHuongDan(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Đóng">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <ol className="space-y-3">
                            <li className="flex gap-3">
                                <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-orange-500 text-xs font-bold text-white">1</span>
                                <span>Mở trang này bằng <b>Safari</b>, bấm nút <b>Chia sẻ</b> <Share className="inline h-4 w-4 align-text-bottom" /> ở thanh dưới.</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-orange-500 text-xs font-bold text-white">2</span>
                                <span>Kéo xuống, chọn <b>Thêm vào MH chính</b> (Add to Home Screen) → <b>Thêm</b>.</span>
                            </li>
                        </ol>
                        <p className="mt-4 text-xs text-muted-foreground">Biểu tượng ANTALO hiện trên màn hình chính, bấm vào là mở như app.</p>
                    </div>
                </div>
            )}
        </>
    );
}
