"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { format, startOfMonth, endOfMonth, subMonths, subDays } from "date-fns";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";

interface DateRangePickerProps {
    value: { from: Date; to: Date };
    onChange: (range: { from: Date; to: Date }) => void;
}

interface Preset {
    label: string;
    key: string;
    getRange: () => { from: Date; to: Date };
}

const PRESETS: Preset[] = [
    {
        label: "Hôm nay",
        key: "today",
        getRange: () => ({ from: new Date(), to: new Date() }),
    },
    {
        label: "Hôm qua",
        key: "yesterday",
        getRange: () => {
            const y = subDays(new Date(), 1);
            return { from: y, to: y };
        },
    },
    {
        label: "7 ngày",
        key: "7d",
        getRange: () => ({ from: subDays(new Date(), 6), to: new Date() }),
    },
    {
        label: "30 ngày",
        key: "30d",
        getRange: () => ({ from: subDays(new Date(), 29), to: new Date() }),
    },
    {
        label: "Tháng này",
        key: "this-month",
        getRange: () => ({ from: startOfMonth(new Date()), to: new Date() }),
    },
    {
        label: "Tháng trước",
        key: "last-month",
        getRange: () => ({
            from: startOfMonth(subMonths(new Date(), 1)),
            to: endOfMonth(subMonths(new Date(), 1)),
        }),
    },
    {
        label: "90 ngày",
        key: "90d",
        getRange: () => ({ from: subDays(new Date(), 89), to: new Date() }),
    },
];

// Match current value against a preset so the highlighted pill stays in sync
// when DateRangePicker remounts (e.g., tab navigation restores saved range).
function matchPreset(value: { from: Date; to: Date }): string {
    const fromStr = format(value.from, "yyyy-MM-dd");
    const toStr = format(value.to, "yyyy-MM-dd");
    for (const p of PRESETS) {
        const r = p.getRange();
        if (
            format(r.from, "yyyy-MM-dd") === fromStr &&
            format(r.to, "yyyy-MM-dd") === toStr
        ) return p.key;
    }
    return "custom";
}

export default function DateRangePicker({ value, onChange }: DateRangePickerProps) {
    const [open, setOpen] = useState(false);
    const [activePreset, setActivePreset] = useState(() => matchPreset(value));
    const [showCustom, setShowCustom] = useState(false);
    const [customFrom, setCustomFrom] = useState(format(value.from, "yyyy-MM-dd"));
    const [customTo, setCustomTo] = useState(format(value.to, "yyyy-MM-dd"));
    const ref = useRef<HTMLDivElement>(null);

    // Sync preset highlight when value changes from outside (persistence restore, programmatic set)
    useEffect(() => {
        setActivePreset(matchPreset(value));
    }, [value]);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const selectPreset = useCallback(
        (preset: Preset) => {
            setActivePreset(preset.key);
            setShowCustom(false);
            onChange(preset.getRange());
            setOpen(false);
        },
        [onChange]
    );

    const applyCustom = useCallback(() => {
        const from = new Date(customFrom);
        const to = new Date(customTo);
        if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
            setActivePreset("custom");
            onChange({ from, to });
            setOpen(false);
        }
    }, [customFrom, customTo, onChange]);

    const displayLabel =
        activePreset === "custom"
            ? `${format(value.from, "dd/MM/yyyy")} — ${format(value.to, "dd/MM/yyyy")}`
            : `${format(value.from, "dd MMM")} — ${format(value.to, "dd MMM, yyyy")}`;

    return (
        <div ref={ref} className="relative">
            {/* Trigger Button */}
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 rounded-lg border border-border bg-card 
                           dark:bg-white/[0.04] dark:border-white/[0.08]
                           px-3 py-1.5 text-sm text-muted-foreground 
                           hover:bg-gray-50 dark:hover:bg-white/[0.06] hover:border-orange-400/50 hover:text-foreground
                           transition-all cursor-pointer select-none"
            >
                <CalendarIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                <span suppressHydrationWarning>{displayLabel}</span>
                <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
                />
            </button>

            {/* Dropdown */}
            {open && (
                <div
                    className="absolute right-0 top-full mt-2 z-50 w-72
                               rounded-xl border border-border bg-card/95 
                               dark:bg-[#1a1f2e]/95 dark:border-white/[0.08]
                               backdrop-blur-xl
                               shadow-2xl shadow-black/10 dark:shadow-black/40 p-3 space-y-3
                               animate-in fade-in-0 slide-in-from-top-2 duration-200"
                >
                    {/* Preset Grid */}
                    <div className="grid grid-cols-4 gap-1.5">
                        {PRESETS.map((p) => (
                            <button
                                key={p.key}
                                onClick={() => selectPreset(p)}
                                className={`rounded-lg px-2 py-1.5 text-xs font-medium transition-all
                                    ${activePreset === p.key
                                        ? "bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/25"
                                        : "bg-gray-50 dark:bg-white/[0.04] text-muted-foreground hover:bg-gray-100 dark:hover:bg-white/[0.08] hover:text-foreground"
                                    }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* Divider */}
                    <div className="border-t border-border dark:border-white/[0.06]" />

                    {/* Custom Toggle */}
                    <button
                        onClick={() => {
                            setShowCustom(!showCustom);
                            setCustomFrom(format(value.from, "yyyy-MM-dd"));
                            setCustomTo(format(value.to, "yyyy-MM-dd"));
                        }}
                        className={`w-full rounded-lg px-3 py-1.5 text-xs font-medium transition-all text-left
                            ${showCustom || activePreset === "custom"
                                ? "bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-500/30"
                                : "bg-gray-50 dark:bg-white/[0.04] text-muted-foreground hover:bg-gray-100 dark:hover:bg-white/[0.08] hover:text-foreground"
                            }`}
                    >
                        📅 Tùy chọn khoảng thời gian
                    </button>

                    {/* Custom Date Inputs */}
                    {showCustom && (
                        <div className="space-y-2">
                            <div className="flex gap-2 items-center">
                                <label className="text-[10px] text-muted-foreground w-8">Từ</label>
                                <input
                                    type="date"
                                    value={customFrom}
                                    onChange={(e) => setCustomFrom(e.target.value)}
                                    className="flex-1 rounded-lg border border-border dark:border-white/[0.08] bg-background 
                                               dark:bg-white/[0.04]
                                               px-2.5 py-1.5 text-xs text-foreground
                                               focus:outline-none focus:border-orange-500 dark:focus:border-orange-400"
                                />
                            </div>
                            <div className="flex gap-2 items-center">
                                <label className="text-[10px] text-muted-foreground w-8">Đến</label>
                                <input
                                    type="date"
                                    value={customTo}
                                    onChange={(e) => setCustomTo(e.target.value)}
                                    className="flex-1 rounded-lg border border-border dark:border-white/[0.08] bg-background 
                                               dark:bg-white/[0.04]
                                               px-2.5 py-1.5 text-xs text-foreground
                                               focus:outline-none focus:border-orange-500 dark:focus:border-orange-400"
                                />
                            </div>
                            <button
                                onClick={applyCustom}
                                className="w-full rounded-lg bg-gradient-to-r from-orange-500 to-red-500 px-3 py-1.5 
                                           text-xs font-semibold text-white
                                           hover:from-orange-400 hover:to-red-400 transition-colors"
                            >
                                Áp dụng
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
