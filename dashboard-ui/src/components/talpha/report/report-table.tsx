"use client";

import { ReactNode } from "react";
import { cn } from "../utils";

/**
 * ReportTable — bảng dày đặc kiểu AUUS1: header IN HOA 11px, số tabular-nums,
 * ô rỗng là "—" chứ không phải 0 (0 và "không có số" là hai chuyện khác nhau).
 */

export interface Column<T> {
    key: string;
    label: string;
    align?: "left" | "right" | "center";
    /** class thêm cho ô dữ liệu */
    cellClassName?: string | ((row: T) => string);
    render?: (row: T, index: number) => ReactNode;
    /** Ghi chú hiện khi rê chuột vào tên cột. */
    title?: string;
}

interface Props<T> {
    emoji?: string;
    title?: string;
    /** Dòng giải thích ngay dưới tiêu đề bảng. */
    note?: ReactNode;
    columns: Column<T>[];
    rows: T[];
    rowKey: (row: T, index: number) => string;
    onRowClick?: (row: T, index: number) => void;
    /** Dòng tổng ghim cuối bảng. */
    footer?: ReactNode;
    empty?: ReactNode;
    minWidth?: number;
    className?: string;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" };

/** Giá trị rỗng hiển thị thống nhất một kiểu. */
export const DASH = "—";

export function ReportTable<T>({
    emoji, title, note, columns, rows, rowKey, onRowClick, footer, empty, minWidth = 560, className,
}: Props<T>) {
    return (
        <section className={cn("rounded-xl border border-border bg-card p-5 shadow-sm", className)}>
            {title && (
                <h3 className="section-header mb-1">
                    {emoji && <span aria-hidden>{emoji}</span>}
                    {title}
                </h3>
            )}
            {note && <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{note}</p>}

            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm" style={{ minWidth }}>
                    <thead>
                        <tr className="border-b border-border">
                            {columns.map(c => (
                                <th
                                    key={c.key}
                                    title={c.title}
                                    className={cn(
                                        "px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80",
                                        ALIGN[c.align ?? "left"],
                                    )}
                                >
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr
                                key={rowKey(row, i)}
                                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                                className={cn(
                                    "border-b border-border/50 last:border-0",
                                    onRowClick ? "cursor-pointer hover:bg-muted/40" : "hover:bg-muted/30",
                                )}
                            >
                                {columns.map(c => {
                                    const extra = typeof c.cellClassName === "function" ? c.cellClassName(row) : c.cellClassName;
                                    return (
                                        <td
                                            key={c.key}
                                            className={cn(
                                                "px-3 py-2 tabular-nums",
                                                ALIGN[c.align ?? "left"],
                                                extra,
                                            )}
                                        >
                                            {c.render ? c.render(row, i) : ((row as Record<string, ReactNode>)[c.key] ?? DASH)}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={columns.length} className="py-6 text-center text-sm italic text-muted-foreground">
                                    {empty ?? "Chưa có dữ liệu"}
                                </td>
                            </tr>
                        )}
                        {footer}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

export default ReportTable;
