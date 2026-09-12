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
        // lang="vi" — KHÔNG phải "en".
        //
        // Toàn bộ dashboard là tiếng Việt, nhưng trang khai lang="en" nên Chrome
        // kết luận đây là trang tiếng nước ngoài rồi TỰ DỊCH sang tiếng Việt.
        // Google Dịch làm việc đó bằng cách thay các text node bằng thẻ <font>
        // của nó. React vẫn giữ tham chiếu tới node gốc, nên lần render lại kế
        // tiếp nó gọi removeChild trên một node đã không còn là con của cha:
        //
        //     NotFoundError: Failed to execute 'removeChild' on 'Node'
        //
        // Cả màn hình sập. Dính thật 12/09/2026 ở tab Đối soát chi phí QC —
        // nhận ra vì chữ trên màn hình đã bị đổi so với chữ trong code
        // ("dashboard" thành "bảng điều khiển").
        //
        // translate="no" + thẻ meta là lớp chặn thứ hai, cho trường hợp người
        // dùng tự bấm dịch: nội dung đã là tiếng Việt nên dịch chỉ có hại.
        <html lang="vi" translate="no" suppressHydrationWarning>
            <head>
                <meta name="google" content="notranslate" />
            </head>
            <body
                className={cn(plusJakarta.className, "notranslate bg-background text-foreground antialiased")}
                translate="no"
                suppressHydrationWarning
            >
                <AuthProvider>
                    <ThemeProvider>
                        {children}
                    </ThemeProvider>
                </AuthProvider>
            </body>
        </html>
    );
}
