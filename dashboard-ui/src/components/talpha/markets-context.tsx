"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { setMarkets, type MarketPublic } from "./utils";

/*
 * Ba thị trường (Đài Loan · Singapore · UAE), nạp MỘT lần từ /api/talpha/markets.
 *
 * Tab nào đổi mã nước ra tên, dựng câu SQL tách chi tiêu theo nước, hay quy tiền về
 * VND thì đọc từ đây — không gõ bảng riêng. `loaded` để tab chờ có danh sách rồi mới
 * tính, khỏi hiện mã "SG" trần hay nhét chi tiêu Singapore vào nhóm lạ.
 */
type MarketsState = { loaded: boolean; primary: string | null; markets: MarketPublic[] };

const MarketsContext = createContext<MarketsState>({ loaded: false, primary: null, markets: [] });

export function MarketsProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<MarketsState>({ loaded: false, primary: null, markets: [] });
    useEffect(() => {
        let dung = false;
        fetch("/api/talpha/markets")
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((d: { primary: string | null; markets: MarketPublic[] }) => {
                if (dung) return;
                setMarkets(d.markets || []);
                setState({ loaded: true, primary: d.primary ?? null, markets: d.markets || [] });
            })
            .catch(() => { if (!dung) setState((s) => ({ ...s, loaded: true })); });
        return () => { dung = true; };
    }, []);
    return <MarketsContext.Provider value={state}>{children}</MarketsContext.Provider>;
}

export function useMarkets(): MarketsState {
    return useContext(MarketsContext);
}

/**
 * SQL BigQuery gán nước cho một dòng chi tiêu từ tên campaign — cùng luật với
 * campaignMarket() ở rules.ts: ô ĐẦU TIÊN là mã nước thắng; không ghi nước → nước chính.
 */
export function sqlMarketFromCampaign(markets: MarketPublic[], primary: string | null, col = "campaign_name"): string {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const pairs = markets.flatMap((m) => m.tokens.map((t) => [t.toUpperCase(), m.code] as const));
    const primaryCode = markets.find((m) => m.key === primary)?.code || "Other";
    if (!pairs.length) return q(primaryCode);
    return `COALESCE((
        SELECT CASE UPPER(TRIM(seg)) ${pairs.map(([t, c]) => `WHEN ${q(t)} THEN ${q(c)}`).join(" ")} END
        FROM UNNEST(SPLIT(${col}, '/')) AS seg WITH OFFSET AS vi_tri
        WHERE UPPER(TRIM(seg)) IN (${pairs.map(([t]) => q(t)).join(", ")})
        ORDER BY vi_tri LIMIT 1
    ), ${q(primaryCode)})`;
}
