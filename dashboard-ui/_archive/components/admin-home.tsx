"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { ArrowRight, Globe, Package, Users, Zap, Settings, BarChart3, Layers, LogOut, User, Shield, ChevronDown, LogIn } from "lucide-react";
import { ThemeToggle } from "./ui/theme-toggle";
import { useState, useRef, useEffect } from "react";

const PROJECTS = [
    {
        id: "TALPHA",
        name: "TALPHA",
        subtitle: "Tiểu Alpha — Middle East",
        route: "/talpha",
        status: "Active",
        statusBg: "bg-violet-500/15",
        statusText: "text-violet-600 dark:text-violet-400",
        statusBorder: "border-violet-400/30",
        cardBg: "bg-gradient-to-br from-violet-50 via-purple-50/80 to-white dark:from-violet-900/10 dark:via-violet-800/5 dark:to-white/[0.02]",
        cardBorder: "border-violet-200/60 dark:border-violet-500/15",
        cardHover: "hover:border-violet-300 hover:shadow-violet-100/50 dark:hover:border-violet-400/30 dark:hover:shadow-violet-500/10",
        accentColor: "text-violet-600 dark:text-violet-400",
        accentBg: "bg-violet-500",
        iconBg: "bg-violet-100 dark:bg-violet-500/15",
        statBg: "bg-violet-50 dark:bg-violet-500/10",
        markets: ["🇸🇦 Saudi", "🇦🇪 UAE", "🇰🇼 Kuwait", "🇴🇲 Oman"],
        currency: "SAR / AED / KWD / OMR",
        description: "Multi-market Middle East — jewelry, cosmetics, health. COD model with Aramex.",
        stats: [
            { label: "Markets", value: "6", icon: Globe },
            { label: "Products", value: "30+", icon: Package },
            { label: "Marketers", value: "7", icon: Users },
        ],
    },
];

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
    admin: { label: "Admin", color: "text-red-400" },
    project_lead: { label: "Project Lead", color: "text-amber-400" },
    viewer: { label: "Viewer", color: "text-slate-400" },
};

export default function AdminHome() {
    const { data: session } = useSession();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const userRole = (session?.user as any)?.role || "viewer";
    const userProjects: string[] = (session?.user as any)?.projects || [];
    const isAdmin = session ? userRole === "admin" : false;

    // Guest: hiển thị tất cả projects. Logged in: filter theo quyền
    const visibleProjects = !session ? PROJECTS : PROJECTS.filter((project) => {
        if (userProjects.includes("*")) return true;
        return userProjects.includes(project.id);
    });

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-slate-100 dark:from-[#0B0F1A] dark:via-[#0E1225] dark:to-[#0B0F1A]">
            {/* Hero Header */}
            <header className="relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 dark:from-[#0f172a] dark:via-[#1e1b4b] dark:to-[#0f172a]" />
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE4YzMuMzE0IDAgNiAyLjY4NiA2IDZzLTIuNjg2IDYtNiA2LTYtMi42ODYtNi02IDIuNjg2LTYgNi02eiIvPjwvZz48L2c+PC9zdmc+')] opacity-30" />

                <div className="relative max-w-7xl mx-auto px-8 py-10">
                    <div className="flex items-end justify-between">
                        <div>
                            <div className="flex items-center gap-4 mb-4">
                                <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-indigo-900/20 border border-white/10">
                                    <Zap className="h-6 w-6 text-white" />
                                </div>
                                <div>
                                    <h1 className="text-3xl font-extrabold text-white tracking-tight">
                                        FAOS
                                    </h1>
                                    <p className="text-xs text-indigo-200 font-medium tracking-wide">
                                        Federated Agent Operating System
                                    </p>
                                </div>
                            </div>
                            <p className="text-indigo-100/80 text-sm max-w-lg leading-relaxed">
                                Multi-project e-commerce operations platform. Chọn dự án để xem dashboard chi tiết.
                            </p>
                        </div>
                        <div className="flex items-center gap-5">
                            <ThemeToggle />
                            <div className="text-right">
                                <span className="text-[10px] text-indigo-200/70 uppercase tracking-widest block mb-0.5">Platform</span>
                                <span className="text-lg font-bold text-white">v5.0</span>
                            </div>
                            <div className="h-10 w-px bg-white/20 rounded-full" />
                            <div className="text-right">
                                <span className="text-[10px] text-indigo-200/70 uppercase tracking-widest block mb-0.5">Projects</span>
                                <span className="text-lg font-bold text-white">{visibleProjects.length} <span className="text-sm font-normal text-indigo-200">active</span></span>
                            </div>

                            {/* Guest: Nút đăng nhập */}
                            {!session?.user && (
                                <>
                                    <div className="h-10 w-px bg-white/20 rounded-full" />
                                    <Link
                                        href="/login"
                                        className="flex items-center gap-2 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 px-5 py-2.5 hover:bg-white/25 transition-all duration-200 text-white text-sm font-semibold"
                                    >
                                        <LogIn className="h-4 w-4" />
                                        Đăng nhập
                                    </Link>
                                </>
                            )}

                            {/* User Menu */}
                            {session?.user && (
                                <>
                                    <div className="h-10 w-px bg-white/20 rounded-full" />
                                    <div className="relative" ref={menuRef}>
                                        <button
                                            onClick={() => setMenuOpen(!menuOpen)}
                                            className="flex items-center gap-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 px-4 py-2 hover:bg-white/20 transition-all duration-200"
                                        >
                                            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                                                {session.user.name?.charAt(0)?.toUpperCase() || "U"}
                                            </div>
                                            <div className="text-left">
                                                <p className="text-sm font-semibold text-white leading-tight">{session.user.name}</p>
                                                <p className={`text-[10px] font-medium ${ROLE_LABELS[userRole]?.color || "text-slate-400"}`}>
                                                    {ROLE_LABELS[userRole]?.label || userRole}
                                                </p>
                                            </div>
                                            <ChevronDown className={`h-3.5 w-3.5 text-indigo-200 transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`} />
                                        </button>

                                        {/* Dropdown */}
                                        {menuOpen && (
                                            <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-white dark:bg-[#1a1f36] border border-slate-200 dark:border-white/10 shadow-xl shadow-slate-200/50 dark:shadow-black/50 py-2 z-50 animate-fade-in">
                                                <div className="px-4 py-2 border-b border-slate-100 dark:border-white/5">
                                                    <p className="text-sm font-medium text-slate-800 dark:text-white">{session.user.name}</p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">{session.user.email}</p>
                                                </div>
                                                <div className="px-4 py-2 border-b border-slate-100 dark:border-white/5">
                                                    <div className="flex items-center gap-2">
                                                        <Shield className="h-3.5 w-3.5 text-slate-400" />
                                                        <span className={`text-xs font-medium ${ROLE_LABELS[userRole]?.color || "text-slate-400"}`}>
                                                            {ROLE_LABELS[userRole]?.label || userRole}
                                                        </span>
                                                    </div>
                                                    {!isAdmin && (
                                                        <p className="text-[10px] text-slate-400 mt-1">
                                                            Truy cập: {userProjects.join(", ")}
                                                        </p>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => signOut({ callbackUrl: "/login" })}
                                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                                >
                                                    <LogOut className="h-4 w-4" />
                                                    Đăng xuất
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                {/* Bottom curve */}
                <div className="absolute -bottom-1 left-0 right-0">
                    <svg viewBox="0 0 1440 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
                        <path d="M0 40V20C240 0 480 0 720 10C960 20 1200 30 1440 20V40H0Z" className="fill-slate-50 dark:fill-[#0B0F1A]" />
                    </svg>
                </div>
            </header>

            {/* Project Cards Grid */}
            <main className="max-w-7xl mx-auto px-8 py-10">
                {visibleProjects.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="h-16 w-16 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-4">
                            <Shield className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-400">Không có dự án nào</h3>
                        <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Liên hệ Admin để được gán quyền truy cập dự án.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {visibleProjects.map((project, index) => (
                            <Link
                                key={project.id}
                                href={project.route}
                                className={`group relative overflow-hidden rounded-2xl border ${project.cardBorder} ${project.cardBg} transition-all duration-300 ${project.cardHover} hover:shadow-xl hover:-translate-y-1 animate-fade-in`}
                                style={{ animationDelay: `${index * 80}ms` }}
                            >
                                {/* Top accent bar */}
                                <div className={`h-1 w-full ${project.accentBg}`} />

                                <div className="relative p-6">
                                    {/* Header */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <div className="flex items-center gap-2.5 mb-1.5">
                                                <h2 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">
                                                    {project.name}
                                                </h2>
                                                <span className={`rounded-full border ${project.statusBorder} ${project.statusBg} ${project.statusText} px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider`}>
                                                    {project.status}
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{project.subtitle}</p>
                                        </div>
                                        <div className={`h-9 w-9 rounded-xl ${project.iconBg} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                                            <ArrowRight className={`h-4 w-4 ${project.accentColor} group-hover:translate-x-0.5 transition-transform`} />
                                        </div>
                                    </div>

                                    {/* Description */}
                                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed line-clamp-2">
                                        {project.description}
                                    </p>

                                    {/* Markets */}
                                    <div className="flex flex-wrap gap-1.5 mb-5">
                                        {project.markets.map((market) => (
                                            <span
                                                key={market}
                                                className="rounded-lg bg-white/80 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/10 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 font-medium shadow-sm dark:shadow-none"
                                            >
                                                {market}
                                            </span>
                                        ))}
                                        <span className="rounded-lg bg-slate-100 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/10 px-2.5 py-1 text-xs text-slate-400 dark:text-slate-500 font-medium">
                                            {project.currency}
                                        </span>
                                    </div>

                                    {/* Stats */}
                                    <div className={`grid grid-cols-3 gap-3 pt-4 border-t border-slate-200/60 dark:border-white/[0.06]`}>
                                        {project.stats.map((stat) => (
                                            <div key={stat.label} className={`text-center rounded-xl ${project.statBg} py-2.5 transition-colors`}>
                                                <stat.icon className={`h-3.5 w-3.5 mx-auto mb-1 ${project.accentColor} opacity-60`} />
                                                <p className={`text-lg font-bold ${project.accentColor}`}>{stat.value}</p>
                                                <p className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">
                                                    {stat.label}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}

                {/* Quick Access Row - Only show for admin */}
                {isAdmin && (
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* AI Brain Command Center */}
                        <Link
                            href="/agent-control"
                            className="group flex items-center justify-between rounded-2xl border border-cyan-200/80 dark:border-cyan-500/15 bg-gradient-to-br from-cyan-50/80 to-indigo-50/60 dark:from-cyan-900/10 dark:to-indigo-900/10 p-5 transition-all duration-300 hover:border-cyan-400 dark:hover:border-cyan-400/30 hover:shadow-lg hover:shadow-cyan-100/40 dark:hover:shadow-cyan-500/10 hover:-translate-y-0.5"
                        >
                            <div className="flex items-center gap-4">
                                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-600 flex items-center justify-center shadow-md shadow-cyan-200/50 dark:shadow-cyan-500/20">
                                    <Zap className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800 dark:text-white">🧠 AI Brain</h3>
                                    <p className="text-xs text-slate-400 mt-0.5">Health • Live Feed • Audit • Memory • Sync</p>
                                </div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-cyan-500 group-hover:translate-x-0.5 transition-all" />
                        </Link>

                        {/* Admin Panel Link */}
                        <Link
                            href="/admin"
                            className="group flex items-center justify-between rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-white/[0.03] p-5 transition-all duration-300 hover:border-indigo-300 dark:hover:border-indigo-400/30 hover:shadow-lg hover:shadow-indigo-100/40 dark:hover:shadow-indigo-500/10"
                        >
                            <div className="flex items-center gap-4">
                                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-200/50 dark:shadow-indigo-500/20">
                                    <Settings className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800 dark:text-white">Quản trị hệ thống</h3>
                                    <p className="text-xs text-slate-400 mt-0.5">Token Cost • Trợ lý AI • Config</p>
                                </div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
                        </Link>

                        {/* Data Sync Link */}
                        <Link
                            href="/agent-control/sync"
                            className="group flex items-center justify-between rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-white/[0.03] p-5 transition-all duration-300 hover:border-emerald-300 dark:hover:border-emerald-400/30 hover:shadow-lg hover:shadow-emerald-100/40 dark:hover:shadow-emerald-500/10"
                        >
                            <div className="flex items-center gap-4">
                                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md shadow-emerald-200/50 dark:shadow-emerald-500/20">
                                    <BarChart3 className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800 dark:text-white">Data Sync</h3>
                                    <p className="text-xs text-slate-400 mt-0.5">POS • Meta Ads • BigQuery Pipeline</p>
                                </div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-emerald-500 group-hover:translate-x-0.5 transition-all" />
                        </Link>
                    </div>
                )}

                {/* Footer */}
                <div className="mt-12 text-center pb-8">
                    <div className="flex items-center justify-center gap-2 text-slate-300 dark:text-slate-600">
                        <Layers className="h-3.5 w-3.5" />
                        <span className="text-xs font-medium tracking-wide">FAOS Platform v5.0</span>
                    </div>
                </div>
            </main>
        </div>
    );
}
