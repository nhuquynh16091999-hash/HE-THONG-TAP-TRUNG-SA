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
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card/50 backdrop-blur-xl flex flex-col">
        <div className="flex flex-col border-b border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <Link
              href="/"
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-xs"
            >
              <ArrowLeft className="h-3 w-3" /> Trang chủ
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-gray-400" />
            <span className="text-lg font-bold text-white">Quản trị</span>
          </div>
          <span className="text-xs text-gray-400 mt-0.5">
            System Administration
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {ADMIN_TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                activeTab === item.id
                  ? "bg-indigo-500/10 text-indigo-400"
                  : "text-muted-foreground hover:bg-white/5 hover:text-white",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 flex h-16 items-center border-b border-border bg-background/80 px-6 backdrop-blur-xl">
          <h1 className="text-xl font-semibold text-white">
            {ADMIN_TABS.find((t) => t.id === activeTab)?.label}
          </h1>
        </header>

        <div className="p-6">
          {activeTab === "ad-accounts" && <AdAccountsTab />}
          {activeTab === "users" && <UserManagementTab />}
        </div>
      </main>
    </div>
  );
}
