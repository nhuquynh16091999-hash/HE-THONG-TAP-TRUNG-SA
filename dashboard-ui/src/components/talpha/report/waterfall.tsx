"use client";

import { ReactNode } from "react";
import { cn } from "../utils";

/**
 * WaterfallList — bảng bóc tách "doanh thu → trừ dần chi phí → = lãi ròng" của AUUS1.
 *
 * Mỗi dòng bắt buộc có `label`; `hint` là phần giải thích trong ngoặc, cố tình để
 * mờ hơn để mắt lướt qua cột số trước. Dòng `kind: "total"` được kẻ đậm ở trên.
 */

export interface WaterfallRow {
    label: string;
    /** Giải thích ngắn trong ngoặc, vd "3 đơn chưa có giá vốn" */
    hint?: ReactNode;
    value: ReactNode;
    kind?: "base" | "minus" | "plus" | "total";
    /** Dòng chưa có dữ liệu — hiện mờ, giá trị thường là "—" */
    missing?: boolean;
}

export function WaterfallList({ rows, className }: { rows: WaterfallRow[]; className?: string }) {
    return (
        <div className={cn("mt-4", className)}>
            {rows.map((r, i) => {
                const total = r.kind === "total";
                return (
                    <div
                        key={i}
                        className={cn(
                            "flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border/40 py-1.5 text-sm last:border-0",
                            total && "mt-1 border-b-0 border-t-2 border-border pt-2.5 text-base font-bold",
                            r.missing && "opacity-60",
                        )}
                    >
                        <span className={cn("text-foreground", !total && "font-medium")}>
                            {r.kind === "minus" && <span className="mr-1 text-muted-foreground">−</span>}
                            {total && <span className="mr-1 text-muted-foreground">=</span>}
                            {r.label}
                            {r.hint && (
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground/70">({r.hint})</span>
                            )}
                        </span>
                        <span
                            className={cn(
                                "tabular-nums",
                                total ? "text-lg" : "text-sm",
                                r.kind === "minus" && !r.missing && "text-rose-600 dark:text-rose-400",
                            )}
                        >
                            {r.value}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

export default WaterfallList;
