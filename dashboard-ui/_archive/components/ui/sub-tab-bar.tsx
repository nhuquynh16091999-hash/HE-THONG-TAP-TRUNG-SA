"use client";

import { cn } from "@/lib/utils";

interface SubTab {
    id: string;
    label: string;
    icon?: React.ReactNode;
}

interface SubTabBarProps {
    tabs: SubTab[];
    active: string;
    onChange: (id: string) => void;
}

export function SubTabBar({ tabs, active, onChange }: SubTabBarProps) {
    return (
        <div className="flex gap-1 mb-6 p-1 bg-card dark:bg-white/[0.03] rounded-lg border border-border/50 dark:border-white/[0.06] w-fit">
            {tabs.map((t) => (
                <button
                    key={t.id}
                    onClick={() => onChange(t.id)}
                    className={cn(
                        "flex items-center gap-2 px-4 py-1.5 text-sm rounded-md transition-all",
                        active === t.id
                            ? "bg-gradient-to-r from-orange-500/20 to-red-500/20 text-orange-600 dark:text-orange-400 font-medium shadow-sm"
                            : "text-muted-foreground hover:text-foreground hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                    )}
                >
                    {t.icon}
                    {t.label}
                </button>
            ))}
        </div>
    );
}
