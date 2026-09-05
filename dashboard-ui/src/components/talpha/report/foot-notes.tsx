"use client";

import { ReactNode } from "react";
import { cn } from "../utils";

/**
 * FootNotes — chân tab bắt buộc theo chuẩn AUUS1.
 *
 * Ba tầng: (1) hộp cảnh báo vàng cho cái dễ đọc sai, (2) các dòng định nghĩa số,
 * (3) dòng "Nguồn số" liệt kê view. Có dòng nguồn thì khi số sai người ta biết
 * phải sửa ở view chứ không vá ở tab — đúng nguyên tắc TALPHA đã chốt.
 */

interface Props {
    /** Cảnh báo nổi bật, vd cách đọc số giữa kỳ. */
    warning?: ReactNode;
    /** Các dòng định nghĩa/cách tính. */
    notes?: ReactNode[];
    /** Tên các view BigQuery, vd ["vw_orders_std", "vw_fb_ads_std"] */
    sources?: string[];
    className?: string;
}

export function FootNotes({ warning, notes, sources, className }: Props) {
    return (
        <div className={cn("space-y-3", className)}>
            {warning && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-700 dark:border-amber-500/20 dark:text-amber-400">
                    ⚠️ {warning}
                </div>
            )}

            {notes && notes.length > 0 && (
                <div className="space-y-1.5">
                    {notes.map((n, i) => (
                        <p key={i} className="text-xs leading-relaxed text-muted-foreground">{n}</p>
                    ))}
                </div>
            )}

            {sources && sources.length > 0 && (
                <p className="text-xs leading-relaxed text-muted-foreground/70">
                    Nguồn số: cả tab đọc từ {sources.map(s => <code key={s} className="mx-0.5 rounded bg-muted px-1 py-0.5 text-[11px]">{s}</code>)}
                    {" "}— muốn đổi định nghĩa thì sửa view, đừng sửa ở tab.
                </p>
            )}
        </div>
    );
}

export default FootNotes;
