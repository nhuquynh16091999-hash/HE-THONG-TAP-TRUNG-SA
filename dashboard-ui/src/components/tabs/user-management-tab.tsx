"use client";

import { useState, useEffect, useCallback } from "react";
import {
    UserPlus,
    Pencil,
    Trash2,
    X,
    Check,
    Loader2,
    Shield,
    Mail,
    Eye,
    EyeOff,
    AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface UserData {
    id: string;
    email: string;
    name: string;
    role: string;
    projects: string[];
    /** Team được xem (khoá ở talpha_rules.json → access.teams), ["*"] = mọi team. */
    teams?: string[];
    /** "pending" = đã khoá, không đăng nhập được (vd tài khoản chung cũ talpha@levelup). */
    status?: string;
}

// Dashboard chỉ phục vụ một dự án — tài khoản mới mặc định TALPHA, không thì đăng nhập
// bị chặn "không có quyền truy cập dashboard này" (api/auth/validate).
const DEFAULT_PROJECTS = ["TALPHA"];

// Vai trò + team đọc từ talpha_rules.json → access (qua /api/talpha/me), không gõ ở đây.
// Phân quyền theo team từ 05/10/2026: role quyết định THẤY TAB NÀO, team quyết định THẤY NƯỚC NÀO.
type RoleOpt = { key: string; label: string; desc: string; full: boolean };
type TeamOpt = { key: string; name: string; leader: string; markets: string[] };
const ROLE_COLOR: Record<string, string> = {
    director: "text-orange-400", admin: "text-red-400", leader: "text-violet-400",
    marketer: "text-sky-400", sale: "text-emerald-400",
};

export default function UserManagementTab() {
    const [users, setUsers] = useState<UserData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showForm, setShowForm] = useState(false);
    const [editingUser, setEditingUser] = useState<UserData | null>(null);
    const [roleOptions, setRoleOptions] = useState<RoleOpt[]>([]);
    const [teamOptions, setTeamOptions] = useState<TeamOpt[]>([]);

    // Form state
    const [formName, setFormName] = useState("");
    const [formEmail, setFormEmail] = useState("");
    const [formPassword, setFormPassword] = useState("");
    const [formRole, setFormRole] = useState<string>("leader");
    const [formProjects, setFormProjects] = useState<string[]>(DEFAULT_PROJECTS);
    const [formTeams, setFormTeams] = useState<string[]>([]);
    const [showPassword, setShowPassword] = useState(false);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState("");

    const fetchUsers = useCallback(async () => {
        try {
            const [res, me] = await Promise.all([
                fetch("/api/users"),
                fetch("/api/talpha/me").then(r => r.json()).catch(() => null),
            ]);
            if (!res.ok) throw new Error("Failed to fetch");
            setUsers(await res.json());
            setRoleOptions(me?.catalog?.roles || []);
            setTeamOptions(me?.catalog?.teams || []);
        } catch {
            setError("Không thể tải danh sách user");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const resetForm = () => {
        setFormName("");
        setFormEmail("");
        setFormPassword("");
        setFormRole("leader");
        setFormProjects(DEFAULT_PROJECTS);
        setFormTeams([]);
        setShowPassword(false);
        setFormError("");
        setEditingUser(null);
        setShowForm(false);
    };

    const openCreateForm = () => {
        resetForm();
        setShowForm(true);
    };

    const openEditForm = (user: UserData) => {
        setEditingUser(user);
        setFormName(user.name);
        setFormEmail(user.email);
        setFormPassword("");
        setFormRole(user.role);
        setFormProjects(user.projects.includes("*") ? [] : [...user.projects]);
        setFormTeams([...(user.teams || [])]);
        setFormError("");
        setShowForm(true);
    };

    const roleFull = (role: string) => !!roleOptions.find((r) => r.key === role)?.full;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError("");

        const isEditing = !!editingUser;
        const isAdminRole = formRole === "admin";
        const projectsPayload = isAdminRole ? ["*"] : (formProjects.length ? formProjects : DEFAULT_PROJECTS);
        // Không giao team thì người đó đăng nhập vào chỉ thấy màn trống — chặn ngay ở đây.
        if (!roleFull(formRole) && formTeams.length === 0) {
            setFormError("Chọn ít nhất một team cho tài khoản này");
            return;
        }
        setSaving(true);

        try {
            const body: any = {
                name: formName,
                email: formEmail,
                role: formRole,
                projects: projectsPayload,
                teams: roleFull(formRole) ? [] : formTeams,
            };

            if (isEditing) {
                body.id = editingUser.id;
                if (formPassword) body.password = formPassword;
            } else {
                if (!formPassword) {
                    setFormError("Mật khẩu là bắt buộc khi tạo user mới");
                    setSaving(false);
                    return;
                }
                body.password = formPassword;
            }

            const res = await fetch("/api/users", {
                method: isEditing ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Lỗi khi lưu");
            }

            await fetchUsers();
            resetForm();
        } catch (err: any) {
            setFormError(err.message || "Có lỗi xảy ra");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (user: UserData) => {
        if (!confirm(`Xóa user "${user.name}" (${user.email})?`)) return;
        try {
            const res = await fetch(`/api/users?id=${user.id}`, {
                method: "DELETE",
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error);
            }
            await fetchUsers();
        } catch (err: any) {
            alert(err.message || "Không thể xóa user");
        }
    };

    // "Tất cả team" ("*") loại trừ chọn lẻ — bấm team lẻ là bỏ "*", bấm "*" là bỏ team lẻ.
    const toggleTeam = (key: string) => {
        setFormTeams((prev) => {
            if (key === "*") return prev.includes("*") ? [] : ["*"];
            const bo = prev.filter((t) => t !== "*");
            return bo.includes(key) ? bo.filter((t) => t !== key) : [...bo, key];
        });
    };

    const teamText = (u: UserData) => {
        if (roleFull(u.role)) return "Tất cả (xem hết)";
        const ds = u.teams || [];
        if (ds.includes("*")) return "Tất cả team";
        return ds.map((k) => teamOptions.find((t) => t.key === k)?.name || k).join(" · ") || "— chưa giao team —";
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center py-20 text-red-400">
                <AlertCircle className="h-5 w-5 mr-2" />
                {error}
            </div>
        );
    }

    const roleLabel = (role: string) => {
        const r = roleOptions.find((x) => x.key === role);
        return r ? { label: r.label, color: ROLE_COLOR[role] || "text-slate-300" } : undefined;
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-foreground">
                        Quản lý User
                    </h2>
                    <p className="text-sm text-slate-400">
                        {users.length} user(s) trong hệ thống
                    </p>
                </div>
                <button
                    onClick={openCreateForm}
                    className="flex items-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-lg shadow-indigo-500/25"
                >
                    <UserPlus className="h-4 w-4" />
                    Thêm User
                </button>
            </div>

            {/* Users Table */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                            <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                User
                            </th>
                            <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                Vai trò
                            </th>
                            <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                Team được xem
                            </th>
                            <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                Hành động
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user) => {
                            const rLabel = roleLabel(user.role);
                            return (
                                <tr
                                    key={user.id}
                                    className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                                >
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-indigo-400 text-sm font-bold">
                                                {user.name
                                                    .charAt(0)
                                                    .toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="font-semibold text-foreground">
                                                    {user.name}
                                                    {user.status === "pending" && (
                                                        <span className="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-500">
                                                            ĐÃ KHOÁ
                                                        </span>
                                                    )}
                                                </p>
                                                <p className="text-xs text-slate-500 flex items-center gap-1">
                                                    <Mail className="h-3 w-3" />
                                                    {user.email}
                                                </p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <span
                                            className={cn(
                                                "flex items-center gap-1.5 text-xs font-medium",
                                                rLabel?.color
                                            )}
                                        >
                                            <Shield className="h-3.5 w-3.5" />
                                            {rLabel?.label || user.role}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4">
                                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                                            {teamText(user)}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4 text-right">
                                        <div className="flex items-center justify-end gap-1.5">
                                            <button
                                                onClick={() =>
                                                    openEditForm(user)
                                                }
                                                className="p-2 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-indigo-400 transition-colors"
                                                title="Sửa"
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={() =>
                                                    handleDelete(user)
                                                }
                                                className="p-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
                                                title="Xóa"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Create/Edit Form Modal */}
            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-lg mx-4 rounded-2xl bg-[#24211C] border border-white/10 shadow-2xl">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
                            <h3 className="text-lg font-bold text-white">
                                {editingUser
                                    ? `Sửa: ${editingUser.name}`
                                    : "Thêm User Mới"}
                            </h3>
                            <button
                                onClick={resetForm}
                                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
                            {formError && (
                                <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                    {formError}
                                </div>
                            )}

                            {/* Name */}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                                    Họ tên
                                </label>
                                <input
                                    type="text"
                                    value={formName}
                                    onChange={(e) => setFormName(e.target.value)}
                                    required
                                    className="w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                                    placeholder="Nguyễn Văn A"
                                />
                            </div>

                            {/* Email */}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                                    Tên đăng nhập
                                </label>
                                <input
                                    type="text"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    value={formEmail}
                                    onChange={(e) =>
                                        setFormEmail(e.target.value)
                                    }
                                    required
                                    className="w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                                    placeholder="vd: loc (gõ ở ô Tên đăng nhập lúc vào dashboard)"
                                />
                            </div>

                            {/* Password */}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                                    Mật khẩu{" "}
                                    {editingUser && (
                                        <span className="text-slate-500 font-normal">
                                            (để trống nếu không đổi)
                                        </span>
                                    )}
                                </label>
                                <div className="relative">
                                    <input
                                        type={
                                            showPassword ? "text" : "password"
                                        }
                                        value={formPassword}
                                        onChange={(e) =>
                                            setFormPassword(e.target.value)
                                        }
                                        required={!editingUser}
                                        className="w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 pr-10 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                                        placeholder="••••••••"
                                    />
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowPassword(!showPassword)
                                        }
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                                    >
                                        {showPassword ? (
                                            <EyeOff className="h-4 w-4" />
                                        ) : (
                                            <Eye className="h-4 w-4" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Role */}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                                    Vai trò
                                </label>
                                <div className="grid grid-cols-3 gap-2">
                                    {roleOptions.map((opt) => (
                                        <button
                                            key={opt.key}
                                            type="button"
                                            onClick={() =>
                                                setFormRole(opt.key)
                                            }
                                            className={cn(
                                                "rounded-xl border px-3 py-2.5 text-left transition-all",
                                                formRole === opt.key
                                                    ? "border-indigo-500/50 bg-indigo-500/10"
                                                    : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
                                            )}
                                        >
                                            <p
                                                className={cn(
                                                    "text-xs font-semibold",
                                                    ROLE_COLOR[opt.key] || "text-slate-300"
                                                )}
                                            >
                                                {opt.label}
                                            </p>
                                            <p className="text-[10px] text-slate-500 mt-0.5">
                                                {opt.desc}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Team — quyết định thấy NƯỚC nào. Giám đốc/admin xem hết, không cần chọn. */}
                            {!roleFull(formRole) && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                                        Team được xem
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {[...teamOptions.map((t) => ({ key: t.key, label: `${t.name} (${t.markets.join(", ")})`, hint: t.leader ? `Leader: ${t.leader}` : "" })),
                                          { key: "*", label: "Tất cả team", hint: "Mọi nước, kể cả nước mở thêm sau này" }].map((t) => (
                                            <button
                                                key={t.key}
                                                type="button"
                                                title={t.hint}
                                                onClick={() => toggleTeam(t.key)}
                                                className={cn(
                                                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                                                    formTeams.includes(t.key)
                                                        ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-400"
                                                        : "border-white/[0.08] text-slate-400 hover:bg-white/[0.04]"
                                                )}
                                            >
                                                {formTeams.includes(t.key) && (
                                                    <Check className="h-3 w-3 inline mr-1" />
                                                )}
                                                {t.label}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="mt-1.5 text-[11px] text-slate-500">
                                        Chỉ thấy số của nước thuộc team đã chọn — team khác không hiện ở bất kỳ tab nào.
                                    </p>
                                </div>
                            )}

                            {/* Submit */}
                            <div className="flex items-center justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                                >
                                    Hủy
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-sm font-semibold text-white transition-colors disabled:opacity-50 shadow-lg shadow-indigo-500/25"
                                >
                                    {saving ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Check className="h-4 w-4" />
                                    )}
                                    {editingUser ? "Cập nhật" : "Tạo User"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
