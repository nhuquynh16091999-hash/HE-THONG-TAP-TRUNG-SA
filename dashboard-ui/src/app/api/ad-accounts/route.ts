import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Bản git-track thật nằm ở ops/talpha_reports/ (xem docs/TALPHA_METRIC_RULES.md);
// giữ config/ làm fallback nếu sau này hợp nhất về đó.
// process.cwd() phải gọi MỖI request, không đóng băng ở module scope: process pm2
// sống qua lần đổi tên thư mục dự án sẽ giữ path cũ vĩnh viễn → route trả rỗng
// dù file config vẫn nằm đó (sự cố 31/07).
function configPath(): string {
    const candidates = [
        path.join(process.cwd(), "..", "ops", "talpha_reports", "ad_accounts.json"),
        path.join(process.cwd(), "..", "config", "ad_accounts.json"),
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

function loadConfig() {
    const p = configPath();
    if (!fs.existsSync(p)) {
        return { version: 1, projects: {} };
    }
    return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function saveConfig(config: any) {
    config.updated_at = new Date().toISOString();
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf-8");
}

// GET /api/ad-accounts — list all projects + accounts
export async function GET() {
    try {
        const config = loadConfig();
        const projects = Object.entries(config.projects || {}).map(
            ([pid, project]: [string, any]) => {
                const accounts = project.accounts || [];
                return {
                    project_id: pid,
                    project_name: project.project_name || pid,
                    business_id: project.business_id || "",
                    access_token_env: project.access_token_env || "",
                    pixel_id: project.pixel_id || "",
                    total_accounts: accounts.length,
                    active_accounts: accounts.filter((a: any) => a.status === "active").length,
                    died_accounts: accounts.filter((a: any) => a.status === "died").length,
                    accounts,
                };
            }
        );
        return NextResponse.json({ projects, updated_at: config.updated_at });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// POST /api/ad-accounts — add account or update account or update credentials
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, project_id, ...data } = body;
        const config = loadConfig();

        if (!config.projects[project_id]) {
            return NextResponse.json({ error: `Project '${project_id}' not found` }, { status: 404 });
        }

        const project = config.projects[project_id];

        if (action === "add_account") {
            // Check duplicate
            if (project.accounts?.some((a: any) => a.id === data.id)) {
                return NextResponse.json({ error: `Account '${data.id}' already exists` }, { status: 409 });
            }
            const newAccount = {
                id: data.id,
                name: data.name || "",
                status: "active",
                added_at: new Date().toISOString().split("T")[0],
                died_at: null,
                notes: data.notes || "",
            };
            if (!project.accounts) project.accounts = [];
            project.accounts.push(newAccount);
            saveConfig(config);
            return NextResponse.json({ message: "Account added", account: newAccount });
        }

        if (action === "update_account") {
            const account = project.accounts?.find((a: any) => a.id === data.account_id);
            if (!account) {
                return NextResponse.json({ error: `Account '${data.account_id}' not found` }, { status: 404 });
            }
            if (data.status !== undefined) {
                account.status = data.status;
                if (data.status === "died") {
                    account.died_at = new Date().toISOString().split("T")[0];
                } else if (data.status === "active") {
                    account.died_at = null;
                }
            }
            if (data.name !== undefined) account.name = data.name;
            if (data.notes !== undefined) account.notes = data.notes;
            saveConfig(config);
            return NextResponse.json({ message: "Account updated", account });
        }

        if (action === "update_credentials") {
            if (data.business_id !== undefined) project.business_id = data.business_id;
            if (data.pixel_id !== undefined) project.pixel_id = data.pixel_id;
            if (data.access_token_env !== undefined) project.access_token_env = data.access_token_env;
            saveConfig(config);
            return NextResponse.json({ message: "Credentials updated" });
        }

        if (action === "remove_account") {
            const idx = project.accounts?.findIndex((a: any) => a.id === data.account_id);
            if (idx === undefined || idx < 0) {
                return NextResponse.json({ error: `Account '${data.account_id}' not found` }, { status: 404 });
            }
            project.accounts.splice(idx, 1);
            saveConfig(config);
            return NextResponse.json({ message: "Account removed" });
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
