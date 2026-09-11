#!/usr/bin/env python3
# Kiểm token Meta TRƯỚC khi tin vào Sheet.
#
# Vì sao có file này: 02/09/2026 token chết lúc 11:50, sync fail 16 vòng liên tiếp, nhưng
# fb_ads_data chỉ ĐỨNG chứ không MẤT dòng nên report_account_health vẫn báo "ok" — 46 tiếng
# không ai biết, tới lúc CEO nhìn Sheet thấy CPO đẹp bất thường mới lộ. Xem memory
# token-meta-chet-am-tham. Chạy file này sau mỗi lần thay token, và bất cứ khi nào số lạ.
#
# Không in token ra màn hình. Exit 0 = mọi TKQC đọc được; 1 = có vấn đề.
import json, os, sys, urllib.error, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import talpha_paths

# Đường dẫn hỏi talpha_paths, KHÔNG ghi cứng ~/talpha_reports nữa: bản cũ chỉ
# chạy được trên đúng một máy Mac, lên máy chủ là không thấy file nào.
# Token nằm trong .env.local của dashboard trên máy chủ; runtime/.env là bản Mac cũ.
def _dau_tien(*ung_vien):
    for c in ung_vien:
        if c and os.path.isfile(c):
            return c
    return ung_vien[0]


_RT = talpha_paths.runtime_dir()
_REPORTS = talpha_paths.reports_dir()
try:
    _REPO = talpha_paths.repo_dir()
except RuntimeError:
    _REPO = _REPORTS

ENV = _dau_tien(
    os.environ.get("TALPHA_ENV_FILE"),
    os.path.join(_REPO, "dashboard-ui", ".env.local"),
    os.path.join(_RT, ".env"),
    os.path.join(_REPO, ".env"),
)
ACCOUNTS = _dau_tien(
    os.path.join(_RT, "config", "ad_accounts.json"),
    os.path.join(_REPO, "ops", "talpha_reports", "ad_accounts.json"),
)
API = "https://graph.facebook.com/v21.0"


def load_env(path):
    out = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def get(path, **params):
    url = f"{API}/{path}?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return True, json.load(r)
    except urllib.error.HTTPError as e:
        return False, json.load(e).get("error", {})
    except Exception as e:                                    # noqa: BLE001
        return False, {"message": str(e)}


def main():
    env = load_env(ENV)
    tok = env.get("TALPHA_META_ACCESS_TOKEN", "")
    if not tok:
        print("❌ .env không có TALPHA_META_ACCESS_TOKEN")
        return 1
    print(f"token: dài {len(tok)} ký tự, đuôi ...{tok[-6:]}   (nguồn {ENV})\n")

    ok, me = get("me", access_token=tok, fields="id,name")
    if not ok:
        print(f"❌ TOKEN CHẾT — code {me.get('code')}/{me.get('error_subcode')}: {me.get('message','')[:150]}")
        print("\n→ Sinh token mới rồi thay vào .env. Đừng chạy sync khi token còn chết:")
        print("  sync sẽ fail toàn bộ 15 TKQC và Sheet giữ nguyên số cũ.")
        return 1
    print(f"✅ token sống — {me.get('name','?')} ({me.get('id','?')})")

    # Hạn dùng. Token System User ĐẶT ĐƯỢC "không bao giờ hết hạn" — nếu thấy có hạn thật
    # thì lúc sinh mã đã chọn nhầm ô 60 ngày. Cảnh báo sớm 14 ngày, vì hệ chưa biết tự kêu
    # khi bảng ĐỨNG (xem memory token-meta-chet-am-tham): token chết là im 46 tiếng như 02/09.
    ok, dbg = get("debug_token", input_token=tok, access_token=tok)
    if ok:
        exp = dbg.get("data", {}).get("expires_at")
        if exp:
            import datetime
            when = datetime.datetime.fromtimestamp(exp)
            days = (when - datetime.datetime.now()).days
            flag = "🔴" if days <= 14 else "⚠️ "
            print(f"   {flag} HẾT HẠN {when:%d/%m/%Y %H:%M} — còn {days} ngày."
                  f" Sinh mã mới chọn 'Không bao giờ hết hạn' là hết lo.")
        else:
            print("   ✅ không bao giờ hết hạn")
    print()

    accounts = (json.load(open(ACCOUNTS))["projects"]["talpha"]["accounts"])
    print(f"Thử đọc insights từng TKQC ({len(accounts)} cái):")
    bad = []
    for a in accounts:
        ok, r = get(f"{a['id']}/insights", access_token=tok,
                    fields="spend", date_preset="yesterday", limit=1)
        if ok:
            print(f"  ✅ {a['name']}")
        else:
            bad.append(a["name"])
            print(f"  ❌ {a['name']} — {r.get('message','')[:90]}")

    print()
    if bad:
        print(f"❌ {len(bad)}/{len(accounts)} TKQC KHÔNG đọc được: {', '.join(bad)}")
        print("→ Vào Business Settings → System users → Gán tài sản, thêm đúng các TKQC trên")
        print("  với quyền tối thiểu 'Xem hiệu quả' (View Performance).")
        return 1
    print(f"✅ Đủ {len(accounts)}/{len(accounts)} TKQC. Chạy backfill được rồi.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
