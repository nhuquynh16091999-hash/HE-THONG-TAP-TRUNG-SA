"use client";

import { cn } from "../utils";

/**
 * Đèn 🟢🟡🔴 — quy ước đọc nhanh của AUUS1, áp cho ads% (chi phí ads trên doanh số).
 *
 * ⚠️ Ngưỡng ở đây CHỈ để tô màu, không phải nguồn rule. Ngưỡng nghiệp vụ nằm trong
 * config/talpha_rules.json (thresholds.*); truyền vào qua props nếu tab nào cần khác.
 */

export const ADS_PCT_GOOD = 40;
export const ADS_PCT_WARN = 55;

export type Light = "good" | "warn" | "bad";

/** ads% càng thấp càng tốt. */
export function lightForAdsPct(pct: number | null | undefined, good = ADS_PCT_GOOD, warn = ADS_PCT_WARN): Light {
    if (pct === null || pct === undefined || !isFinite(pct)) return "bad";
    if (pct < good) return "good";
    if (pct <= warn) return "warn";
    return "bad";
}

/** Chỉ số càng cao càng tốt (ROAS, biên lãi…). */
export function lightForHigher(value: number | null | undefined, good: number, warn: number): Light {
    if (value === null || value === undefined || !isFinite(value)) return "bad";
    if (value >= good) return "good";
    if (value >= warn) return "warn";
    return "bad";
}

const EMOJI: Record<Light, string> = { good: "🟢", warn: "🟡", bad: "🔴" };
const DOT: Record<Light, string> = {
    good: "bg-emerald-500",
    warn: "bg-amber-400",
    bad: "bg-rose-500",
};

export function LightDot({ light, className }: { light: Light; className?: string }) {
    return <span className={cn("inline-block h-2 w-2 rounded-full", DOT[light], className)} />;
}

export function LightEmoji({ light }: { light: Light }) {
    return <span aria-label={light}>{EMOJI[light]}</span>;
}

/** Dải chú giải đặt dưới ô KPI ads%. */
export function LightLegend({ good = ADS_PCT_GOOD, warn = ADS_PCT_WARN }: { good?: number; warn?: number }) {
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><LightDot light="good" />&lt;{good}</span>
            <span className="flex items-center gap-1"><LightDot light="warn" />{good}–{warn}</span>
            <span className="flex items-center gap-1"><LightDot light="bad" />&gt;{warn}</span>
        </div>
    );
}
