import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { AuthProvider } from "@/components/ui/auth-provider";


const plusJakarta = Plus_Jakarta_Sans({
    subsets: ["latin"],
    weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
    // Tên mặc định trước đây là "STRAMARK Dashboard" — dự án khác. Chưa đặt
    // NEXT_PUBLIC_APP_NAME là tab trình duyệt hiện tên một hệ thống không liên quan.
    title: `${process.env.NEXT_PUBLIC_APP_NAME || "TALPHA"} Dashboard`,
    description: "Dashboard vận hành TALPHA — quảng cáo, đơn hàng, tồn kho, đối soát",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={cn(plusJakarta.className, "bg-background text-foreground antialiased")} suppressHydrationWarning>
                <AuthProvider>
                    <ThemeProvider>
                        {children}
                    </ThemeProvider>
                </AuthProvider>
            </body>
        </html>
    );
}
