"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Sparkles, Send, Loader2, ChevronDown, Database } from "lucide-react";
import { cn } from "./utils";

interface Props {
    dateRange?: { from: Date; to: Date };
}

export default function CeoAssistant({ dateRange }: Props) {
    const [question, setQuestion] = useState("");
    const [loading, setLoading] = useState(false);
    const [answer, setAnswer] = useState("");
    const [queries, setQueries] = useState<string[]>([]);
    const [error, setError] = useState("");
    const [showSql, setShowSql] = useState(false);

    const ask = async (q?: string) => {
        const query = (q ?? question).trim();
        if (!query || loading) return;
        setLoading(true); setError(""); setAnswer(""); setQueries([]);
        try {
            const res = await fetch("/api/talpha/ceo-ask", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    question: query,
                    from: dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : undefined,
                    to: dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) setError(data.error || "Có lỗi xảy ra");
            else { setAnswer(data.answer || ""); setQueries(data.queries || []); }
        } catch (e: any) {
            setError(e?.message || "Không gọi được API");
        } finally { setLoading(false); }
    };

    const suggestions = [
        "Marketer nào ROAS cao nhất?",
        "Market nào đang lỗ?",
        "So sánh doanh thu UAE vs Saudi",
        "Ngày nào doanh thu cao nhất tháng này?",
    ];

    return (
        <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-indigo-500" /> Hỏi dashboard
                <span className="text-[11px] font-normal text-muted-foreground">— hỏi bất kỳ điều gì về số liệu, AI truy vấn dữ liệu và trả lời</span>
            </div>
            <div className="flex gap-2">
                <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                    placeholder="VD: Marketer nào lãi cao nhất tháng này? Market nào nên scale?"
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
                <button
                    onClick={() => ask()}
                    disabled={loading || !question.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Hỏi
                </button>
            </div>

            {/* Suggestion chips */}
            {!answer && !loading && !error && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                        <button key={s} onClick={() => { setQuestion(s); ask(s); }}
                            className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted">
                            {s}
                        </button>
                    ))}
                </div>
            )}

            {error && <div className="mt-3 rounded-lg border border-rose-300/60 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</div>}

            {answer && (
                <div className="mt-3 space-y-2">
                    <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground">{answer}</div>
                    {queries.length > 0 && (
                        <div>
                            <button onClick={() => setShowSql((v) => !v)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                                <Database className="h-3 w-3" /> {queries.length} truy vấn đã chạy
                                <ChevronDown className={cn("h-3 w-3 transition-transform", showSql && "rotate-180")} />
                            </button>
                            {showSql && (
                                <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-border bg-card p-2 text-[10px] leading-relaxed text-muted-foreground">{queries.join("\n\n— — —\n\n")}</pre>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
