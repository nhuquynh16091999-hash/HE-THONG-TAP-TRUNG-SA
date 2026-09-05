"use client";

import { ReactNode } from "react";
import { cn } from "../utils";

/**
 * BarStrip — dải cột bằng div CSS (không recharts) theo kiểu AUUS1.
 *
 * Hai tầng: tầng trên là doanh thu, tầng dưới (qua đường kẻ) là lãi/lỗ. Cột của
 * kỳ ĐANG CHẠY được làm mờ + gạch chéo vì tháng chưa hết thì số luôn thấp giả —
 * đây là điểm hay nhất của AUUS1: không giấu kỳ dở dang, chỉ đánh dấu nó.
 */

export interface BarItem {
    label: string;
    /** Cột trên — thường là doanh thu. */
    top: number;
    /** Cột dưới — lãi (>0) hoặc lỗ (<0). Bỏ trống nếu chỉ vẽ một tầng. */
    bottom?: number;
    /** Kỳ chưa kết thúc → mờ + gạch chéo. */
    inProgress?: boolean;
    /** Nội dung tooltip. */
    title?: string;
}

const HATCH = "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,.55) 3px, rgba(255,255,255,.55) 6px)";

interface Props {
    items: BarItem[];
    onSelect?: (item: BarItem, index: number) => void;
    selectedIndex?: number;
    /** Chú thích dưới dải cột. */
    legend?: { color: string; label: string }[];
    /** Dòng giải thích cách đọc — AUUS1 luôn có. */
    hint?: ReactNode;
    className?: string;
}

export function BarStrip({ items, onSelect, selectedIndex, legend, hint, className }: Props) {
    const maxTop = Math.max(1, ...items.map(i => Math.abs(i.top)));
    const maxBottom = Math.max(1, ...items.map(i => Math.abs(i.bottom ?? 0)));
    const hasBottom = items.some(i => i.bottom !== undefined);

    return (
        <div className={cn("", className)}>
            {hint && <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{hint}</p>}

            <div className="overflow-x-auto">
                <div className="flex min-w-[560px] gap-1">
                    {items.map((it, i) => {
                        const topPct = (Math.abs(it.top) / maxTop) * 100;
                        const botPct = hasBottom ? (Math.abs(it.bottom ?? 0) / maxBottom) * 100 : 0;
                        const loss = (it.bottom ?? 0) < 0;
                        return (
                            <button
                                key={it.label + i}
                                type="button"
                                title={it.title}
                                onClick={onSelect ? () => onSelect(it, i) : undefined}
                                className={cn(
                                    "group flex flex-1 flex-col items-stretch rounded p-1.5 transition",
                                    onSelect && "cursor-pointer hover:bg-muted/50",
                                    selectedIndex === i && "bg-muted/50",
                                )}
                            >
                                <div className="flex h-24 items-end">
                                    <div
                                        className={cn("mx-auto w-full max-w-[72px] rounded-t bg-emerald-500/70", it.inProgress && "opacity-45")}
                                        style={{
                                            height: `${Math.max(topPct, it.top ? 2 : 0)}%`,
                                            backgroundImage: it.inProgress ? HATCH : undefined,
                                        }}
                                    />
                                </div>

                                {hasBottom && (
                                    <>
                                        <div className="h-px bg-border" />
                                        <div className="flex h-12 items-start">
                                            <div
                                                className={cn(
                                                    "mx-auto w-full max-w-[72px] rounded-b",
                                                    loss ? "bg-rose-500/70" : "bg-sky-500/70",
                                                    it.inProgress && "opacity-45",
                                                )}
                                                style={{
                                                    height: `${Math.max(botPct, it.bottom ? 2 : 0)}%`,
                                                    backgroundImage: it.inProgress ? HATCH : undefined,
                                                }}
                                            />
                                        </div>
                                    </>
                                )}

                                <div className="mt-1 text-center text-[10px] tabular-nums text-muted-foreground">
                                    {it.label}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {legend && legend.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                    {legend.map((l, i) => (
                        <span key={i} className="flex items-center gap-1.5">
                            <span className={cn("inline-block h-2 w-3 rounded-sm", l.color)} />
                            {l.label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

export default BarStrip;
