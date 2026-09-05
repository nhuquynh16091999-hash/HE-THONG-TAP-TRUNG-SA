"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Plus, RefreshCw, AlertTriangle, CheckCircle2,
    XCircle, Pause, Trash2, Edit, Key, ChevronDown, ChevronUp, Loader2,
} from "lucide-react";

// ═══ Types ═══
interface AdAccount {
    id: string;
    name: string;
    status: "active" | "died" | "paused" | "error";
    added_at: string;
    died_at: string | null;
    notes: string;
}

interface Project {
    project_id: string;
    project_name: string;
    business_id: string;
    access_token_env: string;
    pixel_id: string;
    total_accounts: number;
    active_accounts: number;
    died_accounts: number;
    accounts: AdAccount[];
}

// ═══ Status Badge ═══
const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    active: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", label: "Active" },
    died: { icon: <XCircle className="h-3.5 w-3.5" />, color: "text-red-400 bg-red-500/10 border-red-500/20", label: "Died" },
    paused: { icon: <Pause className="h-3.5 w-3.5" />, color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20", label: "Paused" },
    error: { icon: <AlertTriangle className="h-3.5 w-3.5" />, color: "text-orange-400 bg-orange-500/10 border-orange-500/20", label: "Error" },
};

function StatusBadge({ status }: { status: string }) {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.error;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
            {cfg.icon} {cfg.label}
        </span>
    );
}

// ═══ Add Account Modal ═══
function AddAccountForm({ projectId, onAdd, onCancel }: {
    projectId: string; onAdd: () => void; onCancel: () => void;
}) {
    const [id, setId] = useState("");
    const [name, setName] = useState("");
    const [notes, setNotes] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!id.startsWith("act_")) {
            setError("Ad Account ID phải bắt đầu bằng 'act_'");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/ad-accounts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "add_account", project_id: projectId, id, name, notes }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to add account");
            onAdd();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="mt-3 p-4 rounded-lg bg-white/5 border border-white/10 space-y-3">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <Plus className="h-4 w-4 text-indigo-400" /> Thêm TKQC mới
            </h4>
            {error && <p className="text-xs text-red-400 bg-red-500/10 px-3 py-1.5 rounded">{error}</p>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input type="text" placeholder="act_123456789" value={id} onChange={e => setId(e.target.value)} required
                    className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500" />
                <input type="text" placeholder="Tên TKQC (VD: STRAMARK_EU_3)" value={name} onChange={e => setName(e.target.value)} required
                    className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500" />
                <input type="text" placeholder="Ghi chú (tuỳ chọn)" value={notes} onChange={e => setNotes(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="flex gap-2">
                <button type="submit" disabled={loading}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-md transition-colors disabled:opacity-50 flex items-center gap-2">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Thêm
                </button>
                <button type="button" onClick={onCancel}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-400 text-sm rounded-md transition-colors">Huỷ</button>
            </div>
        </form>
    );
}

// ═══ Credentials Form ═══
function CredentialsForm({ project, onSave, onCancel }: {
    project: Project; onSave: () => void; onCancel: () => void;
}) {
    const [biz, setBiz] = useState(project.business_id);
    const [tokenEnv, setTokenEnv] = useState(project.access_token_env);
    const [pixel, setPixel] = useState(project.pixel_id);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await fetch("/api/ad-accounts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "update_credentials", project_id: project.project_id,
                    business_id: biz, access_token_env: tokenEnv, pixel_id: pixel,
                }),
            });
            onSave();
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="mt-3 p-4 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-3">
            <h4 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
                <Key className="h-4 w-4" /> Cập nhật Credentials — {project.project_name}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                    <label className="text-xs text-gray-400 block mb-1">Business Manager ID</label>
                    <input type="text" value={biz} onChange={e => setBiz(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                </div>
                <div>
                    <label className="text-xs text-gray-400 block mb-1">Access Token (tên biến .env)</label>
                    <input type="text" value={tokenEnv} onChange={e => setTokenEnv(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                </div>
                <div>
                    <label className="text-xs text-gray-400 block mb-1">Pixel ID</label>
                    <input type="text" value={pixel} onChange={e => setPixel(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                </div>
            </div>
            <p className="text-xs text-gray-500">
                ⚠️ Đây chỉ là tên biến môi trường. Token thực tế cần cập nhật trong file <code className="text-amber-400">.env</code>
            </p>
            <div className="flex gap-2">
                <button type="submit" disabled={loading}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded-md transition-colors disabled:opacity-50 flex items-center gap-2">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />} Lưu
                </button>
                <button type="button" onClick={onCancel}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-400 text-sm rounded-md transition-colors">Huỷ</button>
            </div>
        </form>
    );
}

// ═══ Project Card ═══
function ProjectCard({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
    const [expanded, setExpanded] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [showCredsForm, setShowCredsForm] = useState(false);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    const updateStatus = async (accountId: string, status: string) => {
        setUpdatingId(accountId);
        try {
            await fetch("/api/ad-accounts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "update_account", project_id: project.project_id, account_id: accountId, status }),
            });
            onRefresh();
        } finally {
            setUpdatingId(null);
        }
    };

    const removeAccount = async (accountId: string) => {
        if (!confirm(`Xoá vĩnh viễn TKQC ${accountId}? (Chọn "Mark Died" để giữ lịch sử)`)) return;
        await fetch("/api/ad-accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "remove_account", project_id: project.project_id, account_id: accountId }),
        });
        onRefresh();
    };

    return (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 bg-white/[0.03] cursor-pointer" onClick={() => setExpanded(!expanded)}>
                <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-white">{project.project_name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        {project.active_accounts} active
                    </span>
                    {project.died_accounts > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                            {project.died_accounts} died
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); setShowCredsForm(!showCredsForm); setShowAddForm(false); }}
                        className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-amber-400 transition-colors" title="Cập nhật credentials">
                        <Key className="h-4 w-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setShowAddForm(!showAddForm); setShowCredsForm(false); }}
                        className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-indigo-400 transition-colors" title="Thêm TKQC">
                        <Plus className="h-4 w-4" />
                    </button>
                    {expanded ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
                </div>
            </div>

            {/* Credentials Form */}
            {showCredsForm && (
                <div className="px-5">
                    <CredentialsForm project={project} onSave={() => { setShowCredsForm(false); onRefresh(); }} onCancel={() => setShowCredsForm(false)} />
                </div>
            )}

            {/* Add Account Form */}
            {showAddForm && (
                <div className="px-5">
                    <AddAccountForm projectId={project.project_id} onAdd={() => { setShowAddForm(false); onRefresh(); }} onCancel={() => setShowAddForm(false)} />
                </div>
            )}

            {/* Account Table */}
            {expanded && (
                <div className="px-5 pb-4">
                    <div className="mt-3 text-xs text-gray-500 mb-2 flex gap-4">
                        <span>BM: <code className="text-gray-400">{project.business_id || "—"}</code></span>
                        <span>Token: <code className="text-gray-400">{project.access_token_env || "—"}</code></span>
                        <span>Pixel: <code className="text-gray-400">{project.pixel_id || "—"}</code></span>
                    </div>

                    {project.accounts.length === 0 ? (
                        <p className="text-sm text-gray-500 py-4 text-center">Chưa có TKQC nào</p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs text-gray-500 border-b border-white/5">
                                    <th className="py-2 text-left font-medium">Account ID</th>
                                    <th className="py-2 text-left font-medium">Tên</th>
                                    <th className="py-2 text-left font-medium">Status</th>
                                    <th className="py-2 text-left font-medium">Ngày thêm</th>
                                    <th className="py-2 text-left font-medium">Ngày die</th>
                                    <th className="py-2 text-left font-medium">Ghi chú</th>
                                    <th className="py-2 text-right font-medium">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {project.accounts.map((acct) => (
                                    <tr key={acct.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                        <td className="py-2.5 font-mono text-xs text-gray-300">{acct.id}</td>
                                        <td className="py-2.5 text-white">{acct.name}</td>
                                        <td className="py-2.5"><StatusBadge status={acct.status} /></td>
                                        <td className="py-2.5 text-gray-400 text-xs">{acct.added_at}</td>
                                        <td className="py-2.5 text-gray-400 text-xs">{acct.died_at || "—"}</td>
                                        <td className="py-2.5 text-gray-500 text-xs max-w-[200px] truncate">{acct.notes || "—"}</td>
                                        <td className="py-2.5 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {updatingId === acct.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                                                ) : (
                                                    <>
                                                        {acct.status !== "active" && (
                                                            <button onClick={() => updateStatus(acct.id, "active")} title="Kích hoạt lại"
                                                                className="p-1 rounded hover:bg-emerald-500/10 text-gray-500 hover:text-emerald-400 transition-colors">
                                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        )}
                                                        {acct.status !== "died" && (
                                                            <button onClick={() => updateStatus(acct.id, "died")} title="Đánh dấu Die"
                                                                className="p-1 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors">
                                                                <XCircle className="h-3.5 w-3.5" />
                                                            </button>
                                                        )}
                                                        {acct.status !== "paused" && (
                                                            <button onClick={() => updateStatus(acct.id, "paused")} title="Tạm dừng"
                                                                className="p-1 rounded hover:bg-yellow-500/10 text-gray-500 hover:text-yellow-400 transition-colors">
                                                                <Pause className="h-3.5 w-3.5" />
                                                            </button>
                                                        )}
                                                        <button onClick={() => removeAccount(acct.id)} title="Xoá vĩnh viễn"
                                                            className="p-1 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors">
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}

// ═══ Main Tab Component ═══
export default function AdAccountsTab() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState("");

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/ad-accounts");
            const data = await res.json();
            setProjects(data.projects || []);
            setLastUpdated(data.updated_at || "");
        } catch (e) {
            console.error("Failed to fetch ad accounts:", e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const totalActive = projects.reduce((s, p) => s + p.active_accounts, 0);
    const totalDied = projects.reduce((s, p) => s + p.died_accounts, 0);
    const totalAll = projects.reduce((s, p) => s + p.total_accounts, 0);

    return (
        <div className="space-y-6">
            {/* Stats Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-sm text-gray-400">Active: <span className="text-white font-semibold">{totalActive}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-400" />
                        <span className="text-sm text-gray-400">Died: <span className="text-white font-semibold">{totalDied}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-gray-400" />
                        <span className="text-sm text-gray-400">Total: <span className="text-white font-semibold">{totalAll}</span></span>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {lastUpdated && <span className="text-xs text-gray-500">Updated: {new Date(lastUpdated).toLocaleString("vi-VN")}</span>}
                    <button onClick={fetchData} disabled={loading}
                        className="p-2 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-50">
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </button>
                </div>
            </div>

            {/* Project Cards */}
            {loading && projects.length === 0 ? (
                <div className="flex items-center justify-center py-20 text-gray-500">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading...
                </div>
            ) : (
                <div className="space-y-4">
                    {projects.map((p) => (
                        <ProjectCard key={p.project_id} project={p} onRefresh={fetchData} />
                    ))}
                </div>
            )}

            {/* Instructions */}
            <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4 text-xs text-gray-500 space-y-1">
                <p className="font-medium text-gray-400">📌 Hướng dẫn:</p>
                <ul className="list-disc list-inside space-y-0.5 ml-2">
                    <li>Khi TKQC die → bấm <XCircle className="h-3 w-3 inline text-red-400" /> để đánh dấu. Data cũ vẫn được giữ trong BigQuery.</li>
                    <li>Thêm TKQC mới → bấm <Plus className="h-3 w-3 inline text-indigo-400" /> ở header mỗi project.</li>
                    <li>Đổi Access Token / BM → bấm <Key className="h-3 w-3 inline text-amber-400" />, cập nhật tên biến .env, rồi sửa file <code>.env</code> trên server.</li>
                    <li>Sync scripts sẽ TỰ ĐỘNG đọc config mới — không cần restart hay sửa code.</li>
                </ul>
            </div>
        </div>
    );
}
