import { Info, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KPICardProps {
    title: string;
    value: string | number;
    icon?: LucideIcon;
    trend?: {
        value: number;
        label?: string; // e.g. "vs last month"
    };
    subValue?: string;
    className?: string;
    status?: "success" | "warning" | "danger" | "neutral";
    tooltip?: string;
}

export function KPICard({
    title,
    value,
    icon: Icon,
    trend,
    subValue,
    className,
    status = "neutral",
    tooltip,
}: KPICardProps) {
    const statusColor = {
        success: "text-emerald-500 dark:text-emerald-400",
        warning: "text-amber-500 dark:text-amber-400",
        danger: "text-rose-500 dark:text-rose-400",
        neutral: "text-slate-400 dark:text-slate-500",
    };

    return (
        <div className={cn(
            "kpi-card flex flex-col justify-between",
            tooltip && "group/kpi relative",
            className
        )}>
            <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                    {title}
                    {tooltip && (
                        <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" aria-label={tooltip} />
                    )}
                </span>
                {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            </div>
            {tooltip && (
                <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-md border border-border bg-popover p-2.5 text-xs leading-relaxed text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover/kpi:opacity-100">
                    {tooltip}
                </div>
            )}
            <div className="mt-2 space-y-1">
                <div className="flex items-end gap-2">
                    <span className="text-2xl font-bold tracking-tight text-foreground">{value}</span>
                    {trend && (
                        <span
                            className={cn(
                                "mb-1 text-xs font-medium",
                                trend.value > 0 ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"
                            )}
                        >
                            {trend.value > 0 ? "+" : ""}
                            {trend.value}%
                        </span>
                    )}
                </div>
                {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
            </div>
        </div>
    );
}
