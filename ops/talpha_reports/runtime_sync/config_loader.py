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
CONFIG_PATH = _PROJECT_ROOT / "config" / "ad_accounts.json"


def load_ad_accounts_config() -> dict:
    """Load the full ad_accounts.json config."""
    if not CONFIG_PATH.exists():
        log.warning(f"Config file not found: {CONFIG_PATH}")
        return {"projects": {}}
    
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
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
