/**
 * Máy khách 17TRACK — chỉ hai việc: đăng ký mã vận đơn, và hỏi trạng thái.
 *
 * ⚠️ TIỀN: `register` TỐN QUOTA, mỗi mã một lần. `getTrackInfo` MIỄN PHÍ, gọi bao
 * nhiêu lần cũng được. Nên tầng gọi phải tra sổ đăng ký trước, tuyệt đối không
 * đăng ký lại mã đã đăng ký — đó là cách đốt tiền mà không ai nhìn thấy.
 *
 * Giới hạn của 17TRACK: 40 mã mỗi lượt gọi, 3 lượt mỗi giây, quá thì trả 429.
 * Hàm dưới tự cắt lô và tự giãn nhịp.
 *
 * Khoá API đọc từ biến môi trường, KHÔNG khai trong rules file. Chạy được NHIỀU khoá
 * (nhiều tài khoản 17TRACK, cộng quota): TRACK17_API_KEY, TRACK17_API_KEY_2,
 * TRACK17_API_KEY_3… Mã đăng ký bằng khoá nào thì CHỈ khoá đó hỏi được — nên mọi
 * hàm dưới nhận khoá làm tham số, và sổ đăng ký ghi mã nào thuộc khoá nào.
 */
import { createHash } from "crypto";
import { TRACK_CFG, chunk, carrierFor } from "./tracking";

export type RegisterResult = {
    accepted: { number: string; carrier: number }[];
    rejected: { number: string; code: number; message: string }[];
};

export type TrackInfo = {
    number: string;
    carrier: number | null;
    status: string | null;
    sub_status: string | null;
    /** Lúc đơn vào trạng thái hiện tại theo 17TRACK (mốc milestone) — gốc đếm hạn lấy hàng. */
    status_time: string | null;
    last_event_time: string | null;
    last_event: string | null;
};

export type Quota = { total: number; used: number; remain: number; today_used: number };

/** Mã lỗi từng mã của 17TRACK v2.4 (nằm trong data.rejected[].error.code). */
export const ERR_ALREADY_REGISTERED = -18019901;   // đã đăng ký rồi — KHÔNG trừ quota
export const ERR_QUOTA_OUT = -18019908;            // hết quota

export type TrackInfoResult = {
    found: TrackInfo[];
    rejected: { number: string; code: number; message: string }[];
};

export class Track17Error extends Error {
    /** Phần đã xong trước khi hỏng (các lô trước) — quota của chúng đã bị trừ. */
    partial?: unknown;
    constructor(message: string, readonly code?: number) {
        super(message);
        this.name = "Track17Error";
    }
}

/**
 * Một khoá 17TRACK. `id` = 8 ký tự đầu của sha256(khoá) — ghi vào sổ đăng ký để biết
 * mã nào thuộc khoá nào mà KHÔNG lưu khoá thật ra data/. `label` để in cho người đọc.
 */
export type ApiKey = { id: string; label: string; key: string };

export const keyId = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 8);

/**
 * Mọi khoá đang khai, theo thứ tự: TRACK17_API_KEY rồi TRACK17_API_KEY_2, _3…
 * Hai biến cùng một khoá thì chỉ tính một (đăng ký hai lần vào một tài khoản là
 * tự báo "đã đăng ký" — không hỏng, nhưng đếm quota sai gấp đôi).
 */
export function apiKeys(env: Record<string, string | undefined> = process.env): ApiKey[] {
    const names = Object.keys(env)
        .map((n) => ({ n, m: /^TRACK17_API_KEY(?:_(\d+))?$/.exec(n) }))
        .filter((x) => x.m && String(env[x.n] || "").trim())
        .sort((a, b) => Number(a.m![1] || 1) - Number(b.m![1] || 1));
    const out: ApiKey[] = [];
    for (const { n } of names) {
        const key = String(env[n]).trim().replace(/^["']|["']$/g, "");
        const id = keyId(key);
        if (out.some((k) => k.id === id)) continue;
        out.push({ id, label: `khoá ${out.length + 1}`, key });
    }
    return out;
}

export function hasApiKey(): boolean {
    return apiKeys().length > 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(k: ApiKey, path: string, body: unknown): Promise<{ code: number; data?: Record<string, unknown> }> {
    const res = await fetch(`${TRACK_CFG.api_base}/${path}`, {
        method: "POST",
        headers: { "17token": k.key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (res.status === 429) {
        throw new Track17Error(`17TRACK chặn ${k.label} vì gọi quá nhanh (429) — thử lại sau ít phút.`, 429);
    }
    if (!res.ok) {
        throw new Track17Error(`17TRACK trả HTTP ${res.status} cho ${k.label}`, res.status);
    }

    const json = await res.json().catch(() => null);
    if (!json || typeof json !== "object") {
        throw new Track17Error("17TRACK trả về nội dung không đọc được");
    }
    const code = Number((json as { code?: unknown }).code ?? -1);
    // code khác 0 là lỗi cấp lệnh gọi (sai khoá, hết quota…), khác với lỗi
    // từng mã nằm trong data.rejected.
    if (code !== 0) {
        const msg = String((json as { message?: unknown; data?: unknown }).message ?? "");
        throw new Track17Error(`17TRACK báo lỗi ${code} ở ${k.label}${msg ? ` — ${msg}` : ""}`, code);
    }
    return json as { code: number; data?: Record<string, unknown> };
}

/** Gọi lần lượt từng lô, giãn nhịp cho khỏi chạm trần 3 lượt/giây. */
async function batched<T>(k: ApiKey, items: string[], path: string, build: (n: string) => unknown,
                          parse: (data: Record<string, unknown>) => T, merge: (a: T, b: T) => T,
                          empty: T): Promise<T> {
    let acc = empty;
    const lots = chunk(items);
    const gap = Math.ceil(1000 / TRACK_CFG.rate_limit_per_sec);
    for (let i = 0; i < lots.length; i++) {
        if (i > 0) await sleep(gap);
        try {
            const { data } = await call(k, path, lots[i].map(build));
            acc = merge(acc, parse(data || {}));
        } catch (e) {
            // Lô 3 hỏng thì lô 1–2 vẫn đã xong (đăng ký = đã trừ quota) — trả kèm để bên
            // gọi ghi sổ, không thì lượt sau đem đi đăng ký lại ở một khoá KHÁC.
            if (e instanceof Track17Error) e.partial = acc;
            throw e;
        }
    }
    return acc;
}

const asArray = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

const errOf = (r: Record<string, unknown>) => {
    const e = (r.error || {}) as { code?: unknown; message?: unknown };
    return { code: Number(e.code ?? -1), message: String(e.message ?? "không rõ lý do") };
};

/**
 * ⚠️ TỐN QUOTA — mỗi mã một lần. Kiểm sổ đăng ký TRƯỚC khi gọi.
 * `tags` gắn mã đơn vào từng mã (tối đa 100 ký tự) để tra ngược trên trang 17TRACK.
 */
export async function register(
    k: ApiKey, numbers: string[], tags: Record<string, string> = {}, market: string = "TW",
): Promise<RegisterResult> {
    if (!numbers.length) return { accepted: [], rejected: [] };
    return batched<RegisterResult>(
        k, numbers, "register",
        (n) => ({
            number: n,
            ...(carrierFor(n, market) ? { carrier: carrierFor(n, market) } : { auto_detection: true }),
            ...(tags[n] ? { tag: tags[n].slice(0, 100) } : {}),
        }),
        (data) => ({
            accepted: asArray(data.accepted).map((r) => ({
                number: String(r.number ?? ""),
                carrier: Number(r.carrier ?? 0),
            })),
            rejected: asArray(data.rejected).map((r) => ({ number: String(r.number ?? ""), ...errOf(r) })),
        }),
        (a, b) => ({ accepted: [...a.accepted, ...b.accepted], rejected: [...a.rejected, ...b.rejected] }),
        { accepted: [], rejected: [] },
    );
}

/** Miễn phí — gọi bao nhiêu lần cũng không trừ quota. */
export async function getTrackInfo(k: ApiKey, numbers: string[]): Promise<TrackInfoResult> {
    if (!numbers.length) return { found: [], rejected: [] };
    return batched<TrackInfoResult>(
        k, numbers, "gettrackinfo",
        (n) => ({ number: n }),
        (data) => ({
            found: asArray(data.accepted).map(parseTrackInfo),
            rejected: asArray(data.rejected).map((r) => ({ number: String(r.number ?? ""), ...errOf(r) })),
        }),
        (a, b) => ({ found: [...a.found, ...b.found], rejected: [...a.rejected, ...b.rejected] }),
        { found: [], rejected: [] },
    );
}

const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

/**
 * Đọc một mã trong kết quả gettrackinfo v2.4. Tên trường theo tài liệu v2.4:
 * latest_event có time_utc / time_iso / description / location — KHÔNG có `time` và
 * `content` (tên của bản API cũ; đọc theo tên cũ là mọi sự kiện đều ra trống).
 */
export function parseTrackInfo(r: Record<string, unknown>): TrackInfo {
    const ti = (r.track_info || {}) as Record<string, unknown>;
    const ls = (ti.latest_status || {}) as { status?: unknown; sub_status?: unknown };
    const le = (ti.latest_event || {}) as Record<string, unknown>;
    const status = str(ls.status);
    // Mốc vào trạng thái hiện tại: milestone cùng tên (vd. AvailableForPickup = lúc hàng
    // tới cửa hàng). Không có thì lấy mốc sự kiện mới nhất.
    const ms = Array.isArray(ti.milestone) ? (ti.milestone as Record<string, unknown>[]) : [];
    const hit = ms.find((m) => m.key_stage === status && (m.time_utc || m.time_iso));
    const evTime = str(le.time_utc) ?? str(le.time_iso);
    const desc = str(le.description);
    const loc = str(le.location);
    return {
        number: String(r.number ?? ""),
        carrier: r.carrier === undefined || r.carrier === null ? null : Number(r.carrier),
        status,
        sub_status: str(ls.sub_status),
        status_time: (hit ? str(hit.time_utc) ?? str(hit.time_iso) : null) ?? evTime,
        last_event_time: evTime,
        last_event: desc ? (loc && !desc.includes(loc) ? `${desc} · ${loc}` : desc) : null,
    };
}

/** Quota còn lại — miễn phí, không trừ gì. */
export async function getQuota(k: ApiKey): Promise<Quota> {
    const { data } = await call(k, "getquota", []);
    const d = data || {};
    return {
        total: Number(d.quota_total ?? 0),
        used: Number(d.quota_used ?? 0),
        remain: Number(d.quota_remain ?? 0),
        today_used: Number(d.today_used ?? 0),
    };
}

/**
 * Đổi hãng cho mã ĐÃ đăng ký (17TRACK đoán nhầm hãng). Không đăng ký lại, không trừ
 * quota; 17TRACK cho đổi tối đa 5 lần mỗi mã.
 */
export async function changeCarrier(
    k: ApiKey, items: { number: string; carrier_old: number; carrier_new: number }[],
): Promise<RegisterResult> {
    if (!items.length) return { accepted: [], rejected: [] };
    const byNumber = new Map(items.map((x) => [x.number, x]));
    return batched<RegisterResult>(
        k, items.map((x) => x.number), "changecarrier",
        (n) => byNumber.get(n),
        (data) => ({
            accepted: asArray(data.accepted).map((r) => ({
                number: String(r.number ?? ""),
                carrier: Number(r.carrier ?? r.carrier_new ?? 0),
            })),
            rejected: asArray(data.rejected).map((r) => ({ number: String(r.number ?? ""), ...errOf(r) })),
        }),
        (a, b) => ({ accepted: [...a.accepted, ...b.accepted], rejected: [...a.rejected, ...b.rejected] }),
        { accepted: [], rejected: [] },
    );
}

/**
 * Chia danh sách mã (đã xếp gấp nhất trước) cho các khoá theo quota còn lại. Khoá còn
 * nhiều quota nhận trước; khoá không biết quota (hỏi hỏng — thường là khoá chết) thì
 * không giao việc. Mã không chia được cho ai thì nằm lại cho lượt sau.
 */
export function allocateToKeys<T>(items: T[], keys: { id: string; remain: number | null }[]): Map<string, T[]> {
    const out = new Map<string, T[]>();
    let i = 0;
    const order = keys.filter((k) => k.remain != null && k.remain > 0)
        .sort((a, b) => (b.remain as number) - (a.remain as number));
    for (const k of order) {
        const take = items.slice(i, i + (k.remain as number));
        if (take.length) out.set(k.id, take);
        i += take.length;
        if (i >= items.length) break;
    }
    return out;
}
