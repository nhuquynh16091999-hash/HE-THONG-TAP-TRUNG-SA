"use client";

import { useState } from "react";
import { ArrowLeft, Settings, Megaphone, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

import AdAccountsTab from "@/components/tabs/ad-accounts-tab";
import UserManagementTab from "@/components/tabs/user-management-tab";

const ADMIN_TABS = [
  { id: "ad-accounts", label: "TKQC Manager", icon: Megaphone },
  { id: "users", label: "Quản lý User", icon: UsersRound },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState("ad-accounts");

  return (
    // Điện thoại (05/10/2026): cột trái thành dải trên cùng, hai mục xếp ngang.
    <div className="flex h-dvh flex-col overflow-hidden bg-background md:flex-row">
      {/* Sidebar */}
      <aside className="flex shrink-0 flex-col border-b border-border bg-card/50 backdrop-blur-xl md:w-64 md:border-b-0 md:border-r">
        <div className="flex flex-col border-b border-border p-3 md:p-4">
          <div className="flex items-center justify-between mb-2">
            <Link
              href="/"
              className="flex items-center gap-2 text-xs text-gray-400 transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Trang chủ
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-gray-400" />
            <span className="text-lg font-bold text-foreground">Quản trị</span>
          </div>
          <span className="mt-0.5 hidden text-xs text-gray-400 md:inline">
            System Administration
          </span>
        </div>
        <nav className="flex gap-1 overflow-x-auto p-2 md:block md:flex-1 md:space-y-0.5 md:overflow-y-auto md:p-3">
          {ADMIN_TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors md:w-full",
                activeTab === item.id
                  ? "bg-indigo-500/10 text-indigo-400"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 flex h-12 items-center border-b border-border bg-background/80 px-3 backdrop-blur-xl md:h-16 md:px-6">
          <h1 className="text-xl font-semibold text-foreground">
            {ADMIN_TABS.find((t) => t.id === activeTab)?.label}
          </h1>
        </header>

        <div className="p-3 md:p-6">
          {activeTab === "ad-accounts" && <AdAccountsTab />}
          {activeTab === "users" && <UserManagementTab />}
        </div>
      </main>
    </div>
  );
}
