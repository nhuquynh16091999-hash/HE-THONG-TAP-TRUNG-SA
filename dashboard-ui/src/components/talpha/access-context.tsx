"use client";

import { createContext, useContext } from "react";

/*
 * Người đang xem (phân quyền theo team, 05/10/2026) — shell nạp MỘT lần từ /api/talpha/me
 * rồi phát xuống các tab. Chỉ dùng để HIỆN cho đúng (ẩn tab, đổi tiêu đề, giấu nút);
 * chặn thật nằm ở máy chủ (proxy.ts + route), tab có quên ẩn gì thì số vẫn không lộ.
 */
export type Me = {
    kind: "user" | "internal" | "public";
    name: string;
    email: string | null;
    role: string;
    role_label: string;
    /** Xem hết mọi nước, mọi tab, vào được Quản trị. */
    full: boolean;
    tabs: string[];
    /** Mã nước được xem ("TW", "SG", "AE"). */
    markets: string[];
    teams: { key: string; name: string; markets: string[] }[];
    public_mode: boolean;
};

const AccessContext = createContext<Me | null>(null);

export const AccessProvider = AccessContext.Provider;

export function useAccess(): Me | null {
    return useContext(AccessContext);
}

/** Tên phạm vi đang xem cho tiêu đề — "Trung Đông", "Đông Nam Á · Đông Á"; xem hết thì null. */
export function tenPhamVi(me: Me | null): string | null {
    if (!me || me.full) return null;
    return me.teams.map((t) => t.name).join(" · ") || null;
}
