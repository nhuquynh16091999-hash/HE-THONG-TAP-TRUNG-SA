"use client";

import { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "../utils";

/**
 * KpiTile — ô KPI gọn của AUUS1: emoji + nhãn, số to tabular-nums, một dòng phụ.
 *
 * Khác KPICard cũ ở ba điểm: số dùng tabular-nums (cột số không nhảy khi đổi kỳ),
 * nhãn mang emoji thay cho icon Lucide, và có slot `legend` cho dải chú giải đèn.
 */

export type KpiTone = "neutral" | "good" | "warn" | "bad";

const TONE: Record<KpiTone, string> = {
    neutral: "text-foreground",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-rose-600 dark:text-rose-400",
};

interface Props {
    /** Emoji đứng trước nhãn, vd "💰" */
    emoji?: string;
    label: string;
    value: ReactNode;
    /** Dòng phụ nhỏ dưới số, vd "Chốt: 247" */
    sub?: ReactNode;
    /** Giải thích cách tính — hiện khi rê chuột vào icon ⓘ */
    tooltip?: string;
    tone?: KpiTone;
    /** Dải chú giải, thường là <LightLegend /> */
    legend?: ReactNode;
    onClick?: () => void;
    className?: string;
}

export function KpiTile({ emoji, label, value, sub, tooltip, tone = "neutral", legend, onClick, className }: Props) {
    return (
        <div
            onClick={onClick}
            className={cn(
                "kpi-card flex flex-col justify-between",
                tooltip && "group/kpi relative",
                onClick && "cursor-pointer",
                className,
            )}
        >
            <div className="flex items-start justify-between gap-1">
                <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    {emoji && <span aria-hidden>{emoji}</span>}
                    {label}
                </span>
                {tooltip && <Info className="mt-0.5 h-3 w-3 shrink-0 cursor-help text-muted-foreground/60" aria-label={tooltip} />}
            </div>

            {tooltip && (
                <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-md border border-border bg-popover p-2.5 text-xs leading-relaxed text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover/kpi:opacity-100">
                    {tooltip}
                </div>
            )}

            <div className="mt-2 space-y-1">
                <div className={cn("text-2xl font-bold tracking-tight tabular-nums", TONE[tone])}>{value}</div>
                {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
                {legend && <div className="pt-0.5">{legend}</div>}
            </div>
        </div>
    );
}

/** Hàng KPI 6 cột — cùng breakpoint với AUUS1. */
export function KpiRow({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6", className)}>
            {children}
        </div>
    );
}

export default KpiTile;
