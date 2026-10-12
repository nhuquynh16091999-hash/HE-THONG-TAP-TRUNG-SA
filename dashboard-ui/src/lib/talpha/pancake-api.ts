// ═══════════════════════════════════════════════════════════════════
// Gọi API Pancake (pages.fm) — phần CÓ MẠNG, dùng chung cho:
//   • /api/talpha/pancake-nuoc — số một nước một ngày theo page (bot Zalo, tin mỗi giờ Nhật);
//   • /api/talpha/realtime     — Ads Command Center: mess từng camp của nước Meta không báo tin
//     nhắn (Nhật), Sỹ Anh yêu cầu 13/10/2026 "cập nhật dashboard cho thị trường Nhật".
// Hàm thuần (đếm, chia, khớp tên) ở lib/talpha/pancake.ts — có test.
//
// Pancake 429 khi gọi dồn: mỗi lượt cách nhau GIAN_MS, gặp 429 thì chờ 5s · 10s · 20s. Hai route
// hỏi cùng page cùng mốc trong 3 phút thì dùng chung một lần gọi (NHO_HT).
// ═══════════════════════════════════════════════════════════════════
import { campaignMarket, MESS_PANCAKE } from "./rules";
import {
    PANCAKE_API, chuanTenPage, chiaMessTheoCamp, demTrongKhoang, hanToken, hetLoTrongNgay, trangCuaCamp,
    type HoiThoai,
} from "./pancake";

export const GIAN_MS = 400;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function goiPancake(url: string): Promise<any> {
    for (let lan = 0; lan < 4; lan++) {
        const r = await fetch(url, { cache: "no-store" });
        if (r.status === 429) { await sleep(5000 * 2 ** lan); continue; }
        const j = await r.json().catch(() => null);
        if (!r.ok || !j) throw new Error(`Pancake HTTP ${r.status}`);
        if (j.success === false) throw new Error(`Pancake: ${j.message || "lỗi"}${j.error_code ? ` (mã ${j.error_code})` : ""}`);
        return j;
    }
    throw new Error("Pancake 429 — gọi dồn quá, thử lại sau");
}

/** Token tài khoản Pancake + lỗi nếu thiếu / hết hạn. */
export function tokenPancake(): { tok: string; het_han: string | null; loi: string } {
    const tok = String(process.env.TALPHA_PANCAKE_API_TOKEN || "").trim();
    const het = hanToken(tok);
    const loi = !tok ? "chưa khai TALPHA_PANCAKE_API_TOKEN"
        : het && het < Date.now() ? `token Pancake đã hết hạn ${new Date(het).toISOString().slice(0, 10)}` : "";
    return { tok, het_han: het ? new Date(het).toISOString() : null, loi };
}

// Danh sách page của tài khoản — 10 phút mới hỏi lại.
let dsPage: { at: number; tok: string; pages: { id: string; name: string }[] } | null = null;
export async function cacPage(tok: string): Promise<{ id: string; name: string }[]> {
    if (dsPage && dsPage.tok === tok && Date.now() - dsPage.at < 600_000) return dsPage.pages;
    const j = await goiPancake(`${PANCAKE_API}/pages?access_token=${encodeURIComponent(tok)}`);
    const c = j.categorized || {};
    const pages = [...(c.activated || []), ...(c.inactivated || [])]
        .filter((p: any) => p && p.id).map((p: any) => ({ id: String(p.id), name: String(p.name || "") }));
    dsPage = { at: Date.now(), tok, pages };
    return pages;
}

const MAX_LO = 25;
const NHO_HT = new Map<string, { at: number; v: { hts: HoiThoai[]; du: boolean } }>();

/**
 * Mọi hội thoại có thể TẠO từ ngày VN `tu` tới nay của một page — lật bằng current_count (lô xếp
 * theo updated_at mới nhất trước) tới khi cả lô đã cập nhật trước 00:00 ngày `tu`, tối đa MAX_LO
 * lô. `du` = false khi chạm trần mà chưa lật hết (khoảng dài, page đông) hoặc quá `hetLuc`
 * (epoch ms — route có hạn chạy) — số đếm được là THIẾU. Chỉ nhớ kết quả lật HẾT.
 */
export async function hoiThoaiTu(tok: string, pageId: string, tu: string, hetLuc?: number): Promise<{ hts: HoiThoai[]; du: boolean }> {
    const khoa = `${pageId}|${tu}`;
    const hit = NHO_HT.get(khoa);
    if (hit && Date.now() - hit.at < 180_000) return hit.v;
    const hts: HoiThoai[] = [];
    let cc = 0, du = false;
    for (let lo = 0; lo < MAX_LO; lo++) {
        if (hetLuc && lo > 0 && Date.now() > hetLuc) break;
        const j = await goiPancake(`${PANCAKE_API}/pages/${pageId}/conversations?access_token=${encodeURIComponent(tok)}&current_count=${cc}`);
        const ds: HoiThoai[] = (j.conversations || []).map((h: any) => ({
            id: String(h.id), type: h.type, inserted_at: h.inserted_at, updated_at: h.updated_at, has_phone: !!h.has_phone,
        }));
        hts.push(...ds);
        if (hetLoTrongNgay(ds, tu)) { du = true; break; }
        cc += ds.length;
        await sleep(GIAN_MS);
    }
    const v = { hts, du };
    if (du) NHO_HT.set(khoa, { at: Date.now(), v });
    return v;
}

type CampMess = { campaign_name: string; spend_vnd: number; link_clicks?: number | null };

/**
 * Mess từng camp của nước Meta không báo tin nhắn (MESS_PANCAKE), khoảng ngày VN [tu, den]:
 * hội thoại INBOX mới trên page ghi trong tên camp (ô TRANG), chia cho các camp cùng page bằng
 * chiaMessTheoCamp — cùng luật tin mỗi giờ của bot. Chỉ camp CÓ TIÊU trong khoảng mới nhận mess.
 * Hỏng (token, mạng) thì ok=false kèm lý do — route giữ số Meta và báo cảnh báo, không im lặng.
 * `hetLuc`: quá giờ này thì page còn lại đếm dở (vào `thieu`) — route có hạn chạy.
 */
export async function messPancakeChoCamp<C extends CampMess>(camps: C[], tu: string, den: string, hetLuc?: number): Promise<{
    ok: boolean; loi: string; theoCamp: Map<C, number>; tong: number; thieu: string[]; khong_thay: string[];
}> {
    const theoCamp = new Map<C, number>();
    const kq = { ok: false, loi: "", theoCamp, tong: 0, thieu: [] as string[], khong_thay: [] as string[] };
    const nhom = new Map<string, { ten: string; cs: C[] }>();
    for (const c of camps) {
        if (!(c.spend_vnd > 0) || !MESS_PANCAKE.includes(campaignMarket(c.campaign_name).market || "")) continue;
        const t = trangCuaCamp(c.campaign_name);
        if (!t) continue;
        const k = chuanTenPage(t);
        if (!nhom.has(k)) nhom.set(k, { ten: t, cs: [] });
        nhom.get(k)!.cs.push(c);
    }
    if (!nhom.size) { kq.ok = true; return kq; }
    const { tok, loi } = tokenPancake();
    if (loi) { kq.loi = loi; return kq; }
    try {
        const tatCa = await cacPage(tok);
        for (const [k, g] of nhom) {
            const p = tatCa.find((x) => chuanTenPage(x.name) === k);
            if (!p) { kq.khong_thay.push(g.ten); continue; }
            const { hts, du } = await hoiThoaiTu(tok, p.id, tu, hetLuc);
            if (!du) kq.thieu.push(p.name);
            const n = demTrongKhoang(hts, tu, den).inbox_moi;
            chiaMessTheoCamp(n, g.cs).forEach((v, i) => theoCamp.set(g.cs[i], v));
            kq.tong += n;
            await sleep(GIAN_MS);
        }
        kq.ok = true;
    } catch (e: any) { kq.loi = String(e?.message || e); }
    return kq;
}
