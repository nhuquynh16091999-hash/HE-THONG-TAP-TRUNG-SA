"use client";

import { ReactNode } from "react";
import { cn } from "../utils";

/**
 * ResultCard — khối "kết quả kỳ" của AUUS1: một con số khổng lồ bên phải, dòng
 * cảnh báo phạm vi bên trái, thanh gradient chia đoạn theo cơ cấu chi phí, và
 * 3 ô con giải thích các chỉ số đi kèm.
 *
 * Con số to phải luôn đi kèm `note` nói rõ nó CHƯA trừ gì — đây là điểm AUUS1
 * làm rất kỹ ("đây là lãi sau quảng cáo, không phải lãi cuối cùng").
 */

export interface BarSegment {
    /** class nền, vd "bg-rose-400" */
    color: string;
    value: number;
    label?: string;
}

export interface SubStat {
    label: string;
    value: ReactNode;
    hint?: ReactNode;
}

interface Props {
    emoji?: string;
    title: string;
    /** Ghi rõ con số này chưa trừ những gì. */
    note?: ReactNode;
    value: ReactNode;
    /** Dòng nhỏ dưới con số to, vd "biên lãi 10.9% trên doanh thu" */
    caption?: ReactNode;
    tone?: "good" | "bad" | "neutral";
    segments?: BarSegment[];
    subStats?: SubStat[];
    children?: ReactNode;
    className?: string;
}

const TONE = {
    good: "text-emerald-600 dark:text-emerald-400",
    bad: "text-rose-600 dark:text-rose-400",
    neutral: "text-foreground",
};

export function ResultCard({
    emoji, title, note, value, caption, tone = "neutral", segments, subStats, children, className,
}: Props) {
    const total = segments?.reduce((s, x) => s + Math.max(0, x.value), 0) ?? 0;

    return (
        <section className={cn("rounded-xl border border-border bg-card p-5 shadow-sm", className)}>
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-xl">
                    <h3 className="section-header mb-0">
                        {emoji && <span aria-hidden>{emoji}</span>}
                        {title}
                    </h3>
                    {note && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p>}
                </div>
                <div className="text-right">
                    <div className={cn("text-3xl font-bold tabular-nums tracking-tight", TONE[tone])}>{value}</div>
                    {caption && <div className="mt-0.5 text-xs text-muted-foreground">{caption}</div>}
                </div>
            </div>

            {segments && total > 0 && (
                <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted" role="img"
                    aria-label={segments.map(s => s.label).filter(Boolean).join(", ")}>
                    {segments.filter(s => s.value > 0).map((s, i) => (
                        <div key={i} className={s.color} title={s.label}
                            style={{ width: `${(s.value / total) * 100}%` }} />
                    ))}
                </div>
            )}

            {subStats && subStats.length > 0 && (
                <div className="mt-4 grid gap-px overflow-hidden rounded-lg bg-muted/30 sm:grid-cols-2 lg:grid-cols-3">
                    {subStats.map((s, i) => (
                        <div key={i} className="p-4">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                                {s.label}
                            </div>
                            <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground">
                                {s.value}
                            </div>
                            {s.hint && (
                                <div className="mt-1 text-[11px] leading-snug text-muted-foreground/80">{s.hint}</div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {children}
        </section>
    );
}

export default ResultCard;
