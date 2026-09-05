"use client";

import React, { useEffect, useState, useMemo } from "react";
import { cn, formatVNDCompact } from "@/lib/utils";
import { Target, TrendingUp, Users, Zap, Trophy, Calendar, Award, Flame } from "lucide-react";

interface KpiRow {
    thang: string;
    tuan: string;
    marketer: string;
    kpi_revenue: number;
    ads_pct: number;
}

type ActualBucket = { total: number; ads: number; dtUocTinh: number; marketers: Record<string, number>; marketerAds: Record<string, number>; marketerUocTinh: Record<string, number> };
type MonthlyActuals = Record<string, ActualBucket>;
type DailyActuals = Record<string, ActualBucket>;
type WeeklyActuals = Record<string, ActualBucket>;

interface KpiTrackerProps {
    brand: "zen8" | "hnle";
    monthlyActuals: MonthlyActuals;
    dailyActuals?: DailyActuals;
    weeklyActuals?: WeeklyActuals;
}

function MegaProgressBar({ pct, label }: { pct: number; label?: string }) {
    const clamped = Math.min(pct, 100);
    const gradient = pct > 100
        ? "from-emerald-400 via-emerald-500 to-teal-500"
        : pct >= 70 ? "from-amber-400 via-orange-500 to-rose-500"
            : pct >= 40 ? "from-orange-400 to-rose-500" : "from-rose-500 to-pink-600";
    return (
        <div className="relative w-full">
            <div className="h-8 w-full rounded-full bg-gray-800/60 overflow-hidden border border-gray-700/50 shadow-inner">
                <div className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-1000 ease-out flex items-center justify-end px-3 shadow-lg", gradient)} style={{ width: `${clamped}%` }}>
                    {clamped > 15 && label && <span className="text-xs font-bold text-white drop-shadow-lg">{label}</span>}
                </div>
            </div>
            {clamped <= 15 && label && <span className="absolute top-1/2 -translate-y-1/2 left-3 text-xs font-bold text-white drop-shadow-lg">{label}</span>}
        </div>
    );
}

function MiniBar({ pct }: { pct: number }) {
    const clamped = Math.min(pct, 100);
    const color = pct >= 100 ? "from-emerald-400 to-emerald-500" : pct >= 70 ? "from-amber-400 to-orange-500" : pct >= 40 ? "from-orange-400 to-rose-500" : "from-rose-500 to-pink-600";
    return (
        <div className="h-2.5 w-full rounded-full bg-gray-800/60 overflow-hidden">
            <div className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-500", color)} style={{ width: `${clamped}%` }} />
        </div>
    );
}

function PctPill({ pct, large = false }: { pct: number; large?: boolean }) {
    const color = pct >= 100 ? "text-emerald-300 bg-emerald-500/15 border-emerald-500/30"
        : pct >= 70 ? "text-amber-300 bg-amber-500/15 border-amber-500/30"
            : pct >= 40 ? "text-orange-300 bg-orange-500/15 border-orange-500/30"
                : "text-rose-300 bg-rose-500/15 border-rose-500/30";
    return <span className={cn("inline-flex items-center rounded-full border font-bold tabular-nums", color, large ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]")}>{pct.toFixed(1)}%</span>;
}

function findActual(kpiName: string, actuals?: Record<string, number>): number {
    if (!actuals) return 0;
    if (actuals[kpiName] !== undefined) return actuals[kpiName];
    const lower = kpiName.toLowerCase();
    for (const [key, val] of Object.entries(actuals)) {
        if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) return val;
    }
    return 0;
}

function matchMonthKey(thang: string, actuals: MonthlyActuals): MonthlyActuals[string] | null {
    // thang = "THÁNG 3" or "THÁNG 4" — match against keys like "THÁNG 3", "THÁNG 4"
    const num = thang.match(/(\d+)/)?.[1];
    if (!num) return null;
    for (const [key, val] of Object.entries(actuals)) {
        if (key.match(/(\d+)/)?.[1] === num) return val;
    }
    return null;
}

/** Tính projection: string-based dates "YYYY-MM-DD"
 *  - Kỳ đã qua: return actual values (final result)
 *  - Kỳ đang diễn ra: project dựa trên tốc độ hiện tại
 *  - Kỳ chưa bắt đầu hoặc chưa có data: return null */
/** calcProjection dùng DT Ước Tính (dtUocTinh) để tính % KPI Tạm Tính */
function calcProjection(dtUocTinh: number, kpi: number, adsSpend: number, fromStr: string, toStr: string): { pct: number; revenue: number; ads: number; adsPct: number; isFinal: boolean } | null {
    if (kpi <= 0 || dtUocTinh <= 0) return null;
    const todayStr = new Date().toISOString().slice(0, 10);
    if (todayStr < fromStr) return null;

    // Kỳ đã kết thúc → return DT Ước Tính thực tế (final)
    if (todayStr > toStr) {
        const adsPct = dtUocTinh > 0 ? (adsSpend / dtUocTinh) * 100 : 0;
        return { pct: (dtUocTinh / kpi) * 100, revenue: dtUocTinh, ads: adsSpend, adsPct, isFinal: true };
    }

    // Kỳ đang diễn ra → project từ DT Ước Tính hiện tại
    const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1;
    const totalDays = Math.max(1, daysBetween(fromStr, toStr));
    const elapsed = Math.max(1, daysBetween(fromStr, todayStr));
    const projRevenue = (dtUocTinh / elapsed) * totalDays;
    const projAds = (adsSpend / elapsed) * totalDays;
    const projAdsPct = projRevenue > 0 ? (projAds / projRevenue) * 100 : 0;
    return { pct: (projRevenue / kpi) * 100, revenue: projRevenue, ads: projAds, adsPct: projAdsPct, isFinal: false };
}

/** Pad number to 2 digits */
function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }

/** Parse date range from tuan string → "YYYY-MM-DD" strings.
 *  Handles: "TUẦN 4 16/03/2026 - 22/03/2026", "TUẦN 3 14/4 - 20/4", "TUẦN 3 14-20/4" */
function parseWeekDates(tuan: string, thang: string): { from: string; to: string } | null {
    const defaultYear = new Date().getFullYear();
    const monthNum = parseInt(thang.match(/\d+/)?.[0] || "0");

    // Format 1: DD/MM/YYYY - DD/MM/YYYY (with year)
    const withYear = tuan.match(/(\d{1,2})\s*[\/\.]\s*(\d{1,2})\s*[\/\.]\s*(\d{4})\s*[-–]\s*(\d{1,2})\s*[\/\.]\s*(\d{1,2})\s*[\/\.]\s*(\d{4})/);
    if (withYear) {
        return {
            from: `${withYear[3]}-${pad2(parseInt(withYear[2]))}-${pad2(parseInt(withYear[1]))}`,
            to: `${withYear[6]}-${pad2(parseInt(withYear[5]))}-${pad2(parseInt(withYear[4]))}`,
        };
    }

    // Format 2: DD/MM - DD/MM (no year)
    const noYear = tuan.match(/(\d{1,2})\s*[\/\.]\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\s*[\/\.]\s*(\d{1,2})/);
    if (noYear) {
        return {
            from: `${defaultYear}-${pad2(parseInt(noYear[2]))}-${pad2(parseInt(noYear[1]))}`,
            to: `${defaultYear}-${pad2(parseInt(noYear[4]))}-${pad2(parseInt(noYear[3]))}`,
        };
    }

    // Format 3: DD-DD/MM (short, same month)
    const shortFmt = tuan.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*[\/\.]\s*(\d{1,2})/);
    if (shortFmt) {
        const m = pad2(parseInt(shortFmt[3]));
        return { from: `${defaultYear}-${m}-${pad2(parseInt(shortFmt[1]))}`, to: `${defaultYear}-${m}-${pad2(parseInt(shortFmt[2]))}` };
    }

    // Fallback: week number → 7-day blocks
    if (monthNum > 0) {
        const weekNum = parseInt(tuan.match(/\d+/)?.[0] || "0");
        if (weekNum > 0) {
            const startDay = (weekNum - 1) * 7 + 1;
            const lastDay = new Date(defaultYear, monthNum, 0).getDate();
            const endDay = weekNum >= 4 ? lastDay : Math.min(startDay + 6, lastDay);
            return { from: `${defaultYear}-${pad2(monthNum)}-${pad2(startDay)}`, to: `${defaultYear}-${pad2(monthNum)}-${pad2(endDay)}` };
        }
    }
    return null;
}

/** Sum dailyActuals in a "YYYY-MM-DD" string range (lexicographic comparison) */
function sumDailyStr(daily: DailyActuals, fromStr: string, toStr: string): ActualBucket {
    const result: ActualBucket = { total: 0, ads: 0, dtUocTinh: 0, marketers: {}, marketerAds: {}, marketerUocTinh: {} };
    for (const [dateStr, bucket] of Object.entries(daily)) {
        if (dateStr >= fromStr && dateStr <= toStr) {
            result.total += bucket.total;
            result.ads += bucket.ads;
            result.dtUocTinh += bucket.dtUocTinh;
            for (const [k, v] of Object.entries(bucket.marketers)) result.marketers[k] = (result.marketers[k] || 0) + v;
            for (const [k, v] of Object.entries(bucket.marketerAds)) result.marketerAds[k] = (result.marketerAds[k] || 0) + v;
            for (const [k, v] of Object.entries(bucket.marketerUocTinh)) result.marketerUocTinh[k] = (result.marketerUocTinh[k] || 0) + v;
        }
    }
    return result;
}

export default function KpiTracker({ brand, monthlyActuals, dailyActuals, weeklyActuals }: KpiTrackerProps) {
    const [kpiData, setKpiData] = useState<KpiRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMarketer, setSelectedMarketer] = useState<string>("__all__");

    useEffect(() => {
        fetch(`/api/kpi-sheets?brand=${brand}`)
            .then(r => r.json())
            .then(d => setKpiData(d.data || []))
            .catch(() => setKpiData([]))
            .finally(() => setLoading(false));
    }, [brand]);

    const derived = useMemo(() => {
        if (kpiData.length === 0) return null;
        const isTotal = (s: string) => s.toUpperCase().includes("TOTAL");
        const isTeam = (s: string) => s.includes("Tổng") || s.toUpperCase().includes("TONG");

        const rawMonthRows = kpiData.filter(r => isTotal(r.tuan) && isTeam(r.marketer));
        const monthRows = [...rawMonthRows].sort((a, b) => {
            const ma = parseInt(a.thang.match(/\d+/)?.[0] || "0");
            const mb = parseInt(b.thang.match(/\d+/)?.[0] || "0");
            return mb - ma;
        });

        const weekRows = kpiData.filter(r => !isTotal(r.tuan) && isTeam(r.marketer));

        const seenM = new Set<string>();
        const monthMarketerRows = kpiData.filter(r => {
            if (!isTotal(r.tuan) || isTeam(r.marketer)) return false;
            const k = `${r.thang}|${r.marketer}`;
            if (seenM.has(k)) return false;
            seenM.add(k);
            return true;
        });

        const seenW = new Set<string>();
        const weekMarketerRows = kpiData.filter(r => {
            if (isTotal(r.tuan) || isTeam(r.marketer)) return false;
            const k = `${r.thang}|${r.tuan}|${r.marketer}`;
            if (seenW.has(k)) return false;
            seenW.add(k);
            return true;
        });

        const marketerList = [...new Set(monthMarketerRows.map(r => r.marketer))];
        const adsPct = monthRows[0]?.ads_pct || 0;
        return { monthRows, weekRows, monthMarketerRows, weekMarketerRows, marketerList, adsPct };
    }, [kpiData]);

    if (loading) {
        return <div className="space-y-4"><div className="h-48 rounded-2xl bg-gray-800/40 animate-pulse" /><div className="h-64 rounded-2xl bg-gray-800/40 animate-pulse" /></div>;
    }
    if (!derived) {
        return <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">Không có dữ liệu KPI từ Google Sheets</div>;
    }

    const { monthRows, weekRows, monthMarketerRows, weekMarketerRows, marketerList, adsPct } = derived;
    const isAll = selectedMarketer === "__all__";
    const brandColor = brand === "zen8" ? "from-rose-500 via-pink-500 to-purple-500" : "from-indigo-500 via-blue-500 to-cyan-500";
    const brandAccent = brand === "zen8" ? "text-rose-400" : "text-indigo-400";

    // Hero banner: ưu tiên tháng theo lịch hiện tại (calendar month).
    // Fallback monthRows[0] (tháng có số lớn nhất) nếu sheet chưa có row cho tháng hiện tại —
    // lý do: nếu sheet pre-fill KPI tháng kế tiếp, monthRows[0] sẽ là tháng tương lai.
    const currentMonthNum = new Date().getMonth() + 1;
    const currentMonth = monthRows.find(r => parseInt(r.thang.match(/\d+/)?.[0] || "0") === currentMonthNum) || monthRows[0];
    const currentMonthKpi = (() => {
        if (!currentMonth) return 0;
        if (!isAll) {
            const mk = monthMarketerRows.find(m => m.thang === currentMonth.thang && m.marketer === selectedMarketer);
            return mk?.kpi_revenue || 0;
        }
        return currentMonth.kpi_revenue;
    })();
    const currentMonthMa = currentMonth ? matchMonthKey(currentMonth.thang, monthlyActuals) : null;
    const totalKpi = currentMonthKpi;
    const totalActual = currentMonthMa
        ? (isAll ? currentMonthMa.total : findActual(selectedMarketer, currentMonthMa.marketers))
        : 0;
    const teamPct = totalKpi > 0 ? (totalActual / totalKpi) * 100 : 0;
    const gap = totalKpi - totalActual;
    const maxAds = totalKpi * adsPct;

    // Marketer filter pills component
    const FilterPills = () => (
        <div className="border-b border-gray-800 px-5 py-3 flex flex-wrap items-center gap-2">
            <button onClick={() => setSelectedMarketer("__all__")} className={cn("rounded-full px-4 py-1.5 text-xs font-semibold transition-all", isAll ? cn("bg-gradient-to-r text-white shadow-lg", brandColor) : "bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700")}>Tất cả</button>
            {marketerList.map(m => (
                <button key={m} onClick={() => setSelectedMarketer(m)} className={cn("rounded-full px-4 py-1.5 text-xs font-semibold transition-all", selectedMarketer === m ? cn("bg-gradient-to-r text-white shadow-lg", brandColor) : "bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700")}>{m}</button>
            ))}
        </div>
    );

    return (
        <div className="space-y-6">
            {/* ═══ HERO BANNER ═══ */}
            <div className="relative overflow-hidden rounded-2xl border border-gray-700/50 bg-gradient-to-br from-gray-900 via-gray-900 to-gray-950 shadow-2xl">
                <div className={cn("absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br opacity-20 blur-3xl", brandColor)} />
                <div className={cn("absolute -left-10 -bottom-10 h-48 w-48 rounded-full bg-gradient-to-br opacity-10 blur-3xl", brandColor)} />
                <div className="relative p-6">
                    <div className="flex items-center justify-between mb-5">
                        <div className="flex items-center gap-3">
                            <div className={cn("rounded-xl p-2.5 bg-gradient-to-br shadow-lg", brandColor)}><Trophy className="h-6 w-6 text-white" /></div>
                            <div>
                                <h2 className="text-lg font-bold text-white">{isAll ? "KPI Tổng Team" : `KPI — ${selectedMarketer}`}</h2>
                                <p className="text-xs text-gray-400">{currentMonth?.thang || ""}</p>
                            </div>
                        </div>
                        <PctPill pct={teamPct} large />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <StatCard icon={Target} label="KPI Mục tiêu" value={formatVNDCompact(totalKpi)} accent="text-indigo-400" />
                        <StatCard icon={TrendingUp} label="DT Thành Công" value={formatVNDCompact(totalActual)} accent="text-emerald-400" />
                        <StatCard icon={Flame} label={gap > 0 ? "Còn thiếu" : "Vượt KPI"} value={formatVNDCompact(Math.abs(gap))} accent={gap > 0 ? "text-rose-400" : "text-emerald-400"} />
                        <StatCard icon={Zap} label={`Max Ads (${(adsPct * 100).toFixed(0)}%)`} value={formatVNDCompact(maxAds)} accent="text-amber-400" />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-2 text-xs text-gray-400">
                            <span>Tiến độ đạt KPI</span>
                            <span className="tabular-nums">{formatVNDCompact(totalActual)} / {formatVNDCompact(totalKpi)}</span>
                        </div>
                        <MegaProgressBar pct={teamPct} label={`${teamPct.toFixed(1)}%`} />
                    </div>
                </div>
            </div>

            {/* ═══ KPI Theo Tháng ═══ */}
            <div className="rounded-2xl border border-gray-700/50 bg-gradient-to-br from-gray-900 to-gray-950 shadow-xl overflow-hidden">
                <div className="border-b border-gray-800 px-5 py-3 flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2"><Calendar className={cn("h-4 w-4", brandAccent)} /><h3 className="text-sm font-bold text-white">KPI Theo Tháng</h3></div>
                    <span className="text-[10px] text-gray-500">Chọn MKT để xem KPI riêng của từng người</span>
                </div>
                <FilterPills />
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] items-center gap-4 px-5 py-2.5 border-b border-gray-800 text-[11px] uppercase tracking-wider text-gray-500">
                    <div className="font-semibold">Tháng</div><div className="text-right font-semibold">KPI</div><div className="text-right font-semibold">DT Thành Công</div><div className="text-right font-semibold">Ads Thực Tế</div><div className="text-right font-semibold">% KPI Tạm Tính</div><div className="text-right font-semibold">% KPI Thực Tế</div>
                </div>
                <div>
                    {monthRows.map((mr, idx) => {
                        const displayRow = isAll ? mr : (monthMarketerRows.find(r => r.thang === mr.thang && r.marketer === selectedMarketer) || { ...mr, kpi_revenue: 0 });
                        const kpi = displayRow.kpi_revenue;
                        const ma = matchMonthKey(mr.thang, monthlyActuals);
                        const actual = ma ? (isAll ? ma.total : findActual(selectedMarketer, ma.marketers)) : 0;
                        const dtUocTinh = ma ? (isAll ? ma.dtUocTinh : findActual(selectedMarketer, ma.marketerUocTinh)) : 0;
                        const adsSpend = ma ? (isAll ? ma.ads : findActual(selectedMarketer, ma.marketerAds)) : 0;
                        const adsPctVal = actual > 0 ? (adsSpend / actual) * 100 : 0;
                        const pct = kpi > 0 ? (actual / kpi) * 100 : 0;
                        // % KPI Tạm Tính = DT Ước Tính hiện tại / KPI (không project)
                        const tamTinhPct = kpi > 0 ? (dtUocTinh / kpi) * 100 : 0;
                        const adsUocTinhPct = dtUocTinh > 0 ? (adsSpend / dtUocTinh) * 100 : 0;

                        return (
                            <div key={mr.thang + idx} className="border-b border-gray-800/50 last:border-0">
                                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] items-center gap-4 px-5 py-4 bg-gray-900/40">
                                    <div className="flex items-center gap-2">
                                        <span className={cn("h-2 w-2 rounded-full bg-gradient-to-r animate-pulse", brandColor)} />
                                        <span className="text-base font-bold text-white">{mr.thang}</span>
                                    </div>
                                    <div className="text-right font-semibold text-gray-300 tabular-nums">{formatVNDCompact(kpi)}</div>
                                    <div className="text-right font-bold text-emerald-400 tabular-nums">{formatVNDCompact(actual)}</div>
                                    <div className="text-right tabular-nums"><span className="text-amber-400 font-semibold">{formatVNDCompact(adsSpend)}</span> <span className={cn("text-[10px]", adsPctVal <= (adsPct * 100) ? "text-emerald-400" : "text-rose-400")}>{adsPctVal.toFixed(1)}%</span></div>
                                    <div className="text-right relative group/proj">
                                        {dtUocTinh > 0 ? <PctPill pct={tamTinhPct} /> : <span className="text-xs text-gray-600">—</span>}
                                        {dtUocTinh > 0 && (
                                            <div className="pointer-events-none absolute right-0 bottom-full mb-2 z-30 opacity-0 group-hover/proj:opacity-100 transition-opacity">
                                                <div className="rounded-lg bg-gray-950 border border-gray-700 px-3 py-2 shadow-xl text-[11px] text-gray-300 whitespace-nowrap space-y-1">
                                                    <div>DT Ước Tính: <span className="text-emerald-400 font-semibold">{formatVNDCompact(dtUocTinh)}</span></div>
                                                    <div>%Ads Ước Tính: <span className={cn("font-semibold", adsUocTinhPct <= (adsPct * 100) ? "text-emerald-400" : "text-rose-400")}>{adsUocTinhPct.toFixed(1)}%</span></div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-right"><PctPill pct={pct} /></div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ═══ KPI Theo Tuần ═══ */}
            <div className="rounded-2xl border border-gray-700/50 bg-gradient-to-br from-gray-900 to-gray-950 shadow-xl overflow-hidden">
                <div className="border-b border-gray-800 px-5 py-3 flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2"><Award className={cn("h-4 w-4", brandAccent)} /><h3 className="text-sm font-bold text-white">KPI Theo Tuần</h3></div>
                    <span className="text-[10px] text-gray-500">Chọn MKT để xem KPI riêng của từng người</span>
                </div>
                <FilterPills />
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] items-center gap-4 px-5 py-2.5 border-b border-gray-800 text-[11px] uppercase tracking-wider text-gray-500">
                    <div className="font-semibold">Tuần</div><div className="text-right font-semibold">KPI</div><div className="text-right font-semibold">DT Thành Công</div><div className="text-right font-semibold">Ads Thực Tế</div><div className="text-right font-semibold">% KPI Tạm Tính</div><div className="text-right font-semibold">% KPI Thực Tế</div>
                </div>
                <div>
                    {[...weekRows]
                        .sort((a, b) => {
                            const ma = parseInt(a.thang.match(/\d+/)?.[0] || "0");
                            const mb = parseInt(b.thang.match(/\d+/)?.[0] || "0");
                            if (mb !== ma) return mb - ma;
                            const wa = parseInt(a.tuan.match(/\d+/)?.[0] || "0");
                            const wb = parseInt(b.tuan.match(/\d+/)?.[0] || "0");
                            return wb - wa;
                        })
                        .map((wr, idx) => {
                            const displayRow = isAll ? wr : (weekMarketerRows.find(r => r.thang === wr.thang && r.tuan === wr.tuan && r.marketer === selectedMarketer) || { ...wr, kpi_revenue: 0 });
                            const kpi = displayRow.kpi_revenue;

                            // 1) Parse date range từ sheet (e.g. "TUẦN 4 16/03/2026 - 22/03/2026")
                            const parsedDates = parseWeekDates(wr.tuan, wr.thang);
                            // 2) Sum daily data theo string range
                            const weekBucket = (parsedDates && dailyActuals)
                                ? sumDailyStr(dailyActuals, parsedDates.from, parsedDates.to)
                                : null;
                            // 3) Fallback: weeklyActuals (ceil(day/7))
                            const weekNum = wr.tuan.match(/\d+/)?.[0] || "0";
                            const fallbackBucket = weeklyActuals?.[`${wr.thang}|TUẦN ${weekNum}`] || null;
                            const bucket = (weekBucket && weekBucket.total > 0) ? weekBucket : fallbackBucket;

                            const actual = bucket ? (isAll ? bucket.total : findActual(selectedMarketer, bucket.marketers)) : 0;
                            const dtUocTinh = bucket ? (isAll ? bucket.dtUocTinh : findActual(selectedMarketer, bucket.marketerUocTinh)) : 0;
                            const adsSpend = bucket ? (isAll ? bucket.ads : findActual(selectedMarketer, bucket.marketerAds)) : 0;

                            const adsPctVal = actual > 0 ? (adsSpend / actual) * 100 : 0;
                            const pct = kpi > 0 ? (actual / kpi) * 100 : 0;
                            // % KPI Tạm Tính = DT Ước Tính hiện tại / KPI (không project)
                            const tamTinhPct = kpi > 0 ? (dtUocTinh / kpi) * 100 : 0;
                            const adsUocTinhPct = dtUocTinh > 0 ? (adsSpend / dtUocTinh) * 100 : 0;

                            const weekLabel = wr.tuan.split(/\s+/).slice(0, 2).join(" ");
                            const dateLabel = wr.tuan.replace(/(TUẦN|Tuần)\s*\d+\s*/i, "").trim();

                            return (
                                <div
                                    key={wr.thang + wr.tuan + idx}
                                    title={`${wr.thang} · ${weekLabel} — ${dateLabel}`}
                                    className="group relative border-b border-gray-800/50 last:border-0 transition-colors hover:bg-gray-800/40"
                                >
                                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] items-center gap-4 px-5 py-3.5">
                                        <div className="flex items-center gap-2">
                                            <span className={cn("h-1.5 w-1.5 rounded-full bg-gradient-to-r", brandColor)} />
                                            <span className="font-semibold text-white text-sm">{wr.thang} · {weekLabel}</span>
                                        </div>
                                        <div className="text-right font-semibold text-gray-200 tabular-nums">{formatVNDCompact(kpi)}</div>
                                        <div className="text-right font-bold text-emerald-400 tabular-nums">{formatVNDCompact(actual)}</div>
                                        <div className="text-right tabular-nums"><span className="text-amber-400 font-semibold">{formatVNDCompact(adsSpend)}</span> <span className={cn("text-[10px]", adsPctVal <= (adsPct * 100) ? "text-emerald-400" : "text-rose-400")}>{adsPctVal.toFixed(1)}%</span></div>
                                        <div className="text-right relative group/proj">
                                            {dtUocTinh > 0 ? <PctPill pct={tamTinhPct} /> : <span className="text-xs text-gray-600">—</span>}
                                            {dtUocTinh > 0 && (
                                                <div className="pointer-events-none absolute right-0 bottom-full mb-2 z-30 opacity-0 group-hover/proj:opacity-100 transition-opacity">
                                                    <div className="rounded-lg bg-gray-950 border border-gray-700 px-3 py-2 shadow-xl text-[11px] text-gray-300 whitespace-nowrap space-y-1">
                                                        <div>DT Ước Tính: <span className="text-emerald-400 font-semibold">{formatVNDCompact(dtUocTinh)}</span></div>
                                                        <div>%Ads Ước Tính: <span className={cn("font-semibold", adsUocTinhPct <= (adsPct * 100) ? "text-emerald-400" : "text-rose-400")}>{adsUocTinhPct.toFixed(1)}%</span></div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-right"><PctPill pct={pct} /></div>
                                    </div>
                                    <div className="pointer-events-none absolute left-5 -top-1 -translate-y-full z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className="rounded-lg bg-gray-950 border border-gray-700 px-3 py-1.5 shadow-xl text-[11px] text-gray-300 whitespace-nowrap">{dateLabel}</div>
                                    </div>
                                </div>
                            );
                        })}
                </div>
            </div>
        </div>
    );
}

function StatCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: string }) {
    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3 backdrop-blur-sm hover:bg-gray-800/50 transition-colors">
            <div className="flex items-center gap-2 mb-1.5"><Icon className={cn("h-3.5 w-3.5", accent)} /><span className="text-[11px] text-gray-500 font-medium">{label}</span></div>
            <div className={cn("text-xl font-bold tabular-nums", accent)}>{value}</div>
        </div>
    );
}
