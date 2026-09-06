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
 * Khoá API đọc từ biến môi trường TRACK17_API_KEY, KHÔNG khai trong rules file.
 */
import { TRACK_CFG, chunk } from "./tracking";

export type RegisterResult = {
    accepted: { number: string; carrier: number }[];
    rejected: { number: string; code: number; message: string }[];
};

export type TrackInfo = {
    number: string;
    carrier: number | null;
    status: string | null;
    sub_status: string | null;
    last_event_time: string | null;
    last_event: string | null;
};

export type TrackInfoResult = {
    found: TrackInfo[];
    rejected: { number: string; code: number; message: string }[];
};

export class Track17Error extends Error {
    constructor(message: string, readonly code?: number) {
        super(message);
        this.name = "Track17Error";
    }
}

export function hasApiKey(): boolean {
    return !!process.env.TRACK17_API_KEY;
}

function apiKey(): string {
    const k = process.env.TRACK17_API_KEY;
    if (!k) {
        throw new Track17Error(
            "Chưa có khoá 17TRACK. Lấy khoá ở 17track.net/en/api rồi điền " +
            "TRACK17_API_KEY vào dashboard-ui/.env.local.",
        );
    }
    return k;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string, body: unknown): Promise<{ code: number; data?: Record<string, unknown> }> {
    const res = await fetch(`${TRACK_CFG.api_base}/${path}`, {
        method: "POST",
        headers: { "17token": apiKey(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (res.status === 429) {
        throw new Track17Error("17TRACK chặn vì gọi quá nhanh (429) — thử lại sau ít phút.", 429);
    }
    if (!res.ok) {
        throw new Track17Error(`17TRACK trả HTTP ${res.status}`, res.status);
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
        throw new Track17Error(`17TRACK báo lỗi ${code}${msg ? ` — ${msg}` : ""}`, code);
    }
    return json as { code: number; data?: Record<string, unknown> };
}

/** Gọi lần lượt từng lô, giãn nhịp cho khỏi chạm trần 3 lượt/giây. */
async function batched<T>(items: string[], path: string, build: (n: string) => unknown,
                          parse: (data: Record<string, unknown>) => T, merge: (a: T, b: T) => T,
                          empty: T): Promise<T> {
    let acc = empty;
    const lots = chunk(items);
    const gap = Math.ceil(1000 / TRACK_CFG.rate_limit_per_sec);
    for (let i = 0; i < lots.length; i++) {
        if (i > 0) await sleep(gap);
        const { data } = await call(path, lots[i].map(build));
        acc = merge(acc, parse(data || {}));
    }
    return acc;
}

const asArray = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

const errOf = (r: Record<string, unknown>) => {
    const e = (r.error || {}) as { code?: unknown; message?: unknown };
    return { code: Number(e.code ?? -1), message: String(e.message ?? "không rõ lý do") };
};

/** ⚠️ TỐN QUOTA — mỗi mã một lần. Kiểm sổ đăng ký TRƯỚC khi gọi. */
export async function register(numbers: string[]): Promise<RegisterResult> {
    if (!numbers.length) return { accepted: [], rejected: [] };
    return batched<RegisterResult>(
        numbers, "register",
        (n) => TRACK_CFG.carrier
            ? { number: n, carrier: TRACK_CFG.carrier }
            : { number: n, auto_detection: true },
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
export async function getTrackInfo(numbers: string[]): Promise<TrackInfoResult> {
    if (!numbers.length) return { found: [], rejected: [] };
    return batched<TrackInfoResult>(
        numbers, "gettrackinfo",
        (n) => ({ number: n }),
        (data) => ({
            found: asArray(data.accepted).map((r) => {
                const ti = (r.track_info || {}) as Record<string, unknown>;
                const ls = (ti.latest_status || {}) as { status?: unknown; sub_status?: unknown };
                const le = (ti.latest_event || {}) as { time?: unknown; content?: unknown };
                return {
                    number: String(r.number ?? ""),
                    carrier: r.carrier === undefined ? null : Number(r.carrier),
                    status: ls.status ? String(ls.status) : null,
                    sub_status: ls.sub_status ? String(ls.sub_status) : null,
                    last_event_time: le.time ? String(le.time) : null,
                    last_event: le.content ? String(le.content) : null,
                };
            }),
            rejected: asArray(data.rejected).map((r) => ({ number: String(r.number ?? ""), ...errOf(r) })),
        }),
        (a, b) => ({ found: [...a.found, ...b.found], rejected: [...a.rejected, ...b.rejected] }),
        { found: [], rejected: [] },
    );
}
