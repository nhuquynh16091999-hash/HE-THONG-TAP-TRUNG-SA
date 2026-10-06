import type { MetadataRoute } from "next";

/**
 * Khai báo "app cài được" (PWA) — Sỹ Anh yêu cầu 06/10/2026: cài dashboard về điện thoại
 * và máy tính như một app. Next tự phục vụ ở /manifest.webmanifest và tự gắn thẻ <link>.
 *
 * Điện thoại chỉ cho cài (mở toàn màn hình, có biểu tượng riêng) khi trang chạy HTTPS —
 * máy chủ phục vụ https://139.180.131.21 qua nginx (ops/deploy/nginx-talpha-https.conf).
 * Mở bằng http://…:3000 thì vẫn dùng được nhưng chỉ là lối tắt mở trình duyệt.
 */
export default function manifest(): MetadataRoute.Manifest {
    return {
        id: "/talpha",
        name: "ANTALO Dashboard",
        short_name: "ANTALO",
        description: "Dashboard vận hành ANTALO — báo cáo, đơn hàng, vận đơn, quảng cáo",
        lang: "vi",
        start_url: "/talpha",
        scope: "/",
        display: "standalone",
        orientation: "any",
        // Màu nền kem của logo — màn chờ lúc mở app cùng màu biểu tượng.
        background_color: "#FFFFEF",
        theme_color: "#FFFFEF",
        icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
    };
}
