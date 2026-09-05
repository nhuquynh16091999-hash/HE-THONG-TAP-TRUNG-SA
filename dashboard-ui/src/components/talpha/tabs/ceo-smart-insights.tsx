"use client";

import { useEffect, useState } from "react";
import {
    AlertTriangle, TrendingDown, PackageX, CheckCircle2,
    Lightbulb, ListChecks, Clock, ArrowRight,
} from "lucide-react";

// ─── Props: nhận tổng hợp P&L từ tab CEO để khỏi query lại ───
interface Props {
    roas: number;
    margin: number;        // %
    net: number;           // VND
    revenue: number;       // VND
    roasTarget?: number;   // mặc định 4.0 (KPI)
}

interface Alert {
    level: "danger" | "warning" | "info";
    icon: any;
    title: string;
    detail: string;
}
interface Decision { priority: number; action: string; reason: string }
interface ChecklistItem { done: boolean; label: string; note?: string }
interface TimelineEvent { when: string; label: string; tone: "ok" | "warn" }

// Suy ra alert/decision/checklist từ inventory + P&L — KHÔNG bịa số.
export default function CeoSmartInsights({ roas, margin, net, roasTarget = 4.0 }: Props) {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [decisions, setDecisions] = useState<Decision[]>([]);
    const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
    const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const inv = await fetch("/api/talpha/inventory").then(r => r.json()).catch(() => ({}));
                const skus: any[] = inv.skuMatrix || [];

                // ─── Phân loại SKU theo độ rủi ro tồn kho ───
                const urgent = skus.filter(s => s.status === "CẦN NHẬP GẤP" || (s.days != null && s.days >= 0 && s.days < 7));
                const negative = skus.filter(s => (s.total ?? 0) < 0);
                const lowStock = skus.filter(s => s.days != null && s.days >= 7 && s.days < 30);
                const outOfStock = skus.filter(s => s.status === "Hết hàng toàn hệ thống");

                // ─── D2: Smart alerts ───
                const a: Alert[] = [];
                if (urgent.length)
                    a.push({ level: "danger", icon: AlertTriangle, title: `${urgent.length} SKU cần nhập GẤP`, detail: urgent.slice(0, 4).map(s => s.code).join(", ") + (urgent.length > 4 ? "…" : "") });
                if (negative.length)
                    a.push({ level: "danger", icon: PackageX, title: `${negative.length} SKU tồn ÂM (bán vượt kho/lỗi sổ)`, detail: negative.slice(0, 4).map(s => s.code).join(", ") + (negative.length > 4 ? "…" : "") });
                if (roas > 0 && roas < roasTarget)
                    a.push({ level: roas < roasTarget * 0.6 ? "danger" : "warning", icon: TrendingDown, title: `ROAS ${roas.toFixed(2)}x dưới mục tiêu ${roasTarget}x`, detail: `Cần tối ưu campaign hoặc cắt ad lỗ` });
                if (margin < 0)
                    a.push({ level: "danger", icon: TrendingDown, title: `Biên lợi nhuận âm (${margin.toFixed(1)}%)`, detail: `Đang lỗ ròng — soát chi phí ads & vận chuyển` });
                if (lowStock.length)
                    a.push({ level: "warning", icon: AlertTriangle, title: `${lowStock.length} SKU sắp thiếu (<30 ngày)`, detail: `Lên kế hoạch nhập trong 2 tuần` });
                if (!a.length)
                    a.push({ level: "info", icon: CheckCircle2, title: "Không có cảnh báo nghiêm trọng", detail: "Tồn kho & hiệu quả ads trong ngưỡng an toàn" });

                // ─── D3: Decision support (ưu tiên theo độ khẩn) ───
                const d: Decision[] = [];
                if (urgent.length) d.push({ priority: 1, action: `Đặt nhập ${urgent.length} SKU cần gấp`, reason: `Hết hàng <7 ngày → mất doanh thu & gián đoạn ads` });
                if (roas > 0 && roas < roasTarget) d.push({ priority: 2, action: "Soát & cắt campaign ROAS thấp", reason: `ROAS tổng ${roas.toFixed(2)}x < ${roasTarget}x mục tiêu` });
                if (negative.length) d.push({ priority: 1, action: `Đối soát ${negative.length} SKU tồn âm`, reason: "Tồn âm = bán vượt kho hoặc sai sổ → rủi ro huỷ đơn" });
                if (lowStock.length) d.push({ priority: 3, action: `Lập kế hoạch nhập ${lowStock.length} SKU sắp thiếu`, reason: "Đủ bán 7–30 ngày → cần đặt trước lead time" });
                if (net > 0 && roas >= roasTarget) d.push({ priority: 4, action: "Scale campaign hiệu quả", reason: `ROAS ${roas.toFixed(2)}x ≥ mục tiêu & đang lãi ròng` });
                d.sort((x, y) => x.priority - y.priority);

                // ─── D4: Ops checklist (việc trong ngày) ───
                const saudiOk = (inv.sources?.saudi?.ok) ?? false;
                const cl: ChecklistItem[] = [
                    { done: urgent.length === 0, label: "Tồn kho: không có SKU cần nhập gấp", note: urgent.length ? `${urgent.length} SKU cần xử lý` : undefined },
                    { done: negative.length === 0, label: "Đối soát SKU tồn âm", note: negative.length ? `${negative.length} SKU` : undefined },
                    { done: roas >= roasTarget, label: `ROAS đạt mục tiêu ≥ ${roasTarget}x`, note: roas > 0 ? `hiện ${roas.toFixed(2)}x` : undefined },
                    { done: saudiOk, label: "POS Saudi sync OK", note: saudiOk ? undefined : "lỗi 500 — cần kiểm tra" },
                ];

                // ─── D5: Timeline (data freshness — mốc thật) ───
                const tl: TimelineEvent[] = [];
                if (inv.asOf?.label) tl.push({ when: "Tồn kho", label: inv.asOf.label, tone: "ok" });
                if (inv._snapshotTime) tl.push({ when: "BQ snapshot", label: String(inv._snapshotTime).slice(0, 16).replace("T", " "), tone: "ok" });
                (inv.marketOverview || []).slice(0, 3).forEach((m: any) => {
                    tl.push({ when: m.market, label: m.source || "—", tone: "ok" });
                });
                if (!saudiOk) tl.push({ when: "Saudi POS", label: "Sync lỗi 500 — data SA có thể thiếu", tone: "warn" });

                setAlerts(a); setDecisions(d); setChecklist(cl); setTimeline(tl);
            } finally {
                setLoading(false);
            }
        })();
    }, [roas, margin, net, roasTarget]);

    if (loading) return null;

    const levelStyle = {
        danger: "border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300",
        warning: "border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300",
        info: "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };

    return (
        <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-foreground">CEO Smart Insights</h3>
                <span className="text-xs text-muted-foreground">— cảnh báo & hành động suy ra từ tồn kho + P&L</span>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* D2: Smart alerts */}
                <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" /> Cảnh báo</div>
                    <div className="space-y-2">
                        {alerts.map((al, i) => (
                            <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${levelStyle[al.level]}`}>
                                <al.icon className="mt-0.5 h-4 w-4 shrink-0" />
                                <div>
                                    <p className="text-sm font-medium leading-tight">{al.title}</p>
                                    <p className="text-xs opacity-80">{al.detail}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* D3: Decision support */}
                <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground"><Lightbulb className="h-3.5 w-3.5" /> Hành động đề xuất</div>
                    <div className="space-y-2">
                        {decisions.length === 0 && <p className="text-sm text-muted-foreground">Chưa có hành động ưu tiên.</p>}
                        {decisions.map((dc, i) => (
                            <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2">
                                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${dc.priority === 1 ? "bg-rose-500" : dc.priority === 2 ? "bg-amber-500" : "bg-slate-400"}`}>{dc.priority}</span>
                                <div>
                                    <p className="flex items-center gap-1 text-sm font-medium text-foreground"><ArrowRight className="h-3 w-3" />{dc.action}</p>
                                    <p className="text-xs text-muted-foreground">{dc.reason}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* D4: Ops checklist */}
                <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground"><ListChecks className="h-3.5 w-3.5" /> Checklist vận hành</div>
                    <div className="space-y-1.5">
                        {checklist.map((c, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                                {c.done
                                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                                    : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
                                <span className={c.done ? "text-muted-foreground line-through" : "text-foreground"}>{c.label}</span>
                                {c.note && <span className="text-xs text-amber-600 dark:text-amber-400">({c.note})</span>}
                            </div>
                        ))}
                    </div>
                </div>

                {/* D5: Timeline */}
                <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Độ mới dữ liệu</div>
                    <div className="space-y-1.5">
                        {timeline.map((t, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm">
                                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${t.tone === "ok" ? "bg-emerald-500" : "bg-amber-500"}`} />
                                <div>
                                    <span className="font-medium text-foreground">{t.when}</span>
                                    <span className="text-muted-foreground"> — {t.label}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
