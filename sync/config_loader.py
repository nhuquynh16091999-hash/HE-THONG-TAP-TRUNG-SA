"""
Shared Ad Account Config Loader — used by all sync scripts.

Reads active ad accounts from config/ad_accounts.json.
Only returns accounts with status="active" for syncing.
Falls back to hardcoded defaults if config file is missing.
"""
import json
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


def find_config_path() -> Optional[Path]:
    """Trả về path ad_accounts.json đầu tiên tồn tại trong CONFIG_CANDIDATES."""
    for p in CONFIG_CANDIDATES:
        if p.exists():
            return p
    return None


def _from_yaml() -> Optional[dict]:
    """Dựng cấu hình từ config/projects/talpha.yaml — NGUỒN DUY NHẤT.

    Trước đây danh sách tài khoản quảng cáo nằm ở nhiều nơi (yaml cho dashboard,
    ad_accounts.json cho sync, bản runtime, và mấy chỗ gõ tay trong code). Thêm
    một tài khoản mà sót một chỗ là spend bị đếm thiếu ÂM THẦM — không lỗi, không
    cảnh báo, chỉ có số nhỏ hơn thực tế. Nay sync đọc chung một file với dashboard.
    """
    yml = _PROJECT_ROOT / "config" / "projects" / "talpha.yaml"
    if not yml.exists():
        return None
    try:
        import yaml  # noqa: PLC0415
    except ImportError:
        log.warning("Chưa cài PyYAML — quay về đọc ad_accounts.json")
        return None
    try:
        with open(yml, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except Exception as e:
        log.warning(f"Đọc {yml} lỗi ({e}) — quay về đọc ad_accounts.json")
        return None

    meta = data.get("meta_ads") or {}
    ids = meta.get("ad_account_ids") or []
    if not ids:
        return None
    names = meta.get("ad_account_names") or {}
    tzs = meta.get("ad_account_timezones") or {}
    return {
        "projects": {
            "talpha": {
                "access_token_env": "TALPHA_META_ACCESS_TOKEN",
                "accounts": [
                    {
                        "id": aid,
                        "name": names.get(aid, aid),
                        "timezone": tzs.get(aid),
                        # yaml chỉ liệt kê tài khoản đang dùng; muốn tạm ngưng một
                        # tài khoản thì bỏ nó khỏi ad_account_ids.
                        "status": "active",
                    }
                    for aid in ids
                ],
            }
        }
    }


def load_ad_accounts_config() -> dict:
    """Cấu hình tài khoản quảng cáo. Ưu tiên talpha.yaml, sau đó mới tới file JSON."""
    from_yaml = _from_yaml()
    if from_yaml:
        log.debug("Đọc tài khoản quảng cáo từ config/projects/talpha.yaml")
        return from_yaml

    path = find_config_path()
    if path is None:
        log.warning(
            "Không thấy talpha.yaml lẫn ad_accounts.json ở: "
            + ", ".join(str(p) for p in CONFIG_CANDIDATES)
        )
        return {"projects": {}}

    log.debug(f"Đọc tài khoản quảng cáo từ {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_active_accounts(project_id: str) -> List[Dict]:
    """Get list of active ad account dicts for a project.
    
    Returns:
        List of account dicts with id, name, status, etc.
    """
    config = load_ad_accounts_config()
    project = config.get("projects", {}).get(project_id, {})
    accounts = project.get("accounts", [])
    
    return [a for a in accounts if a.get("status") == "active"]


