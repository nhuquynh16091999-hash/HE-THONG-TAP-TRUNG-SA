"""Tin nhắn theo PAGE từ Pancake — cho nước Meta KHÔNG báo số tin nhắn (Nhật, 09/10/2026).

Quảng cáo chạy ở Nhật không có chỉ số tin nhắn trên Meta (luật bảo vệ thông tin liên lạc của
Nhật): camp Nhật là camp tin nhắn mà fb_ads_data.messaging_conversations_started = 0, nên cột
SỐ TIN NHẮN, Giá Tiền/TN, Tỷ lệ chốt của Nhật trên Sheet đều sai. format_all.py gọi module này để
lấy số thật từ hộp thư Pancake rồi gán vào ô (marketer, nước, tab page, ngày) của camp chạy page đó.

Cùng cách đếm với bot Zalo (dashboard-ui/src/lib/talpha/pancake.ts, đo API 09/10/2026):
  • https://pages.fm/api/v1 + access_token TÀI KHOẢN Pancake (TALPHA_PANCAKE_API_TOKEN, ~90 ngày);
  • /pages → categorized.activated · /pages/{id}/conversations lật bằng current_count (page_number bị
    bỏ qua), xếp theo updated_at giảm dần — hết lô khi cả lô cập nhật trước mốc;
  • tin nhắn mới trong ngày = hội thoại INBOX có inserted_at (UTC không múi, +7 ra giờ VN) rơi vào ngày đó;
  • hội thoại không ghi đến từ quảng cáo nào → gom theo PAGE, nối camp bằng ô tên page trong tên camp.
Hỏng (thiếu token, token hết hạn, Pancake lỗi) → trả None, format_all giữ số Meta và in CANH BAO.
"""
import datetime
import json
import os
import time
import unicodedata
import re
import urllib.error
import urllib.parse
import urllib.request

API = "https://pages.fm/api/v1"
GIAN = 0.4          # giây giữa hai lượt gọi — gọi dồn là 429
VN = datetime.timedelta(hours=7)


def chuan_ten_page(s):
    """≡ talpha_rules.chuan_ten_page (chép để module chạy độc lập trong test)."""
    s = unicodedata.normalize("NFKC", str(s or "")).casefold()
    return " ".join(re.sub(r"[^\w]+", " ", s).split())


def _utc(iso):
    s = str(iso or "").strip()[:19]
    try:
        return datetime.datetime.fromisoformat(s)
    except ValueError:
        return None


def ngay_vn(iso):
    t = _utc(iso)
    return (t + VN).date().isoformat() if t else None


def dem_theo_ngay(hoi_thoai, tu_ngay, toi_ngay):
    """[hội thoại] → {ngày VN: số tin nhắn MỚI (INBOX)} trong [tu_ngay, toi_ngay]; trùng id một lần."""
    out, da = {}, set()
    for h in hoi_thoai:
        if not h or h.get("id") in da:
            continue
        da.add(h.get("id"))
        if str(h.get("type") or "").upper() == "COMMENT":
            continue
        d = ngay_vn(h.get("inserted_at"))
        if d and tu_ngay <= d <= toi_ngay:
            out[d] = out.get(d, 0) + 1
    return out


def het_lo(lo, tu_ngay):
    """Cả lô đã cập nhật trước 00:00 VN của tu_ngay → các lô sau không còn hội thoại tạo từ ngày đó."""
    if not lo:
        return True
    moc = datetime.datetime.fromisoformat(tu_ngay) - VN       # 00:00 VN tính theo UTC
    for h in lo:
        t = _utc(h.get("updated_at") or h.get("inserted_at"))
        if t is None or t >= moc:
            return False
    return True


def la_trang_cua_nuoc(ten, ma_nuoc):
    """Từ CUỐI tên page là mã nước ("Lucky Charm JP"). Chỉ mã shop: "Prime Leather Japan" là page Đài."""
    tu = chuan_ten_page(ten).upper().split()
    return bool(tu) and tu[-1] == str(ma_nuoc).upper()


def _goi(url, log):
    for lan in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                j = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * 2 ** lan)
                continue
            raise RuntimeError(f"Pancake HTTP {e.code}")
        if j.get("success") is False:
            raise RuntimeError(f"Pancake: {j.get('message') or 'lỗi'} (mã {j.get('error_code')})")
        return j
    raise RuntimeError("Pancake 429 — gọi dồn quá")


def han_token(tok):
    try:
        p = tok.split(".")[1]
        p += "=" * (-len(p) % 4)
        import base64
        return json.loads(base64.urlsafe_b64decode(p)).get("exp")
    except Exception:            # noqa: BLE001
        return None


def tin_nhan_theo_trang(ten_trang_camp, ma_nuoc, tu_ngay, toi_ngay, log=print, token=None):
    """Số tin nhắn mới theo page × ngày cho MỘT nước.

    ten_trang_camp: tên page lấy từ ô page của các camp nước đó (khớp chính).
    Trả {tên page chuẩn hoá: {"ten": tên trên Pancake, "ngay": {ngày: số}}} hoặc None nếu hỏng.
    """
    tok = (token or os.environ.get("TALPHA_PANCAKE_API_TOKEN") or "").strip()
    if not tok:
        log("CANH BAO: chua khai TALPHA_PANCAKE_API_TOKEN — tin nhan Nhat giu so Meta (0)")
        return None
    exp = han_token(tok)
    if exp and exp < time.time():
        log(f"CANH BAO: token Pancake het han {datetime.date.fromtimestamp(exp)} — tin nhan Nhat giu so Meta (0)")
        return None
    can = {chuan_ten_page(t) for t in ten_trang_camp if t}
    try:
        j = _goi(f"{API}/pages?access_token={urllib.parse.quote(tok)}", log)
        c = j.get("categorized") or {}
        pages = [p for p in (c.get("activated") or []) + (c.get("inactivated") or []) if p and p.get("id")]
        chon = [p for p in pages if chuan_ten_page(p.get("name")) in can or la_trang_cua_nuoc(p.get("name"), ma_nuoc)]
        out = {}
        for p in chon:
            hts, cc = [], 0
            try:
                for _ in range(60):
                    time.sleep(GIAN)
                    lo = _goi(f"{API}/pages/{p['id']}/conversations?access_token={urllib.parse.quote(tok)}&current_count={cc}", log).get("conversations") or []
                    hts += lo
                    if het_lo(lo, tu_ngay):
                        break
                    cc += len(lo)
            except RuntimeError as e:
                # Page chưa chạy camp nào mà lỗi (chưa có gói cước…) thì thôi; page có camp thì báo.
                if chuan_ten_page(p.get("name")) in can:
                    log(f"CANH BAO: Pancake page {p.get('name')}: {e}")
                continue
            out[chuan_ten_page(p.get("name"))] = {"ten": p.get("name"), "ngay": dem_theo_ngay(hts, tu_ngay, toi_ngay)}
        thay = {chuan_ten_page(p.get("name")) for p in pages}
        for k in can - thay:
            log(f"CANH BAO: tai khoan Pancake khong thay page '{k}' cua camp {ma_nuoc} — tin nhan page do = 0")
        return out
    except Exception as e:       # noqa: BLE001
        log(f"CANH BAO: Pancake loi ({e}) — tin nhan Nhat giu so Meta (0)")
        return None


def gan_cho_camp(so_trang, dong_ads, la_camp_cua_nuoc, trang_cua_camp):
    """Gán tin nhắn (page × ngày) cho MỘT camp: camp TIÊU NHIỀU NHẤT trên page đó trong ngày đó; ngày
    page không tiêu đồng nào (khách nhắn muộn) → camp gần nhất trước đó chạy page đó.

    dong_ads: [(campaign_name, ngày 'YYYY-MM-DD', tiền)] — đủ rộng (cả tháng + trước đó).
    Trả ({(campaign_name, ngày): số tin nhắn}, {tên page: số tin nhắn KHÔNG gán được}).
    """
    theo_trang = {}
    for cn, d, tien in dong_ads:
        if not la_camp_cua_nuoc(cn):
            continue
        t = trang_cua_camp(cn)
        if not t:
            continue
        theo_trang.setdefault(chuan_ten_page(t), []).append((d, float(tien or 0), cn))
    gan, khong = {}, {}
    for k, v in (so_trang or {}).items():
        ds = sorted(theo_trang.get(k, []))
        for d, n in v["ngay"].items():
            if not n:
                continue
            cung = [x for x in ds if x[0] == d]
            if cung:
                cn = max(cung, key=lambda x: x[1])[2]
            else:
                truoc = [x for x in ds if x[0] < d]
                cn = truoc[-1][2] if truoc else (ds[0][2] if ds else None)
            if cn is None:
                khong[v["ten"]] = khong.get(v["ten"], 0) + n
                continue
            gan[(cn, d)] = gan.get((cn, d), 0) + n
    return gan, khong
