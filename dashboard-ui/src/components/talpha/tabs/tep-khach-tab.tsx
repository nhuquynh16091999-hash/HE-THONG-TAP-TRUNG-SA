"use client";

// ═══════════════════════════════════════════════════════════════════
// Khách hàng → Tệp khách (14/11/2026). Số THAM CHIẾU về người Việt / Phi / Indo ở từng thị
// trường: thống kê nhà nước + quy mô đối tượng Facebook (nam nữ, độ tuổi). Không phải số bán
// hàng và không theo bộ chọn ngày — mỗi lần đo là một bản trong config/tep_khach.json.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ExternalLink } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { cn } from "@/lib/utils";
import {
    giua, tyLeNu, tyLeTuoi, NHOM_TUOI,
    type Bang, type Khoang, type MaNhom, type Snapshot, type TepKhachFile, type ThiTruongTep, type XuHuong,
} from "@/lib/talpha/tep-khach";

const NHOM: MaNhom[] = ["VN", "PH", "ID"];

// Màu đi theo NHÓM (Việt · Phi · Indo), giữ nguyên ở mọi biểu đồ của tab.
const MAU: Record<MaNhom, { hex: string; dam: string; nhat: string; vien: string }> = {
    VN: { hex: "#2a78d6", dam: "bg-[#2a78d6] dark:bg-[#3987e5]", nhat: "bg-[#2a78d6]/35 dark:bg-[#3987e5]/40", vien: "border-t-[#2a78d6] dark:border-t-[#3987e5]" },
    PH: { hex: "#eb6834", dam: "bg-[#eb6834] dark:bg-[#d95926]", nhat: "bg-[#eb6834]/35 dark:bg-[#d95926]/40", vien: "border-t-[#eb6834] dark:border-t-[#d95926]" },
    ID: { hex: "#1baf7a", dam: "bg-[#1baf7a] dark:bg-[#199e70]", nhat: "bg-[#1baf7a]/35 dark:bg-[#199e70]/40", vien: "border-t-[#1baf7a] dark:border-t-[#199e70]" },
};

type DuLieu = TepKhachFile & { seen_all?: boolean };

const so = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));
const nghin = (k: Khoang) => `${Math.round(k[0] / 1000)}–${Math.round(k[1] / 1000)} nghìn`;
const trieu = (k: Khoang, le = 2) => `${(k[0] / 1e6).toFixed(le).replace(".", ",")}–${(k[1] / 1e6).toFixed(le).replace(".", ",")} triệu`;
const pt = (x: number, le = 0) => `${(x * 100).toFixed(le).replace(".", ",")}%`;
const ngayVN = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };

/** "Cuối 2015" → 2016 · "9/2026" → 2026,75: để trục thời gian chia đúng tỷ lệ, không dồn đều. */
function mocThanhSo(moc: string): number {
    const cuoi = /(\d{4})\s*$/.exec(moc);
    const thang = /^(\d{1,2})\/(\d{4})$/.exec(moc.trim());
    if (thang) return Number(thang[2]) + Number(thang[1]) / 12;
    return cuoi ? Number(cuoi[1]) + 1 : 0;
}

const the = "rounded-xl border border-border bg-card p-4 shadow-sm";
const tieuDe = "text-sm font-semibold text-foreground";

export default function TALPHATepKhachTab() {
    const [data, setData] = useState<DuLieu | null>(null);
    const [loi, setLoi] = useState<string | null>(null);
    const [chon, setChon] = useState(0);

    useEffect(() => {
        let dung = false;
        fetch("/api/talpha/tep-khach")
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
                Không đọc được số tệp khách: {loi}
            </div>
        );
    }
    if (!data) return <TabSkeleton cards={3} rows={6} />;

    const snap: Snapshot | undefined = data.snapshots[chon] ?? data.snapshots[0];
    if (!snap) {
        return <div className={cn(the, "text-sm text-muted-foreground")}>Chưa có bản đo tệp khách nào cho thị trường của team này.</div>;
    }
    const nuoc = Object.entries(snap.thi_truong);
    const xemHet = data.seen_all !== false;

    return (
        <div className="space-y-6">
            {/* ── Đầu trang: bản đo nào, đo bằng cách gì ── */}
            <div className={cn(the, "space-y-2")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h2 className="text-base font-semibold text-foreground">Tệp người Việt · Phi · Indo theo thị trường</h2>
                        <p className="text-xs text-muted-foreground">Đo ngày {ngayVN(snap.ngay_do)} · số tham chiếu, không theo bộ chọn ngày</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {data.snapshots.length > 1 && (
                            <select
                                id="tep-khach-ban-do"
                                value={chon}
                                onChange={(e) => setChon(Number(e.target.value))}
                                className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                                aria-label="Chọn bản đo"
                            >
                                {data.snapshots.map((s, i) => <option key={s.ngay_do} value={i}>Bản đo {ngayVN(s.ngay_do)}</option>)}
                            </select>
                        )}
                        {snap.bao_cao && (
                            <a href={snap.bao_cao} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
                                Báo cáo đầy đủ <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        )}
                    </div>
                </div>
                <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">{snap.cach_do}</p>
                {!xemHet && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">Đang chỉ hiện thị trường của team bạn. Giám đốc xem được đủ mọi thị trường.</p>
                )}
            </div>

            {xemHet && snap.tom_tat.length > 0 && (
                <div className={the}>
                    <h3 className={cn(tieuDe, "mb-2")}>Đọc nhanh</h3>
                    <ul className="max-w-4xl list-disc space-y-1.5 pl-5 text-sm text-foreground">
                        {snap.tom_tat.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                </div>
            )}

            <QuyMo nuoc={nuoc} nhom={data.nhom} />

            {/* ── Chân dung từng tệp ── */}
            {nuoc.map(([code, m]) => (
                <section key={code} className="space-y-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h3 className="text-base font-semibold text-foreground">{m.ten}</h3>
                        <span className="text-xs text-muted-foreground">Facebook cả nước {trieu(m.fb_ca_nuoc, 1)} tài khoản · {m.nguon_chinh_thuc}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        {NHOM.map((n) => m.tep[n] && <TheTep key={n} ma={n} ten={`${data.nhom[n].day_du} ở ${m.ten}`} t={m.tep[n]} />)}
                    </div>
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {m.xu_huong && <BieuDoXuHuong x={m.xu_huong} nhom={data.nhom} />}
                        {m.bang.map((b) => <BangSo key={b.tieu_de} b={b} nhom={data.nhom} />)}
                        {m.ghi_chu.length > 0 && (
                            <div className={the}>
                                <h4 className={cn(tieuDe, "mb-2")}>Ghi chú {m.ten}</h4>
                                <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                                    {m.ghi_chu.map((g, i) => <li key={i}>{g}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                </section>
            ))}

            {xemHet && snap.nhan_dinh.thu_tu.length > 0 && (
                <div className={the}>
                    <h3 className={tieuDe}>Nên đánh tệp nào trước</h3>
                    <p className="mb-3 mt-1 max-w-4xl text-xs text-muted-foreground">{snap.nhan_dinh.ghi_chu}</p>
                    <ol className="max-w-4xl list-decimal space-y-2 pl-5 text-sm text-foreground">
                        {snap.nhan_dinh.thu_tu.map((x) => (
                            <li key={x.tep}><strong className="font-semibold">{x.tep}.</strong> <span className="text-muted-foreground">{x.ly_do}</span></li>
                        ))}
                    </ol>
                </div>
            )}

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className={the}>
                    <h3 className={cn(tieuDe, "mb-2")}>Cài tệp trong Ads Manager</h3>
                    <p className="mb-2 text-sm text-muted-foreground">
                        Bấm "Chuyển sang lựa chọn đối tượng ban đầu", chọn Vị trí là quốc gia, rồi ở Nhắm mục tiêu chi tiết chọn Hành vi → Ngoại kiều:
                    </p>
                    <ul className="space-y-1.5 text-sm">
                        {NHOM.map((n) => (
                            <li key={n} className="flex flex-wrap items-baseline gap-x-2">
                                <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-sm", MAU[n].dam)} aria-hidden />
                                <span className="text-foreground">{data.nhom[n].hanh_vi_meta}</span>
                                <span className="text-xs tabular-nums text-muted-foreground">toàn cầu {trieu(data.nhom[n].fb_toan_cau, 1)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className={the}>
                    <h3 className={cn(tieuDe, "mb-2")}>Giới hạn của số liệu</h3>
                    <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                        {snap.gioi_han.map((g, i) => <li key={i}>{g}</li>)}
                    </ul>
                </div>
            </div>

            <details className={the}>
                <summary className="cursor-pointer text-sm font-semibold text-foreground">Nguồn ({snap.nguon.length})</summary>
                <ul className="mt-3 space-y-1 text-sm">
                    {snap.nguon.map((s) => (
                        <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">{s.ten}</a></li>
                    ))}
                </ul>
            </details>
        </div>
    );
}

/** Thanh ngang: đậm = mức thấp của Facebook, nhạt = tới mức cao; vạch đứng = số chính thức. */
function QuyMo({ nuoc, nhom }: { nuoc: [string, ThiTruongTep][]; nhom: TepKhachFile["nhom"] }) {
    const max = useMemo(() => {
        let m = 1;
        for (const [, t] of nuoc) for (const n of NHOM) if (t.tep[n]) m = Math.max(m, t.tep[n].fb[1], t.tep[n].chinh_thuc);
        return m * 1.05;
    }, [nuoc]);
    return (
        <div className={the}>
            <h3 className={tieuDe}>Quy mô từng tệp</h3>
            <div className="mb-3 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {NHOM.map((n) => (
                    <span key={n} className="inline-flex items-center gap-1.5"><i className={cn("h-2.5 w-2.5 rounded-sm", MAU[n].dam)} aria-hidden />{nhom[n].ten}</span>
                ))}
                <span>Thanh đậm → nhạt: Facebook mức thấp → mức cao</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-3.5 w-0.5 bg-foreground" aria-hidden />Số chính thức / ước tính</span>
            </div>
            <div className="divide-y divide-border">
                {nuoc.map(([code, m]) => {
                    const lo = NHOM.reduce((s, n) => s + (m.tep[n]?.fb[0] || 0), 0);
                    const hi = NHOM.reduce((s, n) => s + (m.tep[n]?.fb[1] || 0), 0);
                    return (
                        <div key={code} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                                <span className="text-sm font-semibold text-foreground">{m.ten}</span>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                    Ba tệp {trieu([lo, hi])} · {pt((lo + hi) / 2 / giua(m.fb_ca_nuoc), 1)} Facebook cả nước
                                </span>
                            </div>
                            {NHOM.map((n) => {
                                const t = m.tep[n];
                                if (!t) return null;
                                return (
                                    <div key={n} className="grid grid-cols-[40px_minmax(0,1fr)_104px] items-center gap-2 rounded-md hover:bg-muted/50"
                                        title={`${nhom[n].day_du} ở ${m.ten}\nFacebook: ${so(t.fb[0])} – ${so(t.fb[1])}\nNam ${nghin(t.nam)} · Nữ ${nghin(t.nu)}\n${t.chinh_thuc_ghi_chu}`}>
                                        <span className="pl-1 text-xs font-medium text-muted-foreground">{nhom[n].ten}</span>
                                        <div className="relative h-5">
                                            <i className={cn("absolute left-0 top-1 h-3.5 rounded-r", MAU[n].nhat)} style={{ width: `${(t.fb[1] / max) * 100}%` }} />
                                            <i className={cn("absolute left-0 top-1 h-3.5 rounded-r", MAU[n].dam)} style={{ width: `${(t.fb[0] / max) * 100}%` }} />
                                            <i className="absolute top-0 h-5 w-0.5 bg-foreground ring-1 ring-card" style={{ left: `${(t.chinh_thuc / max) * 100}%` }} />
                                        </div>
                                        <span className="pr-1 text-right text-xs tabular-nums text-foreground">{nghin(t.fb)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function TheTep({ ma, ten, t }: { ma: MaNhom; ten: string; t: ThiTruongTep["tep"][MaNhom] }) {
    const nu = tyLeNu(t);
    const tuoi = tyLeTuoi(t);
    const maxTuoi = Math.max(...tuoi, 0.0001);
    return (
        <article className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-t-[3px] border-border bg-card p-4 shadow-sm", MAU[ma].vien)}>
            <h4 className="text-sm font-semibold text-foreground">{ten}</h4>
            <div>
                <div className="text-2xl font-bold leading-tight tabular-nums text-foreground">
                    {Math.round(t.fb[0] / 1000)}–{Math.round(t.fb[1] / 1000)} <span className="text-xs font-medium text-muted-foreground">nghìn tài khoản Facebook</span>
                </div>
                <div className="text-xs text-muted-foreground" title={t.chinh_thuc_ghi_chu}>
                    {t.chinh_thuc_loai === "thong_ke" ? "Chính thức" : "Ước tính"} {so(t.chinh_thuc)} · {t.chinh_thuc_ghi_chu}
                </div>
            </div>
            <div className="space-y-1">
                <div className="flex h-2.5 gap-0.5">
                    <i className={cn("rounded-l", MAU[ma].dam)} style={{ width: `${nu * 100}%` }} />
                    <i className="flex-1 rounded-r bg-muted-foreground/30" />
                </div>
                <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                    <span>Nữ {pt(nu)} · {nghin(t.nu)}</span>
                    <span>Nam {pt(1 - nu)}</span>
                </div>
            </div>
            <div className="grid h-24 grid-cols-4 items-end gap-2">
                {NHOM_TUOI.map((k, i) => (
                    <div key={k} className="flex h-full flex-col items-center justify-end gap-0.5"
                        title={`${k} tuổi: ${t.tuoi[k] ? nghin(t.tuoi[k]) : "—"} · ${pt(tuoi[i], 1)} của tệp`}>
                        <b className="text-[11px] font-semibold tabular-nums text-foreground">{pt(tuoi[i])}</b>
                        <i className={cn("w-full max-w-[44px] rounded-t", MAU[ma].dam)} style={{ height: `${Math.max(2, (tuoi[i] / maxTuoi) * 56)}px` }} />
                        <span className="text-[10px] text-muted-foreground">{k}</span>
                    </div>
                ))}
            </div>
            <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                {t.diem_chinh.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
        </article>
    );
}

function BieuDoXuHuong({ x, nhom }: { x: XuHuong; nhom: TepKhachFile["nhom"] }) {
    const rows = x.moc.map((moc, i) => ({ moc, t: mocThanhSo(moc), VN: x.VN[i], PH: x.PH[i], ID: x.ID[i] }));
    const nhan = new Map(rows.map((r) => [r.t, r.moc]));
    // Nhãn trục: bỏ bớt cho khỏi chồng chữ, luôn giữ mốc đầu và mốc cuối.
    const buoc = Math.ceil(rows.length / 5);
    const ticks = rows.filter((_, i) => i % buoc === 0 || i === rows.length - 1).map((r) => r.t);
    return (
        <div className={the}>
            <h4 className={tieuDe}>{x.tieu_de}: {x.moc[0].replace("Cuối ", "")} → {x.moc[x.moc.length - 1]}</h4>
            <div className="mb-2 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {NHOM.map((n) => (
                    <span key={n} className="inline-flex items-center gap-1.5">
                        <i className={cn("h-2.5 w-2.5 rounded-sm", MAU[n].dam)} aria-hidden />{nhom[n].ten} <span className="tabular-nums text-foreground">{so(x[n][x[n].length - 1])}</span>
                    </span>
                ))}
            </div>
            <ResponsiveContainer width="100%" height={230}>
                <LineChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#B1AEA0" strokeOpacity={0.25} vertical={false} />
                    <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} ticks={ticks}
                        tick={{ fill: "#958F83", fontSize: 11 }} tickFormatter={(v: number) => (nhan.get(v) || "").replace("Cuối ", "")} />
                    <YAxis tick={{ fill: "#958F83", fontSize: 11 }} width={44} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                    <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: 8 }}
                        labelFormatter={(v: number) => nhan.get(v) || ""}
                        formatter={(v: number, k: string) => [so(v), nhom[k as MaNhom]?.ten || k]} />
                    {NHOM.map((n) => <Line key={n} type="linear" dataKey={n} stroke={MAU[n].hex} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} isAnimationActive={false} />)}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

function BangSo({ b, nhom }: { b: Bang; nhom: TepKhachFile["nhom"] }) {
    const thuong = b.dong.filter((d) => !d.tong);
    const tong = b.dong.find((d) => d.tong);
    const max = Object.fromEntries(NHOM.map((n) => [n, Math.max(...thuong.map((d) => d[n]), 1)])) as Record<MaNhom, number>;
    return (
        <div className={cn(the, "min-w-0")}>
            <h4 className={tieuDe}>{b.tieu_de}</h4>
            <p className="mb-2 text-xs text-muted-foreground">{b.nguon}</p>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                            <th className="py-2 pl-1 text-left font-medium"> </th>
                            {NHOM.map((n) => <th key={n} className="py-2 pr-2 text-right font-medium">{nhom[n].ten}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {b.dong.map((d) => (
                            <tr key={d.ten} className={cn("border-b border-border/60 last:border-0", d.tong && "font-semibold")}>
                                <td className="py-1.5 pl-1 text-foreground">{d.ten}</td>
                                {NHOM.map((n) => {
                                    const w = d.tong ? 0 : (d[n] / max[n]) * 100;
                                    return (
                                        <td key={n} className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-foreground"
                                            style={d.tong ? undefined : { background: `linear-gradient(to right, ${MAU[n].hex}33 ${w}%, transparent ${w}%)` }}>
                                            {so(d[n])}
                                            {b.ty_le_theo_tong && tong && !d.tong && <span className="ml-1 text-xs text-muted-foreground">{pt(d[n] / tong[n])}</span>}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
