"""
Bảng đơn của đối tác 3PL (Google Sheet) → dòng cho bảng BigQuery `partner_orders`.

Vì sao cần: POS chỉ biết đơn đã CHỐT; bảng của đối tác mới có mã vận đơn, ngày xuất kho,
trạng thái giao và tiền COD đối tác thu. Tab Theo dõi vận đơn / Sổ đơn hàng đọc thẳng bảng
Đài (tracking.partner_file) mà không lưu vào kho số — có bảng trong BigQuery thì muốn tra,
đối chiếu với POS hay dựng báo cáo lúc nào cũng được, kể cả khi đối tác sửa/xoá dòng.
Sỹ Anh chia sẻ bảng Singapore 25/09/2026 ("cập nhật vào database cho những lúc cần").

Module này KHÔNG ghi BigQuery — chỉ đọc Sheet và chuẩn hoá dòng. Ghi là việc của
talpha_sync.sync_partner_orders() qua bq_writer.load_truncate (LOAD JOB, không DML).
Cấu hình (sheet nào, tên cột nào) ở config/talpha_rules.json → partner_orders.
"""
import re
import logging
import unicodedata
from datetime import date

log = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


def chuan_tieu_de(s) -> str:
    """'COD Amount (SGD)' → 'cod amount sgd' · 'Mã đơn mới…' → 'ma don moi…' · 'Contact Name(*)' → 'contact name'."""
    s = unicodedata.normalize("NFKD", str(s or "")).replace("đ", "d").replace("Đ", "D")
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


def gan_cot(tieu_de: list, column_map: dict) -> dict:
    """Tiêu đề → {khoá: chỉ số cột}. Mỗi tiêu đề nhận khoá có bí danh KHỚP DÀI NHẤT —
    'ma don moi cua don di kho hang hoan' phải về return_order_no ('ma don moi') chứ không
    về order_no ('ma don'). Mỗi khoá chỉ lấy cột đầu tiên khớp."""
    ra = {}
    for i, td in enumerate(tieu_de):
        h = chuan_tieu_de(td)
        if not h:
            continue
        tot, dai = None, -1
        for khoa, bi_danh in column_map.items():
            if khoa.startswith("_"):
                continue
            for b in bi_danh:
                b = chuan_tieu_de(b)
                if b and (h == b or h.startswith(b + " ")) and len(b) > dai:
                    tot, dai = khoa, len(b)
        if tot and tot not in ra:
            ra[tot] = i
    return ra


def doc_ngay(v):
    """'14/9/2026' · '18/09/2026' · '2026-09-14' → 'YYYY-MM-DD'; không đọc được → None."""
    s = str(v or "").strip()
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    try:
        if m:
            return date(int(m[3]), int(m[2]), int(m[1])).isoformat()
        m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
        if m:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None
    return None


def doc_so(v):
    """'99' · '1,299' · '1.299,5' · '' → số hoặc None. Sheet vi_VN dùng chấm nghìn, phẩy thập phân."""
    s = re.sub(r"[^\d,.\-]", "", str(v or ""))
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", "." if len(s.split(",")[-1]) != 3 else "")
    try:
        return float(s)
    except ValueError:
        return None


def chuan_dong(values: list, column_map: dict, meta: dict, synced_at: str) -> list:
    """values = mảng 2 chiều (dòng 1 là tiêu đề) → list dict theo PARTNER_ORDER_SCHEMA.
    meta = {market, shop_label, sheet_id}. Dòng không có cả mã đơn lẫn mã vận đơn bị bỏ."""
    if not values:
        return []
    cot = gan_cot(values[0], column_map)
    thieu = [k for k in ("order_no", "tracking", "cod") if k not in cot]
    if thieu:
        raise ValueError(f"bảng {meta.get('sheet_id')} thiếu cột {thieu} — tiêu đề: {values[0]}")

    def o(r, k):
        i = cot.get(k)
        return str(r[i]).strip() if i is not None and i < len(r) and r[i] is not None else ""

    ra = []
    for so_dong, r in enumerate(values[1:], start=2):
        order_no, tracking = o(r, "order_no"), re.sub(r"\s+", "", o(r, "tracking"))
        if not order_no and not tracking:
            continue
        qty = doc_so(o(r, "quantity"))
        ra.append({
            "market": meta["market"], "shop_label": meta["shop_label"], "sheet_id": meta["sheet_id"],
            "row_no": so_dong,
            "marketer": o(r, "marketer"), "recon": o(r, "recon"), "note": o(r, "note"),
            "status": o(r, "status"),
            "order_date": doc_ngay(o(r, "order_date")), "ship_date": doc_ngay(o(r, "ship_date")),
            "ship_method": o(r, "ship_method"),
            "order_no": order_no, "tracking": tracking,
            "return_order_no": re.sub(r"\s+", "", o(r, "return_order_no")),
            "sku": o(r, "sku"), "quantity": int(qty) if qty is not None else None,
            "contact_name": o(r, "contact_name"), "phone": o(r, "phone"),
            "country": o(r, "country"), "state": o(r, "state"), "city": o(r, "city"),
            "address": o(r, "address"), "postcode": o(r, "postcode"),
            "cod": doc_so(o(r, "cod")), "currency": o(r, "currency"),
            "synced_at": synced_at,
        })
    return ra


def doc_sheet(sheet_id: str, gid: str = "0") -> list:
    """Đọc cả tab (theo gid) bằng tài khoản dịch vụ trong GOOGLE_APPLICATION_CREDENTIALS.
    Bảng phải CHIA SẺ quyền Người xem cho email tài khoản đó — không cần để công khai."""
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    creds, _ = google.auth.default(scopes=SCOPES)
    s = AuthorizedSession(creds)
    base = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}"
    meta = s.get(base, params={"fields": "sheets.properties(title,sheetId)"}, timeout=60)
    meta.raise_for_status()
    tabs = {str(t["properties"]["sheetId"]): t["properties"]["title"] for t in meta.json().get("sheets", [])}
    ten = tabs.get(str(gid))
    if ten is None:
        raise ValueError(f"bảng {sheet_id} không có tab gid={gid} (có: {tabs})")
    r = s.get(f"{base}/values/'{ten}'!A1:AZ", params={"valueRenderOption": "FORMATTED_VALUE"}, timeout=60)
    r.raise_for_status()
    return r.json().get("values", [])
