// ESLint — cấu hình phẳng (flat config).
//
// Next 16 đã BỎ lệnh `next lint`, và `eslint-config-next` v16 chỉ còn xuất bản
// flat config. Trước 11/09/2026 script `lint` trong package.json vẫn gọi
// `next lint` — gõ vào chỉ nhận "unknown command", và CI cũng gọi đúng lệnh đó
// nên job lint hỏng suốt mà không ai đọc. Nay `npm run lint` chạy thật.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
    {
        ignores: [
            ".next/**",
            "node_modules/**",
            ".test-build/**",
            "tests/**",          // test .cjs chạy bằng node thuần, không theo quy ước React
            "next-env.d.ts",
        ],
    },
    ...nextCoreWebVitals,
    ...nextTypescript,
    {
        rules: {
            // `any` hạ xuống CẢNH BÁO, không chặn.
            //
            // Repo đang có 154 chỗ dùng `any`, phần lớn ở nơi đọc JSON thô từ Meta
            // API và POS — những chỗ đó cần kiểu thật, nhưng gõ kiểu cho chúng là
            // một việc riêng, không phải điều kiện để merge một sửa đổi khác.
            // Để mức "error" thì lint đỏ ngay từ dòng đầu và không ai chạy nữa,
            // thành ra mất luôn cả những lỗi thật mà nó bắt được.
            "@typescript-eslint/no-explicit-any": "warn",

            // Gọi setState ngay trong effect — hạ xuống CẢNH BÁO.
            //
            // Hai chỗ dính: `theme-provider` đọc chủ đề từ localStorage sau khi
            // mount, và tab Kho bật cờ "đang tải" trước khi fetch. Cả hai là mẫu
            // React quen thuộc và đang chạy đúng; viết lại cho hết cảnh báo
            // (useSyncExternalStore, useReducer) là một việc riêng, có rủi ro
            // nhấp nháy giao diện, không phải điều kiện để merge sửa đổi khác.
            "react-hooks/set-state-in-effect": "warn",

            // Biến/tham số mở đầu bằng _ là CỐ Ý bỏ: `const { password: _bo, ...rest }`
            // để loại mật khẩu khỏi phản hồi, hay `(_props)` khi component không dùng prop.
            "@typescript-eslint/no-unused-vars": ["warn", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
            }],
        },
    },
];

export default config;
