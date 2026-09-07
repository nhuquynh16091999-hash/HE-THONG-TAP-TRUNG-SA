"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import {
    ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
    CartesianGrid, Tooltip,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatVNDCompact, formatNumber, cn } from "../utils";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

type Daily = { date: string; spend_vnd: number; messages: number; clicks: number; impressions: number };
type MarketerRow = {
    key: string; marketer: string; spend_vnd: number; messages: number;
    clicks: number; impressions: number; campaigns: number; cost_per_message: number | null;
};
type Account = { account_id: string; account_name: string; spend_vnd: number; messages: number };
type Audience = {
    key: string; audience: string; spend_vnd: number; messages: number;
    clicks: number; campaigns: number; cost_per_message: number | null;
};
type Product = {
    code: string; name: string | null; cost_declared: boolean;
    spend_vnd: number; messages: number; campaigns: number; cost_per_message: number | null;
};
type Campaign = {
    campaign_name: string; account_name: string; marketer: string | null;
    audience: string | null;
    product_code: string | null;
    is_test: boolean; spend_vnd: number; clicks: number; impressions: number; messages: number;
};
type Totals = {
    spend_vnd: number; messages: number; clicks: number; impressions: number;
    test_spend_vnd: number; test_campaigns: number;
    unattributed_spend_vnd: number; unattributed_samples: string[];
    product_unknown_spend_vnd?: number; product_no_cost_spend_vnd?: number;
};

export default function TALPHAAdSpendTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [daily, setDaily] = useState<Daily[]>([]);
    const [marketers, setMarketers] = useState<MarketerRow[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [audiences, setAudiences] = useState<Audience[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [totals, setTotals] = useState<Totals | null>(null);
    const [showTest, setShowTest] = useState(false);

    const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2026-01-01";
    const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const res = await fetch(`/api/talpha/ad-spend?from=${from}&to=${to}`);
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || "Không tải được chi phí quảng cáo");
            setDaily(d.daily || []); setMarketers(d.marketers || []);
            setAccounts(d.accounts || []); setCampaigns(d.campaigns || []);
            setAudiences(d.audiences || []);
            setProducts(d.products || []);
            setTotals(d.totals);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [from, to]);

    useEffect(() => { load(); }, [load]);

    if (loading) return <TabSkeleton cards={4} rows={6} />;
    if (error) return <ErrorState message={error} onRetry={load} />;
    if (!totals) return null;

    const days = Math.max(daily.length, 1);
    const cpm = totals.messages > 0 ? totals.spend_vnd / totals.messages : null;
    const shown = campaigns.filter((c) => showTest || !c.is_test);

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Tổng chi quảng cáo" value={formatVNDCompact(totals.spend_vnd)}
                    sub={`${days} ngày · trung bình ${formatVNDCompact(totals.spend_vnd / days)}/ngày`} />
                <Stat label="Tin nhắn" value={formatNumber(totals.messages)}
                    sub={cpm ? `${formatVNDCompact(cpm)}/tin` : "chưa có tin nhắn"} />
                <Stat label="Click" value={formatNumber(totals.clicks)}
                    sub={`${formatNumber(totals.impressions)} lượt hiển thị`} />
                <Stat label="Chi cho campaign test" value={formatVNDCompact(totals.test_spend_vnd)}
                    sub={`${totals.test_campaigns} campaign — tách khỏi doanh số`} tone="warn" />
            </div>

            {totals.unattributed_spend_vnd > 0 && (
                <div className="flex gap-3 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4 dark:bg-amber-500/10">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-400" />
                    <div className="text-sm">
                        <div className="font-medium text-amber-900 dark:text-amber-200">
                            {formatVNDCompact(totals.unattributed_spend_vnd)} chưa nhận ra chủ campaign
                        </div>
                        <p className="mt-1 text-amber-800/80 dark:text-amber-200/70">
                            Tên campaign không theo chuẩn <span className="font-mono">MARKETER/TỆPKHÁCH/SANPHAM/TRANG/NGAY</span> nên
                            không gán được về ai. Tiền vẫn đã tiêu — đặt lại tên theo chuẩn thì số tự về đúng người.
                        </p>
                        {totals.unattributed_samples.length > 0 && (
                            <ul className="mt-2 space-y-0.5 font-mono text-xs text-amber-800/70 dark:text-amber-200/60">
                                {totals.unattributed_samples.slice(0, 5).map((n) => <li key={n} className="truncate">{n}</li>)}
                            </ul>
                        )}
                    </div>
                </div>
            )}

            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold">Chi tiêu theo ngày (VND)</h3>
                <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={daily}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" />
                        <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={formatVNDCompact}
                            stroke="currentColor" className="text-muted-foreground" />
                        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }}
                            stroke="currentColor" className="text-muted-foreground" />
                        <Tooltip
                            contentStyle={{ background: "var(--tooltip-bg, #fff)", border: "1px solid #ddd", borderRadius: 8, fontSize: 12 }}
                            formatter={(v: number, n: string) => n === "Chi tiêu" ? formatVNDCompact(v) : formatNumber(v)} />
                        <Bar yAxisId="l" dataKey="spend_vnd" name="Chi tiêu" fill="#f97316" radius={[3, 3, 0, 0]} />
                        <Line yAxisId="r" dataKey="messages" name="Tin nhắn" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {audiences.length > 0 && (
                <Panel title="Theo tệp khách — cùng một thị trường Đài Loan">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                <th className="py-2 text-left font-medium">Tệp khách</th>
                                <th className="py-2 text-right font-medium">Chi tiêu</th>
                                <th className="py-2 text-right font-medium">Phần ngân sách</th>
                                <th className="py-2 text-right font-medium">Tin nhắn</th>
                                <th className="py-2 text-right font-medium">Giá mỗi tin</th>
                            </tr>
                        </thead>
                        <tbody>
                            {audiences.map((a) => {
                                const share = totals.spend_vnd > 0 ? a.spend_vnd / totals.spend_vnd : 0;
                                // Rẻ nhất bảng — chỗ đáng dồn thêm ngân sách.
                                const cheapest = a.cost_per_message !== null && a.cost_per_message ===
                                    Math.min(...audiences.filter((x) => x.cost_per_message !== null)
                                        .map((x) => x.cost_per_message as number));
                                return (
                                    <tr key={a.key} className="border-b border-border/40 last:border-0">
                                        <td className="py-2 font-medium">{a.audience}</td>
                                        <td className="py-2 text-right font-mono tabular-nums">{formatVNDCompact(a.spend_vnd)}</td>
                                        <td className="py-2 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <span className="h-1.5 w-16 overflow-hidden rounded-sm bg-muted">
                                                    <span className="block h-full rounded-sm bg-orange-500"
                                                        style={{ width: `${Math.round(share * 100)}%` }} />
                                                </span>
                                                <span className="w-10 text-right tabular-nums text-muted-foreground">
                                                    {(share * 100).toFixed(1)}%
                                                </span>
                                            </div>
                                        </td>
                                        <td className="py-2 text-right tabular-nums">{formatNumber(a.messages)}</td>
                                        <td className={cn("py-2 text-right font-mono tabular-nums",
                                            cheapest && "font-semibold text-emerald-600 dark:text-emerald-400")}>
                                            {a.cost_per_message ? formatVNDCompact(a.cost_per_message) : "—"}
                                            {cheapest && <span className="ml-1 text-[10px] font-normal">rẻ nhất</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="mt-2 text-xs text-muted-foreground">
                        Đây là các cộng đồng đang sống <b>tại Đài Loan</b> mà quảng cáo nhắm tới, không phải thị trường khác —
                        hàng vẫn giao ở Đài, vẫn thu TWD. Tệp có giá mỗi tin rẻ nhất là chỗ đáng cân nhắc dồn thêm ngân sách.
                    </p>
                </Panel>
            )}

            {products.length > 0 && (
                <Panel title="Theo mã sản phẩm">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                <th className="py-2 text-left font-medium">Mã</th>
                                <th className="py-2 text-left font-medium">Sản phẩm</th>
                                <th className="py-2 text-right font-medium">Chi tiêu</th>
                                <th className="py-2 text-right font-medium">Tin nhắn</th>
                                <th className="py-2 text-right font-medium">Giá mỗi tin</th>
                            </tr>
                        </thead>
                        <tbody>
                            {products.map((p) => (
                                <tr key={p.code} className="border-b border-border/40 last:border-0">
                                    <td className="py-2 font-mono">{p.code}</td>
                                    <td className={cn("py-2", !p.cost_declared && "text-amber-600 dark:text-amber-400")}>
                                        {p.name || (
                                            <span title="Chưa khai giá vốn — lãi gộp của mã này sẽ ảo cao">
                                                ⚠ chưa khai giá vốn
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-2 text-right font-mono tabular-nums">{formatVNDCompact(p.spend_vnd)}</td>
                                    <td className="py-2 text-right tabular-nums">{formatNumber(p.messages)}</td>
                                    <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
                                        {p.cost_per_message ? formatVNDCompact(p.cost_per_message) : "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {(totals.product_no_cost_spend_vnd || totals.product_unknown_spend_vnd) ? (
                        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                            {totals.product_no_cost_spend_vnd ? (
                                <>{formatVNDCompact(totals.product_no_cost_spend_vnd)} chạy vào mã <b>chưa khai giá vốn</b> — lãi gộp của phần này ảo cao. </>
                            ) : null}
                            {totals.product_unknown_spend_vnd ? (
                                <>{formatVNDCompact(totals.product_unknown_spend_vnd)} ở campaign <b>không ghi mã sản phẩm</b> — đặt tên theo chuẩn thì số tự về đúng mã.</>
                            ) : null}
                        </p>
                    ) : null}
                </Panel>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Theo marketer">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                <th className="py-2 text-left font-medium">Marketer</th>
                                <th className="py-2 text-right font-medium">Chi tiêu</th>
                                <th className="py-2 text-right font-medium">Tin nhắn</th>
                                <th className="py-2 text-right font-medium">Giá/tin</th>
                                <th className="py-2 text-right font-medium">Camp</th>
                            </tr>
                        </thead>
                        <tbody>
                            {marketers.map((m) => (
                                <tr key={m.key} className="border-b border-border/40 last:border-0">
                                    <td className="py-2 font-medium">{m.marketer}</td>
                                    <td className="py-2 text-right font-mono tabular-nums">{formatVNDCompact(m.spend_vnd)}</td>
                                    <td className="py-2 text-right tabular-nums">{formatNumber(m.messages)}</td>
                                    <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
                                        {m.cost_per_message ? formatVNDCompact(m.cost_per_message) : "—"}
                                    </td>
                                    <td className="py-2 text-right tabular-nums text-muted-foreground">{m.campaigns}</td>
                                </tr>
                            ))}
                            {!marketers.length && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Chưa có chi tiêu nào gán được về marketer.</td></tr>}
                        </tbody>
                    </table>
                </Panel>

                <Panel title="Theo tài khoản quảng cáo">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                <th className="py-2 text-left font-medium">Tài khoản</th>
                                <th className="py-2 text-right font-medium">Chi tiêu</th>
                                <th className="py-2 text-right font-medium">Tin nhắn</th>
                            </tr>
                        </thead>
                        <tbody>
                            {accounts.map((a) => (
                                <tr key={a.account_id} className="border-b border-border/40 last:border-0">
                                    <td className="py-2">
                                        <div className="max-w-[220px] truncate">{a.account_name}</div>
                                        <div className="font-mono text-[11px] text-muted-foreground">act_{a.account_id}</div>
                                    </td>
                                    <td className="py-2 text-right font-mono tabular-nums">{formatVNDCompact(a.spend_vnd)}</td>
                                    <td className="py-2 text-right tabular-nums">{formatNumber(a.messages)}</td>
                                </tr>
                            ))}
                            {!accounts.length && <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">Không có tài khoản nào phát sinh chi tiêu.</td></tr>}
                        </tbody>
                    </table>
                </Panel>
            </div>

            <div className="rounded-xl border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h3 className="text-sm font-semibold">Chi tiết theo campaign</h3>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                        <input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} />
                        Hiện cả campaign test
                    </label>
                </div>
                <div className="max-h-[420px] overflow-auto">
                    <table className="w-full min-w-[760px] text-sm">
                        <thead className="sticky top-0 bg-card">
                            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                <th className="px-4 py-2 text-left font-medium">Campaign</th>
                                <th className="px-4 py-2 text-left font-medium">Marketer</th>
                                <th className="px-4 py-2 text-left font-medium">Tệp</th>
                                <th className="px-4 py-2 text-right font-medium">Chi tiêu</th>
                                <th className="px-4 py-2 text-right font-medium">Click</th>
                                <th className="px-4 py-2 text-right font-medium">Tin nhắn</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map((c) => (
                                <tr key={c.campaign_name} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                                    <td className="px-4 py-2">
                                        <div className="max-w-[380px] truncate" title={c.campaign_name}>{c.campaign_name}</div>
                                        <div className="text-[11px] text-muted-foreground">{c.account_name}</div>
                                    </td>
                                    <td className={cn("px-4 py-2", !c.marketer && "text-muted-foreground")}>
                                        {c.marketer || "chưa nhận ra"}
                                        {c.is_test && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">test</span>}
                                    </td>
                                    <td className={cn("px-4 py-2 text-xs", !c.audience && "text-muted-foreground")}>{c.audience || "—"}</td>
                                    <td className="px-4 py-2 text-right font-mono tabular-nums">{formatVNDCompact(c.spend_vnd)}</td>
                                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber(c.clicks)}</td>
                                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber(c.messages)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <p className="text-xs text-muted-foreground">
                Chi tiêu lấy từ <span className="font-mono">fb_ads_data</span>, cột <span className="font-mono">date</span> theo múi giờ
                của từng tài khoản quảng cáo. Số Meta trả về <b>đã là VND</b> — không quy đổi thêm lần nào.
            </p>
        </div>
    );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" }) {
    return (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums",
                tone === "warn" && "text-amber-600 dark:text-amber-400")}>{value}</div>
            {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
    );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold">{title}</h3>
            <div className="overflow-x-auto">{children}</div>
        </div>
    );
}
