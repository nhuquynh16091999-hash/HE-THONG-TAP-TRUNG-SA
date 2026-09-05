import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { bigquery } from "@/lib/bigquery";
import { buildSystemPrompt } from "@/lib/talpha/ceo-ask-prompt";
import { checkSql, cleanSql } from "@/lib/talpha/ceo-ask-sql";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || process.env.NEXT_PUBLIC_DATASET || "TALPHA_Dataset";
// Google Gemini (free tier). Chuỗi model fallback: thử model mạnh trước, hết quota
// (429) thì tự rớt xuống model nhẹ hơn. Override bằng TALPHA_AI_MODEL (phẩy ngăn cách).
// 2.5-flash = SQL tốt nhất; flash-lite = quota cao, đỡ khi 2.5-flash hết hạn mức.
const MODELS = (process.env.TALPHA_AI_MODEL || "gemini-2.5-flash,gemini-2.0-flash")
    .split(",").map((s) => s.trim()).filter(Boolean);
const MAX_SQL_CALLS = 4;
const ROW_CAP = 200;

// SQL safety (SELECT/WITH only, 1 câu, đúng dataset) + gỡ nháy thừa: xem
// lib/talpha/ceo-ask-sql.ts — dùng chung với prompt builder.

async function runSql(rawSql: string): Promise<{ rows?: any[]; error?: string }> {
    const sql = cleanSql(rawSql);
    const safe = checkSql(sql, { project: BQ_PROJECT, dataset: BQ_DATASET });
    if (!safe.ok) return { error: `Query blocked: ${safe.reason}` };
    // Bound result size if the model forgot a LIMIT.
    const limited = /\blimit\b/i.test(sql) ? sql : `${sql.trim()}\nLIMIT ${ROW_CAP}`;
    try {
        const [rows] = await bigquery.query({ query: limited, maximumBytesBilled: "2000000000" });
        const serial = (rows as any[]).slice(0, ROW_CAP).map((r) => {
            const o: Record<string, any> = {};
            for (const [k, v] of Object.entries(r)) {
                o[k] = v !== null && typeof v === "object" && "value" in (v as any) ? (v as any).value : v;
            }
            return o;
        });
        return { rows: serial };
    } catch (e: any) {
        return { error: e?.message || String(e) };
    }
}

// System prompt SINH TỰ ĐỘNG từ config/talpha_rules.json (A5) — đừng chép rule
// bằng tay vào đây nữa, sửa rule là sửa JSON. Xem lib/talpha/ceo-ask-prompt.ts.
function systemPrompt(from: string, to: string): string {
    return buildSystemPrompt(from, to, { project: BQ_PROJECT, dataset: BQ_DATASET });
}

// Free tier Gemini thỉnh thoảng trả 503 UNAVAILABLE / 429 (quá tải) — retry với
// backoff để người dùng không thấy lỗi tạm thời.
function isTransient(e: any): boolean {
    const m = String(e?.message || e);
    return /\b503\b|UNAVAILABLE|overloaded|high demand|\b429\b|RESOURCE_EXHAUSTED|rate.?limit/i.test(m);
}
async function genWithRetry(ai: GoogleGenAI, params: any, tries = 4): Promise<any> {
    let lastErr: any;
    for (let attempt = 0; attempt < tries; attempt++) {
        try {
            return await ai.models.generateContent(params);
        } catch (e: any) {
            lastErr = e;
            if (!isTransient(e) || attempt === tries - 1) throw e;
            await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt))); // 0.6s, 1.2s, 2.4s
        }
    }
    throw lastErr;
}

const TOOLS = [
    {
        functionDeclarations: [
            {
                name: "run_sql",
                description: "Chạy 1 câu truy vấn BigQuery (chỉ SELECT/WITH) trên dataset TALPHA và trả về tối đa 200 dòng kết quả dạng JSON. Dùng để lấy số liệu trả lời câu hỏi.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        sql: { type: Type.STRING, description: "Câu SELECT hợp lệ, có tên bảng đầy đủ `project.dataset.table`." },
                    },
                    required: ["sql"],
                },
            },
        ],
    },
];

// Chạy agent text-to-SQL với 1 model cụ thể. Trả về câu trả lời + các SQL đã chạy.
// Throw nếu model lỗi (transient/quota) để POST fallback sang model kế tiếp.
async function runAgent(ai: GoogleGenAI, model: string, question: string, from: string, to: string): Promise<{ answer: string; queries: string[] }> {
    const sys = systemPrompt(from, to);
    const contents: any[] = [{ role: "user", parts: [{ text: question }] }];
    const queriesRun: string[] = [];
    let answer = "";

    for (let i = 0; i < MAX_SQL_CALLS + 1; i++) {
        const resp = await genWithRetry(ai, {
            model,
            contents,
            config: {
                systemInstruction: sys,
                tools: TOOLS,
                // Lượt đầu: ÉP gọi run_sql (mode ANY) để model yếu (flash-lite) không
                // hỏi lại mà query ngay. Các lượt sau: AUTO để model tự chốt câu trả lời.
                toolConfig: { functionCallingConfig: { mode: i === 0 ? "ANY" : "AUTO" } },
                temperature: 0,
                maxOutputTokens: 8192,
            },
        });

        const calls = resp.functionCalls;
        if (!calls || calls.length === 0) {
            answer = (resp.text || "").trim();
            break;
        }

        // Append the model's function-call turn, then the tool results, and loop.
        const modelParts = resp.candidates?.[0]?.content?.parts || calls.map((c: any) => ({ functionCall: c }));
        contents.push({ role: "model", parts: modelParts });

        const responseParts: any[] = [];
        for (const call of calls) {
            const sql = cleanSql(String((call.args as any)?.sql || ""));
            queriesRun.push(sql);
            let resultStr: string;
            if (queriesRun.length > MAX_SQL_CALLS) {
                resultStr = "Đã đạt giới hạn số truy vấn. Hãy trả lời với dữ liệu đã có.";
            } else {
                const r = await runSql(sql);
                resultStr = r.error ? `Lỗi: ${r.error}` : JSON.stringify(r.rows);
            }
            responseParts.push({
                functionResponse: {
                    name: call.name || "run_sql",
                    response: { result: resultStr },
                },
            });
        }
        contents.push({ role: "user", parts: responseParts });
    }

    // Nếu model vẫn đòi gọi tool khi đã hết hạn mức query → ép 1 lượt KHÔNG tool
    // để nó tổng hợp đáp án từ dữ liệu đã thu thập (tránh rơi vào câu fallback).
    if (!answer) {
        const finalResp = await genWithRetry(ai, {
            model,
            contents,
            config: { systemInstruction: sys, temperature: 0, maxOutputTokens: 8192 },
        });
        answer = (finalResp.text || "").trim();
    }

    return { answer, queries: queriesRun };
}

export async function POST(request: Request) {
    try {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "GEMINI_API_KEY chưa cấu hình. Lấy key MIỄN PHÍ tại aistudio.google.com/apikey rồi thêm vào dashboard-ui/.env.local và restart pm2." },
                { status: 400 }
            );
        }
        const { question, from, to } = await request.json();
        if (!question || !String(question).trim()) {
            return NextResponse.json({ error: "Thiếu câu hỏi" }, { status: 400 });
        }
        const fromDate = from || "2026-01-01";
        const toDate = to || new Date().toISOString().slice(0, 10);
        const q = String(question).trim();

        const ai = new GoogleGenAI({ apiKey });

        // Fallback chain: thử lần lượt từng model; hết quota/quá tải (transient) thì
        // sang model kế. Lỗi thật (vd network) thì ném ngay ra ngoài.
        let result: { answer: string; queries: string[] } | null = null;
        let usedModel = MODELS[0];
        let lastErr: any;
        for (const model of MODELS) {
            try {
                result = await runAgent(ai, model, q, fromDate, toDate);
                usedModel = model;
                break;
            } catch (e: any) {
                lastErr = e;
                if (!isTransient(e)) throw e;
                console.warn(`ceo-ask: model ${model} hết quota/quá tải, thử model kế tiếp`);
            }
        }
        if (!result) throw lastErr || new Error("Không model nào khả dụng");

        const answer = result.answer || "Xin lỗi, tôi chưa lấy được câu trả lời. Thử hỏi lại cụ thể hơn nhé.";
        return NextResponse.json({ answer, queries: result.queries, model: usedModel });
    } catch (e: any) {
        console.error("ceo-ask error", e);
        if (isTransient(e)) {
            const m = String(e?.message || e);
            const daily = /PerDay|free_tier|RESOURCE_EXHAUSTED/i.test(m);
            return NextResponse.json(
                {
                    error: daily
                        ? "Đã hết hạn mức Gemini free tier hôm nay (~20 lượt/model/ngày). Quota reset theo ngày — thử lại sau, hoặc dùng API key trả phí để không giới hạn."
                        : "Gemini đang quá tải, thử hỏi lại sau vài giây.",
                },
                { status: 503 }
            );
        }
        return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
    }
}
