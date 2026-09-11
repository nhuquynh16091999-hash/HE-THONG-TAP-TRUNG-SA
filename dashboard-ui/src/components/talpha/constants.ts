/**
 * Địa chỉ kho dữ liệu BigQuery mà các tab phía client ghép vào câu SQL.
 *
 * ⚠️ Dữ liệu TALPHA nằm ở GCP project `cty-507710`, KHÔNG phải levelup-465304.
 *
 * 11/09/2026 đã gỡ khỏi file này: `API_BASE` (trỏ localhost:8000 — backend
 * FastAPI của hệ cũ, đã không còn), `APP_VERSION`, `TBL()`, và cả khối `SQL`
 * (revLocal · shipLocal · delivered · marketer). Khối SQL đó tự dựng lại phép
 * chia tiền theo shop trong khi `vw_orders_std.revenue_vnd` đã quy sẵn — hai
 * công thức song song cho cùng một con số là cách chắc chắn nhất để chúng lệch
 * nhau. Không tab nào gọi tới nó. Cần lại thì: git log file này.
 */

export const DATASET = process.env.NEXT_PUBLIC_DATASET || "TALPHA_Dataset";
export const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
