"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Lock, Eye, EyeOff, AlertCircle, Loader2, LogIn,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   Single-user login (password only) — per deployment mode

   Màu lấy từ design token trong globals.css (--background, --card, --border,
   --primary) thay vì gõ thẳng slate/indigo, để trang này đổi theme cùng lúc với
   dashboard. Nhấn brand là gradient cam → đỏ, giống sidebar và tiêu đề TALPHA.
   ═══════════════════════════════════════════════════════════ */

const DEPLOYMENT_MODE = (process.env.NEXT_PUBLIC_DEPLOYMENT_MODE || "talpha").toLowerCase();
const FIXED_EMAIL = `${DEPLOYMENT_MODE}@levelup`;
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "TALPHA";

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || `/${DEPLOYMENT_MODE}`;

    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const result = await signIn("credentials", {
                email: FIXED_EMAIL,
                password,
                redirect: false,
            });

            if (result?.error) {
                setError("Mật khẩu không đúng");
            } else {
                router.push(callbackUrl);
                router.refresh();
            }
        } catch {
            setError("Có lỗi xảy ra. Vui lòng thử lại.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-bold text-foreground">Đăng nhập</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Nhập mật khẩu để truy cập {APP_NAME} Dashboard
                </p>
            </div>

            {error && (
                <div className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-foreground/80">
                        Mật khẩu
                    </label>
                    <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                            id="login-password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            autoFocus
                            className="w-full rounded-xl border border-border bg-card py-3 pl-10 pr-12 text-sm text-foreground transition-all placeholder:text-muted-foreground/60 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/30 dark:bg-white/[0.04]"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                        >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading || password.length === 0}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition-all duration-300 hover:from-orange-600 hover:to-red-600 hover:shadow-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {loading ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Đang đăng nhập...
                        </>
                    ) : (
                        <>
                            <LogIn className="h-4 w-4" />
                            Đăng nhập
                        </>
                    )}
                </button>
            </form>
        </div>
    );
}

function AuthPage() {
    return (
        <>
            <div className="mb-8 text-center">
                <div className="mb-4 inline-flex items-center justify-center">
                    <img
                        src="/logo.png"
                        alt={APP_NAME}
                        className="h-16 w-16 object-contain"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                        }}
                    />
                </div>
                <h1 className="brand-gradient-text text-3xl font-extrabold tracking-tight">
                    {APP_NAME}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">Tiểu Alpha — Middle East</p>
                <p className="mt-1 text-[11px] text-muted-foreground/70">🇸🇦 🇦🇪 🇰🇼 🇴🇲 🇶🇦 🇧🇭</p>
            </div>

            <div className="rounded-2xl border border-border bg-card/80 p-8 shadow-xl backdrop-blur-xl dark:bg-white/[0.04] dark:shadow-none">
                <LoginForm />
            </div>

            <div className="mt-6 text-center">
                <p className="text-xs text-muted-foreground/70">
                    {APP_NAME} Dashboard · Level Up Analytics
                </p>
            </div>
        </>
    );
}

export default function LoginPage() {
    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
            {/* Vệt sáng nền — cùng dải cam/đỏ với brand gradient */}
            <div className="absolute inset-0 overflow-hidden" aria-hidden>
                <div className="absolute -right-40 -top-40 h-80 w-80 rounded-full bg-orange-500/10 blur-3xl dark:bg-orange-500/[0.07]" />
                <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-red-500/10 blur-3xl dark:bg-red-500/[0.07]" />
                <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/[0.07] blur-3xl" />
            </div>

            <div className="relative mx-4 w-full max-w-md">
                <Suspense fallback={
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
                    </div>
                }>
                    <AuthPage />
                </Suspense>
            </div>
        </div>
    );
}
