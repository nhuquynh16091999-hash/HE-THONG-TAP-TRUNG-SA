"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, LogOut, Menu, Settings, X } from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { format, subDays } from "date-fns";
import DateRangePicker from "@/components/ui/date-range-picker";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import Link from "next/link";
import { AccessProvider, type Me } from "./access-context";

import TALPHACeoOverviewTab from "./tabs/ceo-overview-tab";
import TALPHAAdsCommandTab from "./tabs/ads-command-tab";
import TALPHAMarketingTab from "./tabs/marketing-tab";
import TALPHAProductsTab from "./tabs/products-tab";
import TALPHAPnLTab from "./tabs/pnl-tab";
import TALPHAProductPnLTab from "./tabs/product-pnl-tab";
import TALPHACustomerTab from "./tabs/customer-tab";
import TALPHAMarketIntelTab from "./tabs/market-intel-tab";
import TALPHAAdHealthTab from "./tabs/ad-health-tab";
import TALPHAAdSpendTab from "./tabs/ad-spend-tab";
import TALPHACodReconTab from "./tabs/cod-recon-tab";
import { MarketsProvider, useMarkets } from "./markets-context";
import TALPHAOrderLedgerTab from "./tabs/order-ledger-tab";
import TALPHATrackingTab from "./tabs/tracking-tab";
import TALPHAAdsReconTab from "./tabs/ads-recon-tab";

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
    // Đơn hàng và Đối soát GỘP một mục.
    //
    // Bản trước tách đôi vì nghĩ soát tiền là việc riêng theo kỳ. Chạy thật thì
    // hoá ra người dùng phải nhảy qua nhảy lại: nhìn thấy một đơn quá hạn ở tab
    // Đối soát rồi lại sang tab Đơn hàng tra tên khách và số điện thoại để đi
    // đòi. Cùng một đơn, hai màn hình.
    //
    // Nay Sổ đơn hàng gánh cả hai: mỗi đơn một dòng, có cả thông tin khách lẫn
    // tình trạng tiền. Hai tab cũ giữ nguyên cho việc tra cứu chuyên sâu.
    // "Danh sách đơn" đã BỎ, gộp vào Sổ đơn hàng.
    //
    // Hai tab đó chỉ khác nhau ở nguồn: tab cũ đọc POS (200 đơn, mà chỉ 5 đơn
    // có trạng thái giao đúng), Sổ đơn hàng đọc file đối tác (656 đơn, đủ vòng
    // đời tiền). Ba cột riêng của tab cũ thì: Marketer nay đã có trong Sổ,
    // Sale rỗng cho MỌI đơn vì sale_assignment chưa khai, còn Doanh thu VND
    // tính từ POS nên chỉ đúng cho 5 đơn — Sổ tính lại từ tiền 3PL trả thật.
    {
        id: "don-hang", emoji: "🧾", label: "Đơn hàng & Đối soát",
        tabs: [
            { id: "order-ledger", label: "Sổ đơn hàng" },
            { id: "cod-recon", label: "Đối soát COD" },
            { id: "tracking", label: "Theo dõi vận đơn" },
        ],
    },
    { id: "san-pham", emoji: "📦", label: "Sản phẩm", tabs: [{ id: "products", label: "Sản phẩm & Kho" }] },
    { id: "marketer", emoji: "👤", label: "Marketer", tabs: [{ id: "marketing", label: "Marketing & Ads" }] },
    {
        id: "quang-cao", emoji: "🎯", label: "Quảng cáo",
        tabs: [
            { id: "ad-spend", label: "Chi phí quảng cáo" },
            { id: "ads-command", label: "Ads Command Center" },
            { id: "ad-health", label: "Sức khoẻ quảng cáo" },
        ],
    },
    // Đối soát chi phí QC đứng RIÊNG một mục, không nhét vào "Quảng cáo".
    //
    // Hai thứ trông giống nhau nhưng trả lời hai câu khác hẳn: tab "Chi phí
    // quảng cáo" trong nhóm Quảng cáo nói TIÊU BAO NHIÊU và hiệu quả ra sao
    // (số từ Meta API); mục này nói TIỀN CÓ RA ĐÚNG SỐ KHÔNG (file thanh toán
    // TKQC đối chiếu sao kê thẻ). Gộp chung là sớm muộn có người đem số đối
    // soát đi tính ROAS, hoặc ngược lại.
    { id: "doi-soat-ads", emoji: "💳", label: "Đối soát chi phí QC", tabs: [{ id: "ads-recon", label: "Đối soát chi phí QC" }] },
    {
        id: "khach-hang", emoji: "👥", label: "Khách hàng",
        tabs: [
            { id: "customers", label: "Khách hàng" },
            { id: "market-intel", label: "Market Intel" },
        ],
    },
];

/** Hai tab này đọc cửa sổ thời gian cố định trong view — hiện bộ chọn ngày chỉ gây hiểu nhầm là lọc được. */
const IGNORES_DATE_RANGE = new Set(["ads-command", "ad-health", "ads-recon"]);

/**
 * Tab báo cáo số — không tính ngày trước mốc gốc `report_start_date` (talpha_rules.json,
 * Sỹ Anh chốt 25/09/2026: trước 15/09 dữ liệu chưa đủ). Tab vận hành (Sổ đơn, Đối soát COD,
 * Vận đơn, Kho, Khách hàng) KHÔNG chặn: đơn tháng trước vẫn còn đang chờ thu tiền.
 */
const FLOOR_TABS = new Set(["overview", "pnl", "product-pnl", "marketing", "ad-spend"]);

/** Các mục menu còn lại sau khi bỏ tab người này không được xem (phân quyền theo team). */
function nhomDuocXem(me: Me): NavGroup[] {
    const thay = new Set(me.tabs);
    return NAV_GROUPS
        .map(g => ({ ...g, tabs: g.tabs.filter(t => thay.has(t.id)) }))
        .filter(g => g.tabs.length > 0);
}

/** "2026-09-15" → 0h ngày đó theo giờ máy (new Date("2026-09-15") là 0h UTC, lệch 7 tiếng). */
function ngayDiaPhuong(s: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export default function TALPHADashboardShell() {
    const [activeGroup, setActiveGroup] = useState("bao-cao");
    const [activeTab, setActiveTab] = useState("overview");
    // Người đang xem — tab nào hiện, nút nước nào có (phân quyền theo team, 05/10/2026).
    const [me, setMe] = useState<Me | null>(null);
    const [meLoi, setMeLoi] = useState<string | null>(null);
    // Điện thoại (Sỹ Anh yêu cầu 05/10/2026): menu trái thành ngăn kéo, mở bằng nút ☰.
    const [menuMo, setMenuMo] = useState(false);
    const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
        from: subDays(new Date(), 59),
        to: new Date(),
    });
    // Mốc gốc báo cáo. Chờ nạp xong mới dựng tab, để tab không truy vấn hai lần (một lần
    // với 60 ngày mặc định, một lần sau khi kéo về mốc).
    const [reportStart, setReportStart] = useState<Date | null>(null);
    const [configLoaded, setConfigLoaded] = useState(false);

    useEffect(() => {
        document.cookie = "activeDataset=TALPHA_Dataset; path=/;";
    }, []);

    useEffect(() => {
        let dung = false;
        fetch("/api/talpha/me")
            .then(async r => {
                if (r.status === 401) { window.location.href = "/login?callbackUrl=/talpha"; return null; }
                const d = await r.json();
                if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
                return d as Me;
            })
            .then(d => {
                if (dung || !d) return;
                setMe(d);
                // Mở trang ở tab ĐẦU TIÊN người này thấy — sale không có tab Tổng quan.
                const dau = nhomDuocXem(d)[0];
                if (dau && !d.tabs.includes("overview")) { setActiveGroup(dau.id); setActiveTab(dau.tabs[0].id); }
            })
            .catch(e => { if (!dung) setMeLoi(String(e?.message || e)); });
        return () => { dung = true; };
    }, []);

    // Menu chỉ còn mục có ít nhất một tab người này được xem.
    const groups = useMemo(() => (me ? nhomDuocXem(me) : []), [me]);

    useEffect(() => {
        let dung = false;
        fetch("/api/talpha/report-config")
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((d: { report_start_date?: string | null }) => {
                if (dung) return;
                const moc = d.report_start_date ? ngayDiaPhuong(d.report_start_date) : null;
                setReportStart(moc);
                // Mở trang là thấy đúng khoảng báo cáo: từ mốc gốc tới hôm nay.
                if (moc) setDateRange(r => (r.from < moc ? { from: moc, to: r.to < moc ? moc : r.to } : r));
            })
            .catch(() => {})
            .finally(() => { if (!dung) setConfigLoaded(true); });
        return () => { dung = true; };
    }, []);

    const onFloorTab = FLOOR_TABS.has(activeTab);
    // Khoảng ngày thật đưa cho tab: tab báo cáo luôn bị kéo về mốc, kể cả khi người dùng
    // chọn 90 ngày ở tab vận hành rồi mới chuyển sang.
    const tabRange = useMemo(() => {
        if (!onFloorTab || !reportStart || dateRange.from >= reportStart) return dateRange;
        return { from: reportStart, to: dateRange.to < reportStart ? reportStart : dateRange.to };
    }, [onFloorTab, reportStart, dateRange]);

    const group = useMemo(
        () => groups.find(g => g.id === activeGroup) ?? groups[0] ?? NAV_GROUPS[0],
        [groups, activeGroup],
    );
    const duocXem = (tab: string) => !!me && me.tabs.includes(tab) && activeTab === tab;

    const selectGroup = (g: NavGroup) => {
        setActiveGroup(g.id);
        setActiveTab(g.tabs[0].id);
        setMenuMo(false);
    };

    // Ruột thanh trái — dùng chung cho cột cố định (máy tính) và ngăn kéo (điện thoại).
    const noiDungMenu = (
        <>
                <div className="flex flex-col border-b border-border p-4">
                    <div className="mb-2 flex items-center justify-between">
                        <Link href="/" className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                            <ArrowLeft className="h-3 w-3" /> Trang chủ
                        </Link>
                        <button
                            onClick={() => setMenuMo(false)}
                            className="rounded-md p-1 text-muted-foreground hover:bg-muted md:hidden"
                            aria-label="Đóng menu"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    {/* Logo ANTALO nằm trên nền kem của chính nó (brand-logo-box): chữ "LO"
                        và dải "MINI MARKET" màu đen, để trên nền tối là mất chữ. */}
                    <div className="brand-logo-box p-2.5">
                        <img src="/antalo-logo.png" alt="ANTALO Mini Market" className="h-9 w-full object-contain" />
                    </div>
                    <NhanThiTruong me={me} />
                </div>

                <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
                    {groups.map(g => (
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

                <div className="space-y-2 border-t border-border p-3">
                    {me && me.kind === "user" && (
                        <div className="rounded-lg bg-muted/40 px-3 py-2">
                            <p className="truncate text-sm font-semibold text-foreground" title={me.email || undefined}>{me.name}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                                {me.role_label}
                                {!me.full && me.teams.length > 0 && <> · {me.teams.map(t => t.name).join(" · ")}</>}
                            </p>
                            <div className="mt-1.5 flex items-center gap-3 text-xs">
                                {me.full && (
                                    <Link href="/admin" className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
                                        <Settings className="h-3 w-3" /> Quản trị
                                    </Link>
                                )}
                                <button
                                    onClick={() => signOut({ callbackUrl: "/login" })}
                                    className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    <LogOut className="h-3 w-3" /> Đăng xuất
                                </button>
                            </div>
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <img src="/antalo-mark.png" alt="" className="h-5 w-5 object-contain opacity-60" />
                        <span>ANTALO Mini Market</span>
                    </div>
                </div>
        </>
    );

    return (
        <AccessProvider value={me}>
        <MarketsProvider>
        {/* h-dvh: trên điện thoại h-screen tính cả phần bị thanh địa chỉ che, đáy trang bị cắt. */}
        <div className="flex h-dvh overflow-hidden bg-background">
            {/* ═══ Sidebar — máy tính: cột cố định ═══ */}
            <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-white shadow-sm backdrop-blur-xl dark:bg-[#131210] dark:shadow-none md:flex">
                {noiDungMenu}
            </aside>

            {/* ═══ Sidebar — điện thoại: ngăn kéo phủ lên nội dung ═══ */}
            {menuMo && (
                <div className="fixed inset-0 z-40 md:hidden">
                    <div className="absolute inset-0 bg-black/40" onClick={() => setMenuMo(false)} aria-hidden />
                    <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl dark:bg-[#131210]">
                        {noiDungMenu}
                    </aside>
                </div>
            )}

            {/* ═══ Nội dung ═══ */}
            <main className="min-w-0 flex-1 overflow-y-auto bg-background">
                <header className="sticky top-0 z-10 flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-white/80 px-3 py-2 shadow-sm backdrop-blur-xl dark:bg-[#131210]/80 dark:shadow-none md:h-16 md:flex-nowrap md:px-6 md:py-0">
                    <div className="flex min-w-0 items-center gap-2">
                        <button
                            onClick={() => setMenuMo(true)}
                            className="-ml-1 rounded-lg p-2 text-foreground hover:bg-muted md:hidden"
                            aria-label="Mở menu"
                        >
                            <Menu className="h-5 w-5" />
                        </button>
                        <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-foreground md:text-xl">
                            <span aria-hidden>{group.emoji}</span>
                            <span className="truncate">{group.label}</span>
                        </h1>
                    </div>
                    {/* ml-auto: hàng bị xuống dòng trên điện thoại thì vẫn nằm sát phải — bảng chọn
                        ngày mở neo mép phải, nằm bên trái là tràn ra ngoài màn hình. */}
                    <div className="ml-auto flex items-center gap-2 md:gap-3">
                        {onFloorTab && reportStart && (
                            <span className="hidden text-xs text-muted-foreground md:inline" title="Trước mốc này dữ liệu chưa đầy đủ nên không tính">
                                Tính từ {format(reportStart, "dd/MM/yyyy")}
                            </span>
                        )}
                        {!IGNORES_DATE_RANGE.has(activeTab) && (
                            <DateRangePicker
                                value={onFloorTab ? tabRange : dateRange}
                                onChange={setDateRange}
                                minDate={onFloorTab ? reportStart : null}
                            />
                        )}
                        <ThemeToggle />
                    </div>
                </header>

                <div className="space-y-4 p-3 md:space-y-6 md:p-6">
                    {/* Hàng pill chọn tab con — chỉ hiện khi mục có nhiều hơn một tab.
                        Điện thoại: một hàng cuộn ngang, không gãy chữ "P&L theo SP" thành ba dòng. */}
                    {group.tabs.length > 1 && (
                        <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-muted/40 p-1">
                            {group.tabs.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setActiveTab(t.id)}
                                    className={cn(
                                        "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
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

                    {meLoi && (
                        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                            Không đọc được quyền của tài khoản: {meLoi}. Tải lại trang, hoặc đăng xuất rồi đăng nhập lại.
                        </div>
                    )}
                    {me && me.tabs.length === 0 && (
                        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                            <p className="font-semibold">Tài khoản chưa được giao team nào.</p>
                            <p className="mt-1">Nhờ giám đốc vào <strong>Quản trị → Quản lý User</strong> chọn team (Trung Đông, Đông Nam Á, Đông Á) cho tài khoản này.</p>
                        </div>
                    )}

                    {!configLoaded || !me ? null : <>
                    {duocXem("overview") && <TALPHACeoOverviewTab dateRange={tabRange} projectId="TALPHA" />}
                    {duocXem("pnl") && <TALPHAPnLTab dateRange={tabRange} projectId="TALPHA" />}
                    {duocXem("product-pnl") && <TALPHAProductPnLTab dateRange={tabRange} projectId="TALPHA" />}
                    {duocXem("tracking") && <TALPHATrackingTab dateRange={dateRange} projectId="TALPHA" />}
                    {duocXem("order-ledger") && <TALPHAOrderLedgerTab dateRange={dateRange} projectId="TALPHA" />}
                    {duocXem("cod-recon") && <TALPHACodReconTab dateRange={dateRange} projectId="TALPHA" />}
                    {duocXem("products") && <TALPHAProductsTab dateRange={dateRange} projectId="TALPHA" />}
                    {duocXem("marketing") && <TALPHAMarketingTab dateRange={tabRange} projectId="TALPHA" />}
                    {duocXem("ad-spend") && <TALPHAAdSpendTab dateRange={tabRange} projectId="TALPHA" />}
                    {duocXem("ads-command") && <TALPHAAdsCommandTab />}
                    {duocXem("ad-health") && <TALPHAAdHealthTab />}
                    {duocXem("ads-recon") && <TALPHAAdsReconTab />}
                    {duocXem("customers") && <TALPHACustomerTab dateRange={dateRange} projectId="TALPHA" />}
                    {duocXem("market-intel") && <TALPHAMarketIntelTab dateRange={dateRange} projectId="TALPHA" />}
                    </>}
                </div>
            </main>
        </div>
        </MarketsProvider>
        </AccessProvider>
    );
}

/**
 * Nhãn dưới logo: nước đang bán, và nước sắp chạy nếu có — đọc từ config, không gõ tay.
 * Người xem theo team thì ghi tên team trước (danh sách nước đã chỉ còn nước của team).
 */
function NhanThiTruong({ me }: { me: Me | null }) {
    const { markets } = useMarkets();
    const dangBan = markets.filter((m) => m.status === "dang_ban").map((m) => m.display);
    const sapChay = markets.filter((m) => m.status === "sap_chay").map((m) => m.display);
    const team = me && !me.full && me.teams.length ? me.teams.map((t) => t.name).join(" · ") : null;
    return (
        <>
            <span className="mt-2 text-xs text-muted-foreground">
                {team && <strong className="font-semibold text-foreground">Team {team}: </strong>}
                {dangBan.length ? dangBan.join(" · ") : "…"}
            </span>
            {sapChay.length > 0 && (
                <span className="mt-0.5 text-[10px] text-muted-foreground">Sắp chạy: {sapChay.join(" · ")}</span>
            )}
        </>
    );
}
