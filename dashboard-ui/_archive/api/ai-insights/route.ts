import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export async function POST(req: Request) {
    try {
        const { dataContext } = await req.json();

        // Check Gemini API key
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "GEMINI_API_KEY chưa được cấu hình. Vui lòng thêm key vào file .env.local" },
                { status: 400 }
            );
        }

        if (!dataContext || dataContext.trim().length === 0) {
            return NextResponse.json(
                { error: "Không có dữ liệu để phân tích. Vui lòng đợi dashboard load xong." },
                { status: 400 }
            );
        }

        // Call Gemini with the pre-built data context from the frontend
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: dataContext,
            config: {
                systemInstruction: `Bạn là AI business analyst cho dự án T1 — bán sản phẩm chăm sóc tóc (MK01TITANIUM) qua Facebook Ads vào thị trường EU (Slovakia, Romania).

Hãy phân tích dữ liệu và trả về ĐÚNG FORMAT JSON sau (không markdown, không code block):
{
  "summary": "Tóm tắt 2-3 câu về tình hình kinh doanh",
  "observations": ["Điểm đáng chú ý 1", "Điểm 2", "Điểm 3"],
  "actions": ["Đề xuất hành động 1", "Đề xuất 2", "Đề xuất 3"],
  "risks": ["Rủi ro 1", "Rủi ro 2"],
  "score": 65
}

Trong đó:
- summary: Tóm tắt ngắn gọn
- observations: 3-5 điểm đáng chú ý (dùng số liệu cụ thể)
- actions: 3-5 đề xuất hành động cụ thể, thực tế
- risks: 1-3 cảnh báo rủi ro
- score: Điểm sức khỏe kinh doanh 0-100

Viết bằng tiếng Việt, dùng emoji phù hợp.`,
                temperature: 0.3,
            },
        });

        let insights;
        try {
            const text = response.text?.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim() || "{}";
            insights = JSON.parse(text);
        } catch {
            insights = {
                summary: response.text || "Không thể phân tích",
                observations: [],
                actions: [],
                risks: [],
                score: 50,
            };
        }

        return NextResponse.json({ insights });
    } catch (error: any) {
        console.error("AI Insights error:", error);
        return NextResponse.json({ error: error.message || "AI analysis failed" }, { status: 500 });
    }
}
