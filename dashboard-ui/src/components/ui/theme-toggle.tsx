"use client";

import { useTheme } from "./theme-provider";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();

    return (
        <button
            onClick={toggleTheme}
            className="relative h-9 w-9 rounded-xl border border-border bg-card
                       flex items-center justify-center
                       hover:bg-accent hover:border-orange-400/40
                       transition-all duration-300 cursor-pointer
                       dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10"
            title={theme === "light" ? "Chuyển sang Dark Mode" : "Chuyển sang Light Mode"}
        >
            <Sun
                className={`h-4 w-4 text-amber-500 absolute transition-all duration-500
                    ${theme === "light" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"}`}
            />
            <Moon
                className={`h-4 w-4 text-indigo-300 absolute transition-all duration-500
                    ${theme === "dark" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"}`}
            />
        </button>
    );
}
