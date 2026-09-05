"""
Shared Ad Account Config Loader — used by all sync scripts.

Reads active ad accounts from config/ad_accounts.json.
Only returns accounts with status="active" for syncing.
Falls back to hardcoded defaults if config file is missing.
"""
import json
import os
import logging
from pathlib import Path
from typing import List, Dict, Optional

log = logging.getLogger("sync.config_loader")

# Auto-detect project root (2 levels up from sync/config_loader.py)
_SYNC_DIR = Path(__file__).parent
_PROJECT_ROOT = _SYNC_DIR.parent

# Ứng viên theo thứ tự ưu tiên — lấy file ĐẦU TIÊN tồn tại:
#   1. <repo>/config/ad_accounts.json            (nếu sau này tách riêng)
#   2. <repo>/ops/talpha_reports/ad_accounts.json (bản git-track của runtime — hiện là source of truth)
#   3. ~/talpha_reports/runtime/config/ad_accounts.json (bản deploy runtime đang chạy)
CONFIG_CANDIDATES = [
    _PROJECT_ROOT / "config" / "ad_accounts.json",
    _PROJECT_ROOT / "ops" / "talpha_reports" / "ad_accounts.json",
    Path.home() / "talpha_reports" / "runtime" / "config" / "ad_accounts.json",
]
# Giữ tên cũ cho tương thích ngược (code cũ có thể import CONFIG_PATH)
CONFIG_PATH = CONFIG_CANDIDATES[0]


def find_config_path() -> Optional[Path]:
    """Trả về path ad_accounts.json đầu tiên tồn tại trong CONFIG_CANDIDATES."""
    for p in CONFIG_CANDIDATES:
        if p.exists():
            return p
    return None


def load_ad_accounts_config() -> dict:
    """Load the full ad_accounts.json config (first existing candidate)."""
    path = find_config_path()
    if path is None:
        log.warning(
            "ad_accounts.json not found in any candidate: "
            + ", ".join(str(p) for p in CONFIG_CANDIDATES)
        )
        return {"projects": {}}

    log.debug(f"Loading ad accounts config from {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_active_account_ids(project_id: str) -> List[str]:
    """Get list of active ad account IDs for a project.
    
    Returns:
        List of account IDs like ['act_817501334775697', 'act_1369010934859968']
    """
    config = load_ad_accounts_config()
    project = config.get("projects", {}).get(project_id, {})
    accounts = project.get("accounts", [])
    
    active = [a["id"] for a in accounts if a.get("status") == "active"]
    total = len(accounts)
    
    log.info(f"[{project_id}] Loaded {len(active)}/{total} active ad accounts from config")
    return active


def get_active_accounts(project_id: str) -> List[Dict]:
    """Get list of active ad account dicts for a project.
    
    Returns:
        List of account dicts with id, name, status, etc.
    """
    config = load_ad_accounts_config()
    project = config.get("projects", {}).get(project_id, {})
    accounts = project.get("accounts", [])
    
    return [a for a in accounts if a.get("status") == "active"]


def get_access_token_env(project_id: str) -> str:
    """Get the env var name for the access token of a project.
    
    Returns:
        Environment variable name like 'META_ACCESS_TOKEN'
    """
    config = load_ad_accounts_config()
    project = config.get("projects", {}).get(project_id, {})
    return project.get("access_token_env", "")


def get_access_token(project_id: str) -> str:
    """Get the actual access token value from .env for a project.
    
    Returns:
        The access token string, or empty string if not found.
    """
    env_var = get_access_token_env(project_id)
    if not env_var:
        return ""
    return os.environ.get(env_var, "")
