"use client";

/**
 * G1 — Tab "Sức khoẻ quảng cáo".
 *
 * Đọc thẳng 2 view mới: vw_ad_windows + vw_attribution_quality (port từ
 * STRAMARK_AdsOps). Trả lời câu hỏi mà các tab cũ không trả lời được:
 * quảng cáo nào đang đốt tiền mà không ra đơn, và cái nào đang xấu đi so
 * với chính nó tuần trước.
 *
 * ⚠ Tab này KHÔNG theo date picker. Ngưỡng và cửa sổ (1/3/7 ngày) nằm
 * trong view để chỉ có MỘT định nghĩa — nếu tab tự tính lại theo khoảng
 * ngày tuỳ chọn thì lại đẻ ra định nghĩa thứ hai, đúng cái bệnh mà G1
 * sinh ra để chữa. Muốn đổi ngưỡng: sửa 10_vw_ad_windows.sql rồi deploy.
 */

import { useEffect, useState } from "react";
import {
    AlertTriangle, TrendingUp, Target, Megaphone, Link2, Ban,
} from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { BQ_PROJECT, DATASET } from "../constants";
import { formatVNDCompact } from "../utils";

interface AdRow {
    ad_id: string;
    ad_name: string | null;
    campaign_name: string | null;
    account_name: string | null;
    spend_7d: number;
    spend_3d: number;
    pos_orders_7d: number;
    pos_cpo_7d: number | null;
    pos_cpo_3d: number | null;
    ctr_7d: number | null;
    frequency_1d: number | null;
    ad_age_days: number;
    health_status: string;
    health_severity: number;
    recommended_action: string;
}

const STATUS_UI: Record<string, { label: string; cls: string }> = {
    NO_ORDERS: { label: "0 đơn / 7 ngày", cls: "bg-rose-500/15 text-rose-500" },
    CPO_SPIKE: { label: "CPO vọt lên", cls: "bg-rose-500/15 text-rose-500" },
    CPO_HIGH: { label: "CPO cao gấp đôi", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    HEALTHY: { label: "Bình thường", cls: "bg-emerald-500/15 text-emerald-500" },
};

export default function TALPHAAdHealthTab() {
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<AdRow[]>([]);
    const [sum, setSum] = useState({
        spend7d: 0, orders7d: 0, cpoChung: 0,
        adKhongDon: 0, tienKhongDon: 0, adXauDi: 0, tienXauDi: 0,
    });
    const [attr, setAttr] = useState<{
        report_date: string; pct_don_gan_duoc: number;
        don_ad_khong_tra_ve: number; pct_ad_khong_tra_ve: number;
        don_fx_khong_biet: number;
    } | null>(null);

    useEffect(() => {
        async function run() {
            setLoading(true);
            try {
                const T = `\`${BQ_PROJECT}.${DATASET}\``;
                const queries = [
                    // Q0 — tổng hợp. Loại campaign test (cờ sinh từ rules file trong view).
                    `SELECT
                        ROUND(SUM(spend_7d)) AS spend7d,
                        SUM(pos_orders_7d) AS orders7d,
                        ROUND(SAFE_DIVIDE(SUM(spend_7d), NULLIF(SUM(pos_orders_7d),0))) AS cpoChung,
                        COUNTIF(health_status = 'NO_ORDERS') AS adKhongDon,
                        ROUND(SUM(IF(health_status = 'NO_ORDERS', spend_7d, 0))) AS tienKhongDon,
                        COUNTIF(cpo_trend_worse) AS adXauDi,
                        ROUND(SUM(IF(cpo_trend_worse, spend_3d, 0))) AS tienXauDi
                     FROM ${T}.vw_ad_windows WHERE NOT is_test_campaign`,

                    // Q1 — danh sách cần xử lý, nặng tiền lên trước
                    `SELECT ad_id, ad_name, campaign_name, account_name,
                            spend_7d, spend_3d, pos_orders_7d, pos_cpo_7d, pos_cpo_3d,
                            ctr_7d, frequency_1d, ad_age_days,
                            health_status, health_severity, recommended_action
                     FROM ${T}.vw_ad_windows
                     WHERE NOT is_test_campaign AND health_severity >= 3
                     ORDER BY health_severity DESC, spend_7d DESC
                     LIMIT 50`,

                    // Q2 — độ phủ gán của ngày gần nhất đã trọn vẹn
                    `SELECT report_date, pct_don_gan_duoc, don_ad_khong_tra_ve,
                            pct_ad_khong_tra_ve, don_fx_khong_biet
                     FROM ${T}.vw_attribution_quality
                     WHERE report_date < CURRENT_DATE()
                     ORDER BY report_date DESC LIMIT 1`,
                ];

                const res = await Promise.all(
                    queries.map(q =>
                        fetch("/api/query", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q }),
                        }).then(r => r.json()).catch(() => ({ data: [] }))
                    )
                );

                const s = (res[0].data || [])[0];
                if (s) setSum({
                    spend7d: s.spend7d || 0, orders7d: s.orders7d || 0,
                    cpoChung: s.cpoChung || 0, adKhongDon: s.adKhongDon || 0,
                    tienKhongDon: s.tienKhongDon || 0, adXauDi: s.adXauDi || 0,
                    tienXauDi: s.tienXauDi || 0,
                });
                setRows(res[1].data || []);
                const a = (res[2].data || [])[0];
                if (a) setAttr({ ...a, report_date: a.report_date?.value || a.report_date });
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        run();
    }, []);

    if (loading) return <TabSkeleton />;

    const pctTienKhongDon = sum.spend7d > 0 ? (sum.tienKhongDon / sum.spend7d) * 100 : 0;
    const kpis = [
        { label: "Chi 7 ngày (VND)", value: formatVNDCompact(sum.spend7d), icon: Megaphone, color: "text-blue-400" },
        { label: "Đơn 7 ngày (đã gán)", value: sum.orders7d.toLocaleString("vi-VN"), icon: TrendingUp, color: "text-emerald-400" },
        { label: "CPO chung (VND)", value: sum.cpoChung.toLocaleString("vi-VN"), icon: Target, color: "text-foreground" },
        {
            label: `Tiêu không ra đơn · ${sum.adKhongDon} QC`,
            value: formatVNDCompact(sum.tienKhongDon), icon: Ban, color: "text-rose-500",
            sub: `${pctTienKhongDon.toFixed(1)}% chi tiêu 7 ngày`,
        },
        {
            label: `Đang xấu đi · ${sum.adXauDi} QC`,
            value: formatVNDCompact(sum.tienXauDi), icon: AlertTriangle,
            color: "text-amber-600 dark:text-amber-400", sub: "chi 3 ngày của nhóm CPO tăng",
        },
        {
            label: "Độ phủ gán quảng cáo",
            value: attr ? `${attr.pct_don_gan_duoc}%` : "—", icon: Link2,
            color: "text-foreground", sub: attr ? `ngày ${attr.report_date}` : undefined,
        },
    ];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                {kpis.map((k, i) => (
                    <div key={i} className="bg-card border border-border shadow-sm rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <k.icon className={`h-4 w-4 ${k.color}`} />
                            <span className="text-xs text-muted-foreground leading-tight">{k.label}</span>
                        </div>
                        <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
                        {k.sub && <div className="text-[11px] text-muted-foreground mt-1">{k.sub}</div>}
                    </div>
                ))}
            </div>

            {attr && attr.don_ad_khong_tra_ve > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-1">
                        ⚠ {attr.don_ad_khong_tra_ve} đơn ngày {attr.report_date} có ad_id nhưng Meta không trả về quảng cáo đó
                    </h3>
                    <p className="text-xs text-muted-foreground">
                        Chiếm {attr.pct_ad_khong_tra_ve}% số đơn đã gán. Những đơn này nằm ngoài mọi phép tính
                        CPO/ROAS theo quảng cáo — con số "tiêu không ra đơn" ở trên vì thế là <b>trần trên</b>,
                        không phải lãng phí đã xác nhận. Nguyên nhân: quảng cáo bị xoá rồi tạo lại giữ id cũ,
                        hoặc TKQC nằm ngoài roster 14 tài khoản (lỗi X9).
                    </p>
                </div>
            )}

            <div className="bg-card border border-border shadow-sm rounded-xl p-4">
                <div className="flex items-baseline justify-between mb-1 gap-3 flex-wrap">
                    <h3 className="text-sm font-semibold text-foreground">🩺 Cần xử lý — xếp theo tiền đang chảy</h3>
                    <span className="text-[11px] text-muted-foreground">
                        Cửa sổ trượt 7 ngày · đã loại campaign test · không theo bộ chọn ngày
                    </span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                    Ngưỡng tự hiệu chỉnh theo CPO chung ({sum.cpoChung.toLocaleString("vi-VN")}đ):
                    tiêu ≥ 1 CPO mà 0 đơn → đỏ; CPO 3 ngày &gt; 1,5× CPO 7 ngày → đỏ; CPO 7 ngày &gt; 2× mức chung → vàng.
                </p>

                {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                        Không có quảng cáo nào vượt ngưỡng. 🎉
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                                    <th className="py-2 pr-3">Quảng cáo</th>
                                    <th className="py-2 pr-3">Chiến dịch</th>
                                    <th className="py-2 pr-3 text-right">Chi 7d</th>
                                    <th className="py-2 pr-3 text-right">Đơn</th>
                                    <th className="py-2 pr-3 text-right">CPO 7d</th>
                                    <th className="py-2 pr-3 text-right">CPO 3d</th>
                                    <th className="py-2 pr-3 text-right">Tuổi</th>
                                    <th className="py-2">Tình trạng</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const ui = STATUS_UI[r.health_status] || STATUS_UI.HEALTHY;
                                    return (
                                        <tr key={r.ad_id} className="border-b border-border/60 last:border-0">
                                            <td className="py-2 pr-3 font-medium text-foreground">
                                                {r.ad_name || r.ad_id}
                                                <span className="block text-[11px] text-muted-foreground">
                                                    {r.account_name || "—"}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-3 text-muted-foreground max-w-[220px] truncate">
                                                {r.campaign_name || "—"}
                                            </td>
                                            <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                                                {Math.round(r.spend_7d).toLocaleString("vi-VN")}
                                            </td>
                                            <td className="py-2 pr-3 text-right tabular-nums">{r.pos_orders_7d}</td>
                                            <td className="py-2 pr-3 text-right tabular-nums">
                                                {r.pos_cpo_7d ? Math.round(r.pos_cpo_7d).toLocaleString("vi-VN") : "—"}
                                            </td>
                                            <td className="py-2 pr-3 text-right tabular-nums">
                                                {r.pos_cpo_3d ? Math.round(r.pos_cpo_3d).toLocaleString("vi-VN") : "—"}
                                            </td>
                                            <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                                                {r.ad_age_days}n
                                            </td>
                                            <td className="py-2">
                                                <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${ui.cls}`}>
                                                    {ui.label}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
