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
    role: "admin" | "project_lead" | "viewer";
    projects: string[];
}

const ALL_PROJECTS = [
    "TALPHA",
];

const ROLE_OPTIONS = [
    { value: "admin", label: "Admin", desc: "Toàn quyền", color: "text-red-400" },
    {
        value: "project_lead",
        label: "Project Lead",
        desc: "Xem project được gán",
        color: "text-amber-400",
    },
    {
        value: "viewer",
        label: "Viewer",
        desc: "Chỉ xem project được gán",
        color: "text-slate-400",
    },
];

export default function UserManagementTab() {
    const [users, setUsers] = useState<UserData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showForm, setShowForm] = useState(false);
    const [editingUser, setEditingUser] = useState<UserData | null>(null);

    // Form state
    const [formName, setFormName] = useState("");
    const [formEmail, setFormEmail] = useState("");
    const [formPassword, setFormPassword] = useState("");
    const [formRole, setFormRole] = useState<string>("viewer");
    const [formProjects, setFormProjects] = useState<string[]>([]);
    const [showPassword, setShowPassword] = useState(false);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState("");

    const fetchUsers = useCallback(async () => {
        try {
            const res = await fetch("/api/users");
            if (!res.ok) throw new Error("Failed to fetch");
            setUsers(await res.json());
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
        setFormRole("viewer");
        setFormProjects([]);
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
        setFormError("");
        setShowForm(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError("");
        setSaving(true);

        const isEditing = !!editingUser;
        const isAdminRole = formRole === "admin";
        const projectsPayload = isAdminRole ? ["*"] : formProjects;

        try {
            const body: any = {
                name: formName,
                email: formEmail,
                role: formRole,
                projects: projectsPayload,
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

    const toggleProject = (projectId: string) => {
        setFormProjects((prev) =>
            prev.includes(projectId)
                ? prev.filter((p) => p !== projectId)
                : [...prev, projectId]
        );
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

    const roleLabel = (role: string) =>
        ROLE_OPTIONS.find((r) => r.value === role);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-white">
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
                                Dự án
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
                                                <p className="font-semibold text-white">
                                                    {user.name}
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
                                        <div className="flex flex-wrap gap-1">
                                            {user.projects.includes("*") ? (
                                                <span className="rounded-md bg-indigo-500/10 text-indigo-400 px-2 py-0.5 text-[10px] font-semibold">
                                                    ALL
                                                </span>
                                            ) : (
                                                user.projects.map((p) => (
                                                    <span
                                                        key={p}
                                                        className="rounded-md bg-white/[0.06] text-slate-300 px-2 py-0.5 text-[10px] font-medium"
                                                    >
                                                        {p}
                                                    </span>
                                                ))
                                            )}
                                        </div>
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
                    <div className="w-full max-w-lg mx-4 rounded-2xl bg-[#1a1f36] border border-white/10 shadow-2xl">
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
                                    Email
                                </label>
                                <input
                                    type="email"
                                    value={formEmail}
                                    onChange={(e) =>
                                        setFormEmail(e.target.value)
                                    }
                                    required
                                    className="w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                                    placeholder="user@faos.io"
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
                                    {ROLE_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() =>
                                                setFormRole(opt.value)
                                            }
                                            className={cn(
                                                "rounded-xl border px-3 py-2.5 text-left transition-all",
                                                formRole === opt.value
                                                    ? "border-indigo-500/50 bg-indigo-500/10"
                                                    : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
                                            )}
                                        >
                                            <p
                                                className={cn(
                                                    "text-xs font-semibold",
                                                    opt.color
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

                            {/* Projects (only for non-admin) */}
                            {formRole !== "admin" && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                                        Dự án được truy cập
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {ALL_PROJECTS.map((p) => (
                                            <button
                                                key={p}
                                                type="button"
                                                onClick={() => toggleProject(p)}
                                                className={cn(
                                                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                                                    formProjects.includes(p)
                                                        ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-400"
                                                        : "border-white/[0.08] text-slate-400 hover:bg-white/[0.04]"
                                                )}
                                            >
                                                {formProjects.includes(p) && (
                                                    <Check className="h-3 w-3 inline mr-1" />
                                                )}
                                                {p}
                                            </button>
                                        ))}
                                    </div>
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
