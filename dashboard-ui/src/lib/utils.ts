import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Gộp class Tailwind, class sau thắng class trước. */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// 11/09/2026 đã gỡ khỏi file này: RON_TO_VND · USD_TO_VND · EUR_TO_VND và năm
// hàm định dạng tiền.
//
// Chúng là di sản của một dự án Romania: `formatCurrency(x)` MẶC ĐỊNH nhân x với
// 5.946 (tỷ giá LEI). Trong một dashboard mà mọi con số đã là VND, hàm đó gọi
// nhầm một lần là số phóng lên gần sáu nghìn lần — và nó ngồi cạnh một hàm cùng
// tên ở components/talpha/utils.ts với hành vi KHÁC hẳn (không nhân gì cả).
// Không nơi nào trong repo gọi tới; cả năm file chỉ import đúng `cn`.
//
// Định dạng tiền/số của TALPHA: components/talpha/utils.ts.
