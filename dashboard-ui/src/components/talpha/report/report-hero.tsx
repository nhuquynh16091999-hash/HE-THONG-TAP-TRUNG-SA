"use client";

import { ReactNode } from "react";
import { cn } from "../utils";

/**
 * ReportHero — khối mở đầu của mọi tab, theo đúng ngôn ngữ trình bày của AUUS1.
 *
 * Ba phần cố định:
 *  1. emoji + tiêu đề kỳ báo cáo
 *  2. dòng "xuất xứ số" (view nào, tính tới ngày nào) — bắt buộc, để người đọc
 *     biết con số này từ đâu ra mà không phải hỏi
 *  3. slot hành động bên phải (chọn kỳ, xuất CSV…)
 *
 * Thanh tiến độ chỉ hiện khi truyền `progress`. Chưa có mục tiêu doanh thu trong
 * talpha_rules.json nên hiện tại các tab đều bỏ trống — thêm `targets` vào rules
 * file rồi truyền xuống là thanh này chạy.
 */

export interface HeroProgress {
    label: string;
    current: number;
    target: number;
    /** Định dạng số hiển thị (vd formatVNDCompact) */
    format?: (n: number) => string;
}

interface Props {
    emoji?: string;
    title: string;
    /** Dòng xuất xứ số — luôn nên có. */
    subtitle?: ReactNode;
    actions?: ReactNode;
    progress?: HeroProgress;
    children?: ReactNode;
    className?: string;
}

export function ReportHero({ emoji, title, subtitle, actions, progress, children, className }: Props) {
    const pct = progress && progress.target > 0
        ? Math.max(0, Math.min(100, Math.round((progress.current / progress.target) * 100)))
        : null;
    const fmt = progress?.format ?? ((n: number) => String(n));

    return (
        <section className={cn("rounded-xl border border-border bg-card p-5 shadow-sm", className)}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                        {emoji && <span aria-hidden>{emoji}</span>}
                        {title}
                    </h2>
                    {subtitle && (
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
                    )}
                </div>
                {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>

            {progress && pct !== null && (
                <div>
                    <div className="mb-1 flex items-baseline justify-between text-sm">
                        <span className="text-muted-foreground">
                            {progress.label}{" "}
                            <strong className="font-semibold text-foreground">{fmt(progress.current)}</strong>
                            {" / "}{fmt(progress.target)}
                        </span>
                        <span className="font-semibold text-amber-500 tabular-nums">{pct}%</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-500 transition-all"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                </div>
            )}

            {children}
        </section>
    );
}

export default ReportHero;
