"use client";

// ═══════════════════════════════════════════════════════════════════
// Khách hàng → Soi đối thủ (15/11/2026). Kết quả soi nhóm bán khác — bản đầu: Team 5 KIOT Taiwan
// (kho Pancake POS + 24 kênh TikTok + Meta Ad Library Đài Loan, soi 12/11/2026). Số THAM CHIẾU,
// không phải số bán hàng và không theo bộ chọn ngày — mỗi lần soi là một bản trong
// config/soi_doi_thu.json. Thư viện sản phẩm có ảnh + link spy để đội vào xem tiếp.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { cn } from "@/lib/utils";
import {
    NHOM_SP, mucHoan, soGon, xepTheo7Ngay, banNhieuNhat,
    type NhomSP, type SanPham, type SnapshotSoi, type SoiDoiThuFile,
} from "@/lib/talpha/soi-doi-thu";

type DuLieu = SoiDoiThuFile & { seen_all?: boolean };
type Loc = NhomSP | "tat_ca";

const TEN_NUOC: Record<string, string> = { TW: "Đài Loan", SG: "Singapore", AE: "UAE", JP: "Nhật Bản", VN: "Việt Nam" };
const so = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));
const pt = (x: number, le = 1) => `${(x * 100).toFixed(le).replace(".", ",")}%`;
const ngayVN = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };

const the = "rounded-xl border border-border bg-card p-4 shadow-sm";
const tieuDe = "text-sm font-semibold text-foreground";
const linkCls = "text-blue-600 underline-offset-2 hover:underline dark:text-blue-400";
// "Đặt thêm hàng" dùng xanh dương cố định để không trùng màu xanh lá của nhãn hoàn thấp.
const DAT_THEM = "bg-[#2a78d6]/10 text-[#1f5fb0] dark:bg-[#3987e5]/15 dark:text-[#8fbcf2]";

// Màu theo mức hoàn: dưới 8% tốt · 8–15% vừa · trên 15% xấu · hàng mới chưa xếp.
const CHU_HOAN = {
    tot: "text-emerald-600 dark:text-emerald-400",
    vua: "text-amber-600 dark:text-amber-400",
    xau: "text-rose-600 dark:text-rose-400",
    moi: "text-muted-foreground",
} as const;
const NEN_HOAN = {
    tot: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    vua: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    xau: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    moi: "bg-muted text-muted-foreground",
} as const;

function chuHoan(p: SanPham): string {
    const m = mucHoan(p);
    return m === "moi" ? "mới" : pt(p.ty_le_hoan ?? 0);
}

function denThe(ma: string) {
    document.getElementById(`soi-sp-${ma}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export default function TALPHASoiDoiThuTab() {
    const [data, setData] = useState<DuLieu | null>(null);
    const [loi, setLoi] = useState<string | null>(null);
    const [chon, setChon] = useState(0);
    const [loc, setLoc] = useState<Loc>("tat_ca");

    useEffect(() => {
        let dung = false;
        fetch("/api/talpha/soi-doi-thu")
            .then(async (r) => {
                const d = await r.json();
                if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
                return d as DuLieu;
            })
            .then((d) => { if (!dung) setData(d); })
            .catch((e) => { if (!dung) setLoi(String(e?.message || e)); });
        return () => { dung = true; };
    }, []);

    if (loi) {
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                Không đọc được kết quả soi: {loi}
            </div>
        );
    }
    if (!data) return <TabSkeleton cards={3} rows={6} />;

    const snap: SnapshotSoi | undefined = data.snapshots[chon] ?? data.snapshots[0];
    if (!snap) {
        return <div className={cn(the, "text-sm text-muted-foreground")}>Chưa có bản soi nào cho thị trường của team này.</div>;
    }

    return (
        <div className="space-y-6">
            {/* ── Đầu trang: soi ai, ngày nào, cách soi ── */}
            <div className={cn(the, "space-y-2")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h2 className="text-base font-semibold text-foreground">Soi {snap.nguon}</h2>
                        <p className="text-xs text-muted-foreground">
                            Soi ngày {ngayVN(snap.ngay)} · thị trường {TEN_NUOC[snap.thi_truong] || snap.thi_truong} · số tham chiếu, không theo bộ chọn ngày
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {data.snapshots.length > 1 && (
                            <select
                                id="soi-doi-thu-ban"
                                value={chon}
                                onChange={(e) => { setChon(Number(e.target.value)); setLoc("tat_ca"); }}
                                className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                                aria-label="Chọn bản soi"
                            >
                                {data.snapshots.map((s, i) => <option key={`${s.nguon}-${s.ngay}`} value={i}>{s.nguon} · {ngayVN(s.ngay)}</option>)}
                            </select>
                        )}
                        {snap.bao_cao && (
                            <a href={snap.bao_cao} target="_blank" rel="noopener noreferrer"
                                title="Trang riêng của Sỹ Anh — người khác cần được chia sẻ mới mở được"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
                                Báo cáo đầy đủ <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        )}
                    </div>
                </div>
                <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">{snap.cach_soi}</p>
                {snap.theo_doi && <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">{snap.theo_doi}</p>}
            </div>

            {snap.tom_tat.length > 0 && (
                <div className={the}>
                    <h3 className={cn(tieuDe, "mb-2")}>Đọc nhanh</h3>
                    <ul className="max-w-4xl list-disc space-y-1.5 pl-5 text-sm text-foreground">
                        {snap.tom_tat.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                </div>
            )}

            <TongQuan s={snap} />

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <Top7Ngay sp={snap.san_pham} />
                <BanNhieu sp={snap.san_pham} />
            </div>

            <TinHieu s={snap} />

            <ThuVien sp={snap.san_pham} loc={loc} setLoc={setLoc} />

            <KenhTikTok s={snap} />

            {/* ── Công thức quảng cáo ── */}
            <section className="space-y-3">
                <h3 className="text-base font-semibold text-foreground">Công thức quảng cáo của họ</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {snap.cong_thuc.map((c) => (
                        <div key={c.nhan} className={cn(the, "space-y-2")}>
                            <span className="inline-block rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{c.nhan}</span>
                            <h4 className={tieuDe}>{c.tieu_de}</h4>
                            <p className="text-sm leading-relaxed text-muted-foreground">{c.noi_dung}</p>
                            {c.cau_mau && c.cau_mau.map((x) => <CauMau key={x.cau} cau={x.cau} nghia={x.nghia} />)}
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Tệp khách ── */}
            <section className="space-y-3">
                <h3 className="text-base font-semibold text-foreground">Họ bán cho ai</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {snap.tep_khach.map((t) => (
                        <div key={t.ten} className={cn(the, "space-y-2")}>
                            <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">{t.ten}</span>
                            <h4 className={tieuDe}>{t.tieu_de}</h4>
                            <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                                {t.vi_du.map((v) => <li key={v}>{v}</li>)}
                            </ul>
                            <p className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground">{t.cau_mau}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Facebook ── */}
            <section className="space-y-3">
                <div>
                    <h3 className="text-base font-semibold text-foreground">Facebook</h3>
                    <p className="mt-1 max-w-4xl text-xs text-muted-foreground">{snap.facebook.ghi_chu}</p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {snap.facebook.muc.map((m) => (
                        <div key={m.tieu_de} className={cn(the, "space-y-2")}>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">{m.nhan}</span>
                                {m.so_ads !== null && <span className="text-xs tabular-nums text-muted-foreground">{m.so_ads} ads đang chạy lúc soi</span>}
                            </div>
                            <h4 className={tieuDe}>{m.tieu_de}</h4>
                            <p className="text-sm leading-relaxed text-muted-foreground">{m.noi_dung}</p>
                            <a href={m.link} target="_blank" rel="noopener noreferrer" className={cn(linkCls, "inline-flex items-center gap-1 text-sm")}>
                                Xem trên Ad Library <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        </div>
                    ))}
                </div>
            </section>

            <ApDung s={snap} />

            <div className={the}>
                <h3 className={cn(tieuDe, "mb-2")}>Giới hạn của số liệu</h3>
                <ul className="max-w-4xl list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                    {snap.gioi_han.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
            </div>
        </div>
    );
}

function CauMau({ cau, nghia }: { cau: string; nghia: string }) {
    return (
        <div className="space-y-0.5">
            <p className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground">{cau}</p>
            <p className="text-xs text-muted-foreground">{nghia}</p>
        </div>
    );
}

function TongQuan({ s }: { s: SnapshotSoi }) {
    const t = s.tong_quan;
    const o: [string, string, string][] = [
        ["Sản phẩm", so(t.san_pham), `${so(t.ma_hang)} mã hàng theo màu, size`],
        ["Đã nhập kho", so(t.nhap), `từ ${ngayVN(t.bat_dau)}`],
        ["Đã xuất kho", so(t.xuat), "sản phẩm, không phải số đơn"],
        ["Xuất 7 ngày", `~${so(t.xuat_7_ngay)}`, `khoảng ${so(t.xuat_7_ngay / 7)} sản phẩm/ngày`],
        ["Đang hoàn", pt(t.dang_hoan / t.xuat), `${so(t.dang_hoan)} sản phẩm`],
        ["Hàng tặng kèm", pt(t.qua_tang / t.xuat, 0), `${so(t.qua_tang)} sản phẩm là quà`],
        ["Kênh bán", so(t.kenh_tiktok + t.kenh_facebook), `${t.kenh_tiktok} TikTok · ${t.kenh_facebook} Facebook`],
    ];
    return (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4 xl:grid-cols-7">
            {o.map(([nhan, so_, phu]) => (
                <div key={nhan} className="space-y-0.5 bg-card p-3">
                    <p className="text-xs text-muted-foreground">{nhan}</p>
                    <p className="text-xl font-semibold tabular-nums text-foreground">{so_}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">{phu}</p>
                </div>
            ))}
        </div>
    );
}

function AnhNho({ p }: { p: SanPham }) {
    return p.anh
        ? <img src={p.anh} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-md border border-border bg-white object-contain" />
        : <span className="h-9 w-9 shrink-0 rounded-md border border-dashed border-border bg-muted" aria-hidden />;
}

function Top7Ngay({ sp }: { sp: SanPham[] }) {
    const rows = useMemo(() => xepTheo7Ngay(sp, "dang_chay"), [sp]);
    const max = Math.max(1, ...rows.map((p) => p.xuat_7_ngay));
    return (
        <div className={the}>
            <h3 className={tieuDe}>Đang chạy mạnh: xuất 7 ngày</h3>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">Bấm tên để xem ảnh và link spy. Nhãn bên phải: tỉ lệ hoàn · đặt thêm.</p>
            <div className="space-y-2">
                {rows.map((p) => (
                    <div key={p.ma} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 max-sm:grid-cols-1 max-sm:gap-1">
                        <button type="button" onClick={() => denThe(p.ma)} className="flex min-w-0 items-center gap-2 text-left hover:text-blue-600 dark:hover:text-blue-400">
                            <AnhNho p={p} />
                            <span className="min-w-0 truncate text-sm font-medium">{p.ten}</span>
                        </button>
                        <div className="h-5 overflow-hidden rounded bg-muted">
                            <div className="flex h-full items-center justify-end rounded bg-blue-600 pr-1.5 dark:bg-blue-500" style={{ width: `${Math.max(8, (p.xuat_7_ngay / max) * 100)}%` }}>
                                <span className="text-[11px] font-semibold tabular-nums text-white">{p.xuat_7_ngay}</span>
                            </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1 max-sm:justify-start">
                            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", NEN_HOAN[mucHoan(p)])}>hoàn {chuHoan(p)}</span>
                            {p.dat_them > 0 && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", DAT_THEM)}>đặt thêm {p.dat_them}</span>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function BanNhieu({ sp }: { sp: SanPham[] }) {
    const rows = useMemo(() => banNhieuNhat(sp, 10), [sp]);
    return (
        <div className={the}>
            <h3 className={cn(tieuDe, "mb-3")}>Bán nhiều nhất từ trước đến nay</h3>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                    <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                            <th className="py-1.5 pr-2 font-medium">Sản phẩm</th>
                            <th className="py-1.5 pr-2 text-right font-medium">Đã xuất</th>
                            <th className="py-1.5 pr-2 text-right font-medium">7 ngày</th>
                            <th className="py-1.5 text-right font-medium">Hoàn</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((p) => (
                            <tr key={p.ma} className="border-b border-border/60 last:border-0">
                                <td className="py-1.5 pr-2">
                                    <button type="button" onClick={() => denThe(p.ma)} className="flex items-center gap-2 text-left hover:text-blue-600 dark:hover:text-blue-400">
                                        <AnhNho p={p} /><span>{p.ten}</span>
                                    </button>
                                </td>
                                <td className="py-1.5 pr-2 text-right tabular-nums">{so(p.da_xuat)}</td>
                                <td className="py-1.5 pr-2 text-right tabular-nums">{so(p.xuat_7_ngay)}</td>
                                <td className={cn("py-1.5 text-right font-medium tabular-nums", CHU_HOAN[mucHoan(p)])}>{chuHoan(p)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function TinHieu({ s }: { s: SnapshotSoi }) {
    const t = s.tin_hieu;
    const khoi: { ten: string; phu: string; cham: string; dong: [string, string][] }[] = [
        { ten: "Đang đặt thêm hàng", phu: "Số lượng chờ nhập về kho — hàng đã có lời.", cham: "bg-[#2a78d6]", dong: t.dat_them.map((x) => [x.ten, so(x.so)]) },
        { ten: "Đang test, ra đơn nhanh", phu: "Chưa nhập hàng mà đã bán, tính từ ngày tạo mã.", cham: "bg-emerald-500", dong: t.dang_test.map((x) => [`${x.ten} (từ ${ngayVN(x.tu).slice(0, 5)})`, so(x.so)]) },
        { ten: "Hoàn cao, nên tránh", phu: "Đang hoàn / đã xuất, hàng xuất từ 100 trở lên.", cham: "bg-rose-500", dong: t.hoan_cao.map((x) => [x.ten, pt(x.ty_le)]) },
        { ten: "Ôm tồn", phu: "Tồn còn lại / tổng đã nhập.", cham: "bg-amber-500", dong: t.om_ton.map((x) => [x.ten, `${so(x.ton)} / ${so(x.nhap)}`]) },
    ];
    return (
        <section className="space-y-3">
            <h3 className="text-base font-semibold text-foreground">Tín hiệu từ kho</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {khoi.map((k) => (
                    <div key={k.ten} className={cn(the, "space-y-2")}>
                        <h4 className={cn(tieuDe, "flex items-center gap-2")}><i className={cn("h-2.5 w-2.5 rounded-full", k.cham)} aria-hidden />{k.ten}</h4>
                        <p className="text-xs text-muted-foreground">{k.phu}</p>
                        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                            {k.dong.map(([a, b]) => (
                                <div key={a} className="contents">
                                    <dt className="min-w-0 text-foreground">{a}</dt>
                                    <dd className="text-right tabular-nums text-foreground">{b}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                ))}
            </div>
            <p className="rounded-r-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t.qua_tang}</p>
        </section>
    );
}

function ThuVien({ sp, loc, setLoc }: { sp: SanPham[]; loc: Loc; setLoc: (l: Loc) => void }) {
    const dem = useMemo(() => {
        const d: Record<string, number> = { tat_ca: sp.length };
        for (const p of sp) d[p.nhom] = (d[p.nhom] || 0) + 1;
        return d;
    }, [sp]);
    const nhom = NHOM_SP.filter((n) => dem[n.id]);
    const chips: { id: Loc; ten: string }[] = [{ id: "tat_ca", ten: "Tất cả" }, ...nhom.map((n) => ({ id: n.id as Loc, ten: n.ten }))];
    return (
        <section className="space-y-3">
            <div>
                <h3 className="text-base font-semibold text-foreground">Thư viện spy: {sp.length} sản phẩm</h3>
                <p className="mt-1 max-w-4xl text-xs text-muted-foreground">
                    Ảnh lấy từ kho POS của nhóm kia, phần lớn là ảnh quảng cáo có in offer. Link mở kênh TikTok, video nhiều view nhất, ô tìm kiếm TikTok hoặc Meta Ad Library.
                </p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo nhóm">
                {chips.map((c) => (
                    <button key={c.id} type="button" onClick={() => setLoc(c.id)} aria-pressed={loc === c.id}
                        className={cn("rounded-full border px-3 py-1 text-sm font-medium",
                            loc === c.id ? "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500" : "border-border bg-background text-foreground hover:bg-muted")}>
                        {c.ten} <span className="tabular-nums opacity-70">{dem[c.id]}</span>
                    </button>
                ))}
            </div>
            {nhom.filter((n) => loc === "tat_ca" || loc === n.id).map((n) => (
                <div key={n.id} className="space-y-2 pt-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                        <h4 className={tieuDe}>{n.ten}</h4>
                        <span className="text-xs text-muted-foreground">{n.mo_ta}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                        {sp.filter((p) => p.nhom === n.id).map((p) => <TheSanPham key={p.ma} p={p} />)}
                    </div>
                </div>
            ))}
        </section>
    );
}

function TheSanPham({ p }: { p: SanPham }) {
    const muc = mucHoan(p);
    const o4: [string, string] = p.dat_them > 0 ? ["Đặt thêm", so(p.dat_them)] : ["Tồn", so(p.ton)];
    const o: [string, string, string?][] = [
        ["Đã xuất", so(p.da_xuat)],
        ["7 ngày", so(p.xuat_7_ngay)],
        ["Hoàn", chuHoan(p), CHU_HOAN[muc]],
        o4,
    ];
    return (
        <article id={`soi-sp-${p.ma}`} className="flex scroll-mt-24 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex aspect-square items-center justify-center border-b border-border bg-white">
                {p.anh
                    ? <img src={p.anh} alt={`Ảnh sản phẩm ${p.ten}`} loading="lazy" className="h-full w-full object-contain" />
                    : <span className="text-xs text-neutral-500">Kho chưa có ảnh</span>}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3">
                <div>
                    <h5 className="text-sm font-semibold text-foreground">{p.ten}</h5>
                    <p className="text-xs leading-snug text-muted-foreground">{p.mo_ta}</p>
                </div>
                <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">{p.tep}</span>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
                    {o.map(([nhan, gt, mau]) => (
                        <div key={nhan} className="flex min-w-0 items-baseline justify-between gap-2 bg-muted/40 px-2 py-1">
                            <p className="whitespace-nowrap text-[11px] text-muted-foreground">{nhan}</p>
                            <p className={cn("text-sm font-semibold tabular-nums text-foreground", mau)}>{gt}</p>
                        </div>
                    ))}
                </div>
                <p className="text-xs leading-snug text-muted-foreground">{p.offer}</p>
                {p.video_top && (
                    <div className="space-y-0.5 border-l-2 border-blue-600 pl-2 dark:border-blue-500">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Video top{p.video_top.view ? ` · ${soGon(p.video_top.view)} view` : ""}
                        </p>
                        <p className="break-words text-xs font-medium text-foreground">{p.video_top.tieu_de}</p>
                        <p className="text-xs text-muted-foreground">{p.video_top.nghia}</p>
                    </div>
                )}
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {p.lien_ket.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:border-blue-600 hover:text-blue-600 dark:hover:border-blue-400 dark:hover:text-blue-400">
                            {l.nhan}
                        </a>
                    ))}
                </div>
            </div>
        </article>
    );
}

function KenhTikTok({ s }: { s: SnapshotSoi }) {
    const rows = s.kenh_tiktok;
    const max = Math.max(1, ...rows.map((k) => k.tong_view));
    return (
        <div className={the}>
            <h3 className={tieuDe}>Kênh TikTok: tổng lượt xem lúc soi</h3>
            <p className="mb-3 mt-1 max-w-4xl text-xs text-muted-foreground">
                Follower chỉ vài trăm đến vài nghìn mà view hàng triệu: lượt xem chủ yếu đến từ quảng cáo. Lần soi sau, video tăng view mạnh là video đang được đổ tiền.
            </p>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                    <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                            <th className="py-1.5 pr-3 font-medium">Kênh</th>
                            <th className="py-1.5 pr-3 font-medium">Sản phẩm</th>
                            <th className="w-[28%] py-1.5 pr-3 font-medium">Tổng view</th>
                            <th className="py-1.5 pr-3 text-right font-medium">Video</th>
                            <th className="py-1.5 pr-3 text-right font-medium">Follower</th>
                            <th className="min-w-[16rem] py-1.5 font-medium">Video top</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((k) => (
                            <tr key={k.user} className="border-b border-border/60 align-top last:border-0">
                                <td className="py-2 pr-3">
                                    <a href={`https://www.tiktok.com/@${k.user}`} target="_blank" rel="noopener noreferrer" className={linkCls}>@{k.user}</a>
                                    <p className="text-[11px] text-muted-foreground">{k.tep}</p>
                                </td>
                                <td className="py-2 pr-3 text-foreground">{k.san_pham}</td>
                                <td className="py-2 pr-3">
                                    <div className="flex items-center gap-2">
                                        <div className="h-2.5 flex-1 overflow-hidden rounded bg-muted">
                                            <div className="h-full rounded bg-blue-600 dark:bg-blue-500" style={{ width: `${Math.max(2, (k.tong_view / max) * 100)}%` }} />
                                        </div>
                                        <span className="w-12 text-right text-xs font-semibold tabular-nums text-foreground">{soGon(k.tong_view)}</span>
                                    </div>
                                </td>
                                <td className="py-2 pr-3 text-right tabular-nums">{k.video}</td>
                                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{k.follower === null ? "–" : so(k.follower)}</td>
                                <td className="py-2">
                                    <a href={`https://www.tiktok.com/@${k.user}/video/${k.video_top.id}`} target="_blank" rel="noopener noreferrer" className={cn(linkCls, "text-xs font-medium")}>
                                        {soGon(k.video_top.view)} · {k.video_top.tieu_de}
                                    </a>
                                    <p className="text-[11px] text-muted-foreground">{k.video_top.nghia}</p>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function ApDung({ s }: { s: SnapshotSoi }) {
    const a = s.ap_dung;
    return (
        <section className="space-y-3">
            <div>
                <h3 className="text-base font-semibold text-foreground">Áp dụng cho công ty</h3>
                <p className="mt-1 max-w-4xl text-xs text-muted-foreground">{a.ghi_chu}</p>
            </div>
            <div className={the}>
                <h4 className={cn(tieuDe, "mb-2")}>Sản phẩm nên test</h4>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-xs text-muted-foreground">
                                <th className="py-1.5 pr-3 font-medium">Sản phẩm</th>
                                <th className="py-1.5 pr-3 font-medium">Vì sao</th>
                                <th className="py-1.5 pr-3 font-medium">Tệp hợp nhất</th>
                                <th className="py-1.5 font-medium">Lưu ý</th>
                            </tr>
                        </thead>
                        <tbody>
                            {a.danh_sach_test.map((d) => (
                                <tr key={d.san_pham} className="border-b border-border/60 align-top last:border-0">
                                    <td className="py-2 pr-3 font-medium text-foreground">{d.san_pham}</td>
                                    <td className="py-2 pr-3 text-muted-foreground">{d.vi_sao}</td>
                                    <td className="py-2 pr-3 text-foreground">{d.tep}</td>
                                    <td className="py-2 text-muted-foreground">{d.luu_y}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {a.ke_hoach.map((k) => (
                    <div key={k.khi} className={cn(the, "space-y-2")}>
                        <span className="inline-block rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{k.khi}</span>
                        <h4 className={tieuDe}>{k.tieu_de}</h4>
                        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                            {k.viec.map((v) => <li key={v}>{v}</li>)}
                        </ul>
                    </div>
                ))}
            </div>
            <div className={the}>
                <h4 className={tieuDe}>Hook mẫu cho trang sức bán cho người Phi</h4>
                <p className="mb-3 mt-1 text-xs text-muted-foreground">Nhờ người Phi đọc lại câu chữ trước khi chạy.</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {a.hook_mau.map((h) => <CauMau key={h.cau} cau={h.cau} nghia={h.nghia} />)}
                </div>
            </div>
        </section>
    );
}
