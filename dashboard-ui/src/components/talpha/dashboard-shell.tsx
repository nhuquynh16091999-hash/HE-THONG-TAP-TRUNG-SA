"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { subDays } from "date-fns";
import DateRangePicker from "@/components/ui/date-range-picker";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import Link from "next/link";

import TALPHACeoOverviewTab from "./tabs/ceo-overview-tab";
import TALPHAAdsCommandTab from "./tabs/ads-command-tab";
import TALPHAMarketingTab from "./tabs/marketing-tab";
import TALPHAProductsTab from "./tabs/products-tab";
import TALPHAPnLTab from "./tabs/pnl-tab";
import TALPHAProductPnLTab from "./tabs/product-pnl-tab";
import TALPHACustomerTab from "./tabs/customer-tab";
import TALPHAMarketIntelTab from "./tabs/market-intel-tab";
import TALPHAAdHealthTab from "./tabs/ad-health-tab";

/**
 * Điều hướng gom về 5 mục theo đúng cấu trúc AUUS1 (Báo cáo · Sản phẩm ·
 * Marketer · Quảng cáo · Khách hàng). 9 tab cũ không mất tab nào — tab nào cùng
 * chủ đề thì nằm chung một mục và chọn bằng hàng pill ở đầu vùng nội dung.
 */
interface NavTab { id: string; label: string }
interface NavGroup { id: string; emoji: string; label: string; tabs: NavTab[] }

const NAV_GROUPS: NavGroup[] = [
    {
        id: "bao-cao", emoji: "📋", label: "Báo cáo",
        tabs: [
            { id: "overview", label: "Tổng quan" },
            { id: "pnl", label: "P&L" },
            { id: "product-pnl", label: "P&L theo SP" },
        ],
    },
    { id: "san-pham", emoji: "📦", label: "Sản phẩm", tabs: [{ id: "products", label: "Sản phẩm & Kho" }] },
    { id: "marketer", emoji: "👤", label: "Marketer", tabs: [{ id: "marketing", label: "Marketing & Ads" }] },
    {
        id: "quang-cao", emoji: "🎯", label: "Quảng cáo",
        tabs: [
            { id: "ads-command", label: "Ads Command Center" },
            { id: "ad-health", label: "Sức khoẻ quảng cáo" },
        ],
    },
    {
        id: "khach-hang", emoji: "👥", label: "Khách hàng",
        tabs: [
            { id: "customers", label: "Khách hàng" },
            { id: "market-intel", label: "Market Intel" },
        ],
    },
];

/** Hai tab này đọc cửa sổ thời gian cố định trong view — hiện bộ chọn ngày chỉ gây hiểu nhầm là lọc được. */
const IGNORES_DATE_RANGE = new Set(["ads-command", "ad-health"]);

export default function TALPHADashboardShell() {
    const [activeGroup, setActiveGroup] = useState("bao-cao");
    const [activeTab, setActiveTab] = useState("overview");
    const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
        from: subDays(new Date(), 59),
        to: new Date(),
    });

    useEffect(() => {
        document.cookie = "activeDataset=TALPHA_Dataset; path=/;";
    }, []);

    const group = useMemo(
        () => NAV_GROUPS.find(g => g.id === activeGroup) ?? NAV_GROUPS[0],
        [activeGroup],
    );

    const selectGroup = (g: NavGroup) => {
        setActiveGroup(g.id);
        setActiveTab(g.tabs[0].id);
    };

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* ═══ Sidebar ═══ */}
            <aside className="flex w-64 flex-col border-r border-border bg-white shadow-sm backdrop-blur-xl dark:bg-[#0d1117] dark:shadow-none">
                <div className="flex flex-col border-b border-border p-4">
                    <div className="mb-2 flex items-center justify-between">
                        <Link href="/" className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                            <ArrowLeft className="h-3 w-3" /> Trang chủ
                        </Link>
                    </div>
                    <div className="flex items-center gap-3">
                        <img src="/logo.png" alt="Level Up" className="h-10 w-10 object-contain" />
                        <div>
                            <span className="text-lg font-bold brand-gradient-text">TALPHA</span>
                            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">Active</span>
                        </div>
                    </div>
                    <span className="ml-[52px] mt-1 text-xs text-muted-foreground">Tiểu Alpha — Middle East</span>
                    <span className="ml-[52px] mt-0.5 text-[10px] text-muted-foreground">🇸🇦 🇦🇪 🇰🇼 🇴🇲 🇶🇦 🇧🇭</span>
                </div>

                <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
                    {NAV_GROUPS.map(g => (
                        <button
                            key={g.id}
                            onClick={() => selectGroup(g)}
                            className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                                activeGroup === g.id
                                    ? "border border-orange-200/60 bg-gradient-to-r from-orange-50 to-red-50 text-orange-700 shadow-sm dark:border-orange-500/20 dark:from-orange-500/10 dark:to-red-500/10 dark:text-orange-400"
                                    : "text-muted-foreground hover:bg-gray-50 hover:text-foreground dark:hover:bg-white/[0.04]",
                            )}
                        >
                            <span aria-hidden>{g.emoji}</span>
                            {g.label}
                        </button>
                    ))}
                </nav>

                <div className="border-t border-border p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <img src="/logo.png" alt="" className="h-5 w-5 opacity-40" />
                        <span>Level Up Analytics</span>
                    </div>
                </div>
            </aside>

            {/* ═══ Nội dung ═══ */}
            <main className="flex-1 overflow-y-auto bg-background">
                <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-white/80 px-6 shadow-sm backdrop-blur-xl dark:bg-[#0d1117]/80 dark:shadow-none">
                    <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
                        <span aria-hidden>{group.emoji}</span>
                        {group.label}
                    </h1>
                    <div className="flex items-center gap-3">
                        {!IGNORES_DATE_RANGE.has(activeTab) && (
                            <DateRangePicker value={dateRange} onChange={setDateRange} />
                        )}
                        <ThemeToggle />
                    </div>
                </header>

                <div className="space-y-6 p-6">
                    {/* Hàng pill chọn tab con — chỉ hiện khi mục có nhiều hơn một tab */}
                    {group.tabs.length > 1 && (
                        <div className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1">
                            {group.tabs.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setActiveTab(t.id)}
                                    className={cn(
                                        "rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                                        activeTab === t.id
                                            ? "bg-card text-foreground shadow-sm"
                                            : "text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {activeTab === "overview" && <TALPHACeoOverviewTab dateRange={dateRange} projectId="TALPHA" />}
                    {activeTab === "pnl" && <TALPHAPnLTab dateRange={dateRange} projectId="TALPHA" />}
                    {activeTab === "product-pnl" && <TALPHAProductPnLTab dateRange={dateRange} projectId="TALPHA" />}
                    {activeTab === "products" && <TALPHAProductsTab dateRange={dateRange} projectId="TALPHA" />}
                    {activeTab === "marketing" && <TALPHAMarketingTab dateRange={dateRange} projectId="TALPHA" />}
                    {activeTab === "ads-command" && <TALPHAAdsCommandTab />}
                    {activeTab === "ad-health" && <TALPHAAdHealthTab />}
                    {activeTab === "customers" && <TALPHACustomerTab dateRange={dateRange} projectId="TALPHA" />}
                    {activeTab === "market-intel" && <TALPHAMarketIntelTab dateRange={dateRange} projectId="TALPHA" />}
                </div>
            </main>
        </div>
    );
}
