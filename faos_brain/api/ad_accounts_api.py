"""
Ad Accounts Management API — TKQC Lifecycle Management

Endpoints:
  GET    /api/ad-accounts                     → list all projects + accounts
  GET    /api/ad-accounts/{project_id}         → list accounts for project
  POST   /api/ad-accounts/{project_id}         → add new account
  PATCH  /api/ad-accounts/{project_id}/{acct}  → update status/name/notes
  PUT    /api/ad-accounts/{project_id}/creds   → update credentials (token, BM)
  DELETE /api/ad-accounts/{project_id}/{acct}  → permanently remove (use PATCH to mark died instead)
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

log = logging.getLogger("faos.ad_accounts")
router = APIRouter(prefix="/api/ad-accounts", tags=["ad-accounts"])

# Config file path
CONFIG_PATH = Path(__file__).parent.parent.parent / "config" / "ad_accounts.json"


# ═══ Models ═══

class AdAccountCreate(BaseModel):
    id: str  # e.g. "act_123456789"
    name: str  # e.g. "STRAMARK_EU_3"
    notes: Optional[str] = ""


class AdAccountUpdate(BaseModel):
    status: Optional[str] = None  # active, died, paused, error
    name: Optional[str] = None
    notes: Optional[str] = None


class CredentialsUpdate(BaseModel):
    access_token: Optional[str] = None
    business_id: Optional[str] = None
    pixel_id: Optional[str] = None


# ═══ Config I/O ═══

def _load_config() -> dict:
    """Load ad_accounts.json."""
    if not CONFIG_PATH.exists():
        return {"version": 1, "projects": {}}
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_config(config: dict):
    """Save ad_accounts.json with timestamp."""
    config["updated_at"] = datetime.now().isoformat()
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def _get_project(config: dict, project_id: str) -> dict:
    """Get project config or raise 404."""
    project = config.get("projects", {}).get(project_id)
    if not project:
        raise HTTPException(404, f"Project '{project_id}' not found")
    return project


# ═══ Endpoints ═══

@router.get("")
async def list_all_projects():
    """List all projects with their ad accounts and stats."""
    config = _load_config()
    result = []
    for pid, project in config.get("projects", {}).items():
        accounts = project.get("accounts", [])
        active = sum(1 for a in accounts if a.get("status") == "active")
        died = sum(1 for a in accounts if a.get("status") == "died")
        result.append({
            "project_id": pid,
            "project_name": project.get("project_name", pid),
            "business_id": project.get("business_id", ""),
            "access_token_env": project.get("access_token_env", ""),
            "pixel_id": project.get("pixel_id", ""),
            "total_accounts": len(accounts),
            "active_accounts": active,
            "died_accounts": died,
            "accounts": accounts,
        })
    return {"projects": result, "updated_at": config.get("updated_at")}


@router.get("/{project_id}")
async def get_project_accounts(project_id: str):
    """Get all ad accounts for a specific project."""
    config = _load_config()
    project = _get_project(config, project_id)
    return {
        "project_id": project_id,
        "project_name": project.get("project_name", project_id),
        "business_id": project.get("business_id", ""),
        "access_token_env": project.get("access_token_env", ""),
        "pixel_id": project.get("pixel_id", ""),
        "accounts": project.get("accounts", []),
    }


@router.post("/{project_id}")
async def add_account(project_id: str, body: AdAccountCreate):
    """Add a new ad account to a project."""
    config = _load_config()
    project = _get_project(config, project_id)

    # Check for duplicate
    for acct in project.get("accounts", []):
        if acct["id"] == body.id:
            raise HTTPException(409, f"Account '{body.id}' already exists in {project_id}")

    new_account = {
        "id": body.id,
        "name": body.name,
        "status": "active",
        "added_at": datetime.now().strftime("%Y-%m-%d"),
        "died_at": None,
        "notes": body.notes or "",
    }

    if "accounts" not in project:
        project["accounts"] = []
    project["accounts"].append(new_account)

    _save_config(config)
    log.info(f"Added ad account {body.id} ({body.name}) to {project_id}")

    return {"message": "Account added", "account": new_account}


@router.patch("/{project_id}/{account_id}")
async def update_account(project_id: str, account_id: str, body: AdAccountUpdate):
    """Update an ad account's status, name, or notes."""
    config = _load_config()
    project = _get_project(config, project_id)

    account = None
    for acct in project.get("accounts", []):
        if acct["id"] == account_id:
            account = acct
            break

    if not account:
        raise HTTPException(404, f"Account '{account_id}' not found in {project_id}")

    if body.status is not None:
        valid_statuses = {"active", "died", "paused", "error"}
        if body.status not in valid_statuses:
            raise HTTPException(400, f"Invalid status. Must be one of: {valid_statuses}")
        account["status"] = body.status
        if body.status == "died":
            account["died_at"] = datetime.now().strftime("%Y-%m-%d")
        elif body.status == "active":
            account["died_at"] = None

    if body.name is not None:
        account["name"] = body.name
    if body.notes is not None:
        account["notes"] = body.notes

    _save_config(config)
    log.info(f"Updated account {account_id} in {project_id}: {body.dict(exclude_none=True)}")

    return {"message": "Account updated", "account": account}


@router.put("/{project_id}/creds")
async def update_credentials(project_id: str, body: CredentialsUpdate):
    """Update project credentials (access_token env var name, business_id, pixel_id).

    NOTE: This does NOT store the actual token — it stores the env var NAME
    that contains the token. The actual token stays in .env file.
    Leaders update the .env file directly or via a separate secure mechanism.
    """
    config = _load_config()
    project = _get_project(config, project_id)

    updated = {}
    if body.access_token is not None:
        # Store as env var name, not raw token
        project["access_token_env"] = body.access_token
        updated["access_token_env"] = body.access_token
    if body.business_id is not None:
        project["business_id"] = body.business_id
        updated["business_id"] = body.business_id
    if body.pixel_id is not None:
        project["pixel_id"] = body.pixel_id
        updated["pixel_id"] = body.pixel_id

    _save_config(config)
    log.info(f"Updated credentials for {project_id}: {updated}")

    return {"message": "Credentials updated", "updated": updated}


@router.delete("/{project_id}/{account_id}")
async def remove_account(project_id: str, account_id: str):
    """Permanently remove an ad account. Use PATCH to mark as 'died' instead to keep history."""
    config = _load_config()
    project = _get_project(config, project_id)

    accounts = project.get("accounts", [])
    original_len = len(accounts)
    project["accounts"] = [a for a in accounts if a["id"] != account_id]

    if len(project["accounts"]) == original_len:
        raise HTTPException(404, f"Account '{account_id}' not found in {project_id}")

    _save_config(config)
    log.info(f"Removed account {account_id} from {project_id}")

    return {"message": f"Account {account_id} removed from {project_id}"}
