import type { Config } from "tailwindcss";

// ═══════════════════════════════════════════════════════════════════
// Màu ANTALO — lấy THẲNG từ file logo (public/antalo-logo.png):
//   đỏ #FF3131 · xanh lá #00BF63 · cam #FF7312 · đen · nền kem #FFFFEF
//
// Vì sao khai đè các họ màu có sẵn của Tailwind thay vì sửa từng class:
// các tab đang gõ cứng hơn 1.300 chỗ (amber, rose, emerald, indigo, slate…).
// Sửa tay từng chỗ vừa lâu vừa dễ sót, và lần sau ai thêm `text-amber-600`
// là màu lạ lại lọt vào. Khai đè ở ĐÂY thì mọi class cũ tự ra màu ANTALO, và
// chỗ nào cần đúng màu thương hiệu thì gọi thẳng `antalo-*`.
//
// Ánh xạ theo NGHĨA đang dùng trong code:
//   red · rose · pink        → đỏ ANTALO (mất tiền, cảnh báo, nhấn mạnh)
//   orange · amber · yellow  → cam ANTALO (thương hiệu, chú ý)
//   green · emerald · lime   → xanh lá ANTALO (đạt, lãi, tăng)
//   teal · cyan · sky · blue → xanh lá ngả lam (chuỗi thứ hai trên biểu đồ,
//                              vẫn trong họ xanh của logo để không lạc màu)
//   indigo · violet · purple → mực ấm (gần đen của logo)
//   slate · gray · zinc…     → xám ấm hợp nền kem
// ═══════════════════════════════════════════════════════════════════
const DO = {
    50: "#FFF0F0", 100: "#FEE1E1", 200: "#FDC3C3", 300: "#FD9090", 400: "#FF6161",
    500: "#FF3131", 600: "#ED1D1D", 700: "#C01B1B", 800: "#9C1C1C", 900: "#7E1B1B", 950: "#491212",
};
const XANH = {
    50: "#E8FCF3", 100: "#C8F9E1", 200: "#97F7C8", 300: "#51F6A6", 400: "#00E27A",
    500: "#00BF63", 600: "#00A354", 700: "#008545", 800: "#036837", 900: "#04522D", 950: "#042F1A",
};
const CAM = {
    50: "#FFF3EB", 100: "#FEE4D2", 200: "#FDCCAA", 300: "#FDAB72", 400: "#FF9042",
    500: "#FF7312", 600: "#DF620C", 700: "#AE5313", 800: "#8A4414", 900: "#713A14", 950: "#3F220D",
};
const XANH_LAM = {
    50: "#E9FBF6", 100: "#CBF6EA", 200: "#98F0D9", 300: "#51ECC2", 400: "#12DEA7",
    500: "#09AE82", 600: "#08916D", 700: "#06795B", 800: "#085E47", 900: "#084938", 950: "#06281F",
};
const MUC = {
    50: "#F6F5F4", 100: "#EDEBE9", 200: "#DCDAD5", 300: "#BDBAB2", 400: "#958F83",
    500: "#6E695E", 600: "#59544A", 700: "#464239", 800: "#36322B", 900: "#25221D", 950: "#171512",
};
const XAM = {
    50: "#FAF9F4", 100: "#F6F5EE", 200: "#EBE9E0", 300: "#D8D5CB", 400: "#B1AEA0",
    500: "#8A8675", 600: "#6E6B5E", 700: "#565348", 800: "#3E3B32", 900: "#28261F", 950: "#171612",
};

const config: Config = {
    darkMode: "class",
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },

                // Màu thương hiệu gọi thẳng: bg-antalo-red, text-antalo-green…
                antalo: {
                    red: "#FF3131",
                    green: "#00BF63",
                    orange: "#FF7312",
                    cream: "#FFFFEF",
                    ink: "#0A0A0A",
                },

                // Khai đè họ màu Tailwind (xem ghi chú đầu file)
                red: DO, rose: DO, pink: DO,
                orange: CAM, amber: CAM, yellow: CAM,
                green: XANH, emerald: XANH, lime: XANH,
                teal: XANH_LAM, cyan: XANH_LAM, sky: XANH_LAM, blue: XANH_LAM,
                indigo: MUC, violet: MUC, purple: MUC, fuchsia: MUC,
                slate: XAM, gray: XAM, zinc: XAM, neutral: XAM, stone: XAM,
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            keyframes: {
                "fade-in": {
                    from: { opacity: "0", transform: "translateY(8px)" },
                    to: { opacity: "1", transform: "translateY(0)" },
                },
                "slide-up": {
                    from: { opacity: "0", transform: "translateY(16px)" },
                    to: { opacity: "1", transform: "translateY(0)" },
                },
            },
            animation: {
                "fade-in": "fade-in 0.4s ease-out both",
                "slide-up": "slide-up 0.5s ease-out both",
            },
        },
    },
    plugins: [],
};
export default config;
