"use client";

/**
 * Reusable loading skeleton components for dashboard tabs.
 * Usage: <TabSkeleton /> or <TabSkeleton rows={6} cards={3} />
 */

interface TabSkeletonProps {
    cards?: number;
    rows?: number;
    showChart?: boolean;
}

function SkeletonPulse({ className, style }: { className?: string; style?: React.CSSProperties }) {
    return (
        <div className={`animate-shimmer rounded-lg ${className || ""}`} style={style} />
    );
}

export function KPISkeleton({ count = 4 }: { count?: number }) {
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-card dark:bg-white/[0.03] p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <SkeletonPulse className="h-4 w-4 rounded" />
                        <SkeletonPulse className="h-3 w-20" />
                    </div>
                    <SkeletonPulse className="h-8 w-24" />
                    <SkeletonPulse className="h-3 w-16" />
                </div>
            ))}
        </div>
    );
}

export function ChartSkeleton() {
    return (
        <div className="rounded-xl border border-border bg-card dark:bg-white/[0.03] p-6 mb-6">
            <SkeletonPulse className="h-5 w-40 mb-4" />
            <div className="flex items-end gap-1 h-48">
                {Array.from({ length: 12 }).map((_, i) => {
                    // Fixed heights to avoid SSR/client hydration mismatch (Math.random() is forbidden here)
                    const heights = [55, 80, 45, 90, 65, 38, 75, 52, 88, 60, 42, 70];
                    return (
                        <SkeletonPulse
                            key={i}
                            className="flex-1"
                            style={{ height: `${heights[i]}%` } as React.CSSProperties}
                        />
                    );
                })}
            </div>
        </div>
    );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <div className="rounded-xl border border-border bg-card dark:bg-white/[0.03] overflow-hidden">
            {/* Header */}
            <div className="flex gap-4 p-4 border-b border-border">
                {Array.from({ length: 6 }).map((_, i) => (
                    <SkeletonPulse key={i} className="h-3 flex-1" />
                ))}
            </div>
            {/* Rows */}
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex gap-4 p-4 border-b border-border last:border-0">
                    {Array.from({ length: 6 }).map((_, j) => (
                        <SkeletonPulse key={j} className="h-4 flex-1" />
                    ))}
                </div>
            ))}
        </div>
    );
}

export default function TabSkeleton({ cards = 4, rows = 5, showChart = true }: TabSkeletonProps) {
    return (
        <div className="space-y-6">
            <KPISkeleton count={cards} />
            {showChart && <ChartSkeleton />}
            <TableSkeleton rows={rows} />
        </div>
    );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="h-12 w-12 rounded-full bg-rose-500/10 flex items-center justify-center">
                <svg className="h-6 w-6 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
            </div>
            <p className="text-sm text-muted-foreground">{message}</p>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-500/20 transition-colors"
                >
                    Thử lại
                </button>
            )}
        </div>
    );
}
