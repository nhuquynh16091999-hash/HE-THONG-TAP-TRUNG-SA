import os, collections, datetime, time, re, json
# Key: env thắng → key runtime (máy chạy launchd) → key trong repo (máy dev). Trước đây
# hardcode /Users/syanh/... nên script chỉ chạy được đúng một máy.
_KEY_UNGVIEN=[os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'),
              os.path.expanduser('~/talpha_reports/runtime/bigquery_key.json'),
              os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),'bigquery_key.json')]
KEY=next((k for k in _KEY_UNGVIEN if k and os.path.exists(k)), _KEY_UNGVIEN[1])
os.environ['GOOGLE_APPLICATION_CREDENTIALS']=KEY
from google.cloud import bigquery
import gspread
from google.oauth2.service_account import Credentials
from gspread.exceptions import APIError, SpreadsheetNotFound
import calendar as _cal
_T=datetime.date.today()
PROJECT='cty-507710'; DS='TALPHA_Dataset'
FROM=_T.replace(day=1).isoformat(); TO=_T.isoformat()  # ngày ĐỘNG: đầu tháng -> hôm nay
# ── RULE CHUNG: đọc từ talpha_rules.json qua loader (golden-test 29/07 = 100% khớp bản cũ).
# Sửa rule (marketer/tỷ giá/thị trường/test) → sửa talpha_rules.json, KHÔNG sửa tại đây.
from talpha_rules import (RATE, LOCALCUR, MONEY_DIV, ALLM, MARKETS, SHOP2MKT, GTC_CAT, POS_TZ,
                          NUMID, norm_nv, norm_pos_nv, is_test, PRIMARY_MARKET,
                          DISPLAY, EXTERNAL_DISPLAY, norm_pos_external, norm_nv_external,
                          UNASSIGN, bucket_nv, campaign_market,
                          camp_san_pham, tao_chi_muc_page, tim_camp_theo_page)
# SHOP2MKT + norm_pos_nv: import từ talpha_rules (xem trên)
def parse_camp(cn):
    p=[x.strip() for x in (cn or "").split("/")]
    if not p: return None,None,None
    # Tìm ô đầu tiên là tên thị trường (bất kể tiền tố như "Tặng/", "LADI/"...);
    # marketer là ô ngay SAU thị trường.
    mi=next((i for i,s in enumerate(p) if s.upper() in MARKETS), None)
    if mi is not None:
        # CHUẨN: NƯỚC/MARKETER/TỆPKHÁCH/MÃSANPHAM/TENTRANG/NGAY — marketer là ô ngay SAU nước.
        mkt=MARKETS[p[mi].upper()]
        nv=norm_nv(p[mi+1]) if mi+1<len(p) else None
    else:
        # KIỂU MỚI (chuẩn 09/2026, xem talpha_rules._camp_naming_note):
        #   MARKETER/TỆPKHÁCH/SANPHAM/TRANG/NGAY — KHÔNG ghi thị trường nữa vì chỉ còn một.
        # Nhánh này TRƯỚC ĐÂY return None: càng đặt tên đúng chuẩn mới thì càng bị vứt.
        # Ngày 10/09/2026 nó nuốt 17,6tr / 26,8tr tiền ads tháng 9 (66%) mà không ai thấy.
        # Quét ô đầu và ô hai để chịu được tiền tố lạ ("Tặng/", "LADI/").
        idx=next((i for i,s in enumerate(p[:2]) if norm_nv(s)), None)
        if idx is None: return None,None,None
        nv=norm_nv(p[idx]); mkt=PRIMARY_MARKET
    # Sản phẩm = ô thứ HAI sau marketer (ô ngay sau là tệp khách) — cả tên có lẫn không có ô
    # nước. Xem camp_san_pham trong talpha_rules.py: hai lỗi đọc ô sửa 16/09/2026 nằm ở đó.
    prod=camp_san_pham(cn)[0] or "(khác)"
    return mkt,nv,prod
# File theo nước của từng marketer: map đọc từ <nước>_files.json — xem FILE_NUOC bên dưới.
# (MARKET_MAP gõ tay trong code — bộ 30 file GCC của team cũ — bỏ 09/09/2026.)
TONG_MAP={}  # Không còn file "TỔNG ADS" riêng từng người. Tổng MỌI nước của một người nằm ở
# tab của người đó trong file TỔNG TEAM.
# Vòng lặp file riêng + TEST bên dưới duyệt theo FILE_NUOC/TESTMAP, KHÔNG theo TONG_MAP nữa.
GRAND_KEY="1Ur-U71lxBvnb0ysRbzYhRPcgyLp3P78o2bvIJ9hIs8s"  # "TỔNG TEAM THÁNG 9" — bản Google
# Sheets trong thư mục Drive "Tháng 9" (1PQBdfGS2n…). Bản .xlsx cùng tên (1P5UfXCOD2…) là file
# CEO tải lên, job KHÔNG ghi vào được (Sheets API chỉ mở file Google Sheets native).
# Mỗi tháng CEO tạo file mới; ID tháng 8 là 1B5kzf8uXp3RG1YzKSKMyLUsc5CsLmdDduJRWG2PB4gM
# — ĐỪNG dùng lại ID tháng cũ, write_file() xoá sạch tab rồi ghi đè.
DAYS=[datetime.date(_T.year,_T.month,d) for d in range(1,_cal.monthrange(_T.year,_T.month)[1]+1)]  # đủ ngày tháng hiện tại
bq=bigquery.Client(project=PROJECT)
cell=collections.defaultdict(lambda:{"spend":0.0,"msg":0,"pur":0,"orders":0,"cod":0.0,"cod_gtc":0.0})
# ── CAMP TEST (duyệt 06/07): campaign chứa từ "test/TEST/Test" = test sản phẩm →
# TÁCH khỏi mọi báo cáo doanh số (file thị trường + TỔNG marketer + TỔNG TEAM),
# gom vào 1 file Test riêng cho mỗi marketer (chung mọi thị trường, tab theo sản phẩm).
from talpha_rules import NO_TEST_MARKETS  # is_test đã import ở đầu file; rule test nằm trong talpha_rules.json
from talpha_rules import RULES as _RULES
RULES_MARKETS={m: v for m, v in _RULES["markets"].items() if isinstance(v, dict)}
cell_test=collections.defaultdict(lambda:{"spend":0.0,"msg":0,"pur":0,"orders":0,"cod":0.0,"cod_gtc":0.0})
test_pages=set(); main_pages=set()  # page thuộc camp test / camp thường (để chia đơn không có ad_id)
# ADS: spend/tin nhắn/purchases theo campaign (giữ nguyên).
# 20/08: camp không parse được (typo thị trường 'TAIWAIN', tên không theo format 'tt 20/7')
# trước đây bị bỏ IM LẶNG — spend biến mất khỏi mọi báo cáo mà không ai biết. Nay gom lại
# và in cảnh báo ở cuối (report_health đọc tail log → bot WA thấy được).
DROPPED=collections.defaultdict(float)
# 15/09/2026 — ba thị trường. Campaign KHÔNG ghi nước ở tên (tên cũ "Lộc/Philippine/…")
# vẫn tính Đài (Sỹ Anh chốt), nhưng gom lại để in cảnh báo: có Singapore, UAE rồi thì
# một campaign Singapore quên ghi "SG/" sẽ lặng lẽ chạy vào số của Đài.
THIEU_NUOC=collections.defaultdict(float)
for r in bq.query(f"SELECT date, campaign_name, SUM(spend) spend, SUM(messaging_conversations_started) msg, SUM(purchases) pur FROM `{PROJECT}.{DS}.fb_ads_data` WHERE date BETWEEN '{FROM}' AND '{TO}' GROUP BY date, campaign_name").result():
    mkt,nv,prod=parse_camp(r.campaign_name)
    if not mkt or not nv:
        _p=[x.strip() for x in (r.campaign_name or '').split('/')]
        _mi=next((i for i,s in enumerate(_p) if s.upper() in MARKETS), None)
        _slot=_p[_mi+1] if (_mi is not None and _mi+1<len(_p)) else ''
        if not norm_nv_external(_slot):   # người ngoài team là CỐ Ý loại, không cảnh báo
            DROPPED[r.campaign_name or '(tên rỗng)']+=r.spend or 0
        continue
    # Người đã nghỉ (unassign_marketers): ĐỔI Ô ĐÍCH sang "(không gán)", KHÔNG bỏ camp.
    # Đặt SAU nhánh DROPPED ở trên để spend còn sót của họ vẫn được đếm và soi được,
    # chỉ là không mang tên ai.
    if campaign_market(r.campaign_name)[1]=="mac_dinh": THIEU_NUOC[r.campaign_name or "(tên rỗng)"]+=r.spend or 0
    nv=bucket_nv(nv)
    t=is_test(r.campaign_name, mkt)
    pid=camp_san_pham(r.campaign_name)[2]
    if pid:
        (test_pages if t else main_pages).add(pid)
    c=(cell_test if t else cell)[(nv,mkt,prod,str(r.date))]; c["spend"]+=r.spend or 0; c["msg"]+=r.msg or 0; c["pur"]+=r.pur or 0
# ad_id → chủ campaign (marketer) — dùng cho FALLBACK đơn không tag (duyệt 06/07).
# X9 (06/08): POS không phải lúc nào cũng ghi ad_id vào ô `ad_id` — 999 đơn/10.634 (9,4%)
# mang ADSET id ở ô đó. Nạp CẢ adset vào chung bảng tra; ad_id nạp SAU để đè lên adset
# nếu trùng (bản ad chính xác hơn). Trượt cả hai mới coi là không gán được.
ad2nv={}; test_ads=set(); ad2sp={}; ad2camp={}   # ad/adset → sản phẩm / tên campaign — dự phòng khi nguồn đơn không khớp
for _tbl,_col in (("fb_adset_data","adset_id"), ("fb_ads_data","ad_id")):
    for r in bq.query(f"SELECT DISTINCT CAST({_col} AS STRING) ad_id, campaign_name FROM `{PROJECT}.{DS}.{_tbl}` WHERE date BETWEEN '{FROM}' AND '{TO}' AND {_col} IS NOT NULL").result():
        _m,_nv,_p=parse_camp(r.campaign_name)
        # Người đã nghỉ không vào bảng tra — nếu không, đơn không tag lại theo ad_id
        # chui ngược vào ô của họ, đúng thứ vừa bỏ đi.
        if _nv and _nv not in UNASSIGN and r.ad_id: ad2nv[r.ad_id]=_nv
        if r.ad_id and is_test(r.campaign_name, _m): test_ads.add(r.ad_id)
        if r.ad_id and _p: ad2sp[r.ad_id]=_p
        if r.ad_id: ad2camp[r.ad_id]=r.campaign_name
purely_test_pages=test_pages-main_pages  # page CHỈ chạy camp test → đơn không ad_id trên page đó = test
# ĐƠN HÀNG — MARKETER: ưu tiên TAG marketer trong POS (JSON $.name) (rule CEO, không đổi).
# Đơn KHÔNG tag → chủ CAMPAIGN nối được theo nguồn đơn → chủ campaign của quảng cáo (ad_id).
# Vẫn không gán được → gom "(không gán)" (chỉ hiện ở file TỔNG THÁNG, không bỏ lặng lẽ).
UNASSIGNED="(không gán)"
# Tiền tố đánh dấu người ngoài team — để grand_tab() loại khỏi TỔNG mà vẫn có tab riêng.
EXT_PREFIX="~ngoai~"
# ── NỐI ĐƠN → CAMPAIGN THEO NGUỒN ĐƠN (Sỹ Anh chốt 17/09/2026) ──
# Đơn lấy từ POS → cột "Nguồn đơn" (tên page) → khớp ô tên page trong tên camp Meta → ra camp
# đó → ra sản phẩm, marketer, tiền ads. Luật khớp và chọn camp khi một page chạy nhiều camp nằm
# ở tim_camp_theo_page (talpha_rules.py, có test). Chỉ mục lấy thêm 30 ngày trước đầu tháng:
# đơn đầu tháng hay đến từ camp chạy cuối tháng trước.
CHI_MUC=tao_chi_muc_page([(r.campaign_name, str(r.date), r.spend or 0) for r in bq.query(
    f"SELECT date, campaign_name, SUM(spend) spend FROM `{PROJECT}.{DS}.fb_ads_data` "
    f"WHERE date BETWEEN DATE_SUB(DATE '{FROM}', INTERVAL 30 DAY) AND '{TO}' GROUP BY 1, 2").result()])
# Cột page_name/seller_name có từ 17/09/2026. Vòng sync đầu tiên sau deploy mới thêm cột — trước
# đó query vẫn chạy, chỉ là chưa có nguồn đơn (đơn nối theo quảng cáo như cũ, không nổ).
_COT_DON={f.name for f in bq.get_table(f"{PROJECT}.{DS}.sale_order").schema}
_cot=lambda c: c if c in _COT_DON else f"CAST(NULL AS STRING) AS {c}"
DON=list(bq.query(f"""SELECT CAST(id AS STRING) id, DATE(TIMESTAMP(inserted_at),'{POS_TZ}') d,
    JSON_EXTRACT_SCALAR(marketer,'$.name') nm, shop_label, page_id, {_cot('page_name')}, {_cot('seller_name')},
    CAST(ad_id AS STRING) ad_id, CAST(adset_id AS STRING) adset_id, status_name,
    IFNULL(cod,0) cod, IF(status_category='{GTC_CAT}', IFNULL(cod,0), 0) cod_gtc
  FROM `{PROJECT}.{DS}.sale_order`
  WHERE DATE(TIMESTAMP(inserted_at),'{POS_TZ}') BETWEEN '{FROM}' AND '{TO}' AND status_category NOT IN ('HUY','DON_THO')
  ORDER BY d DESC, shop_label, id""").result())
DEM_KHOP=collections.Counter()
for r in DON:
    mkt=SHOP2MKT.get((r.shop_label or "").upper())
    if not mkt: continue
    cqc=ad2camp.get(r.ad_id or "") or ad2camp.get(r.adset_id or "")
    camp,cach=tim_camp_theo_page(r.page_name, str(r.d), CHI_MUC, cqc)
    DEM_KHOP[cach]+=1
    _m,nv_camp,sp_camp=parse_camp(camp) if camp else (None,None,None)
    # Người NGOÀI TEAM chạy chung TKQC + bán chung shop POS. Nhận diện TRƯỚC bậc 2 để
    # camp/ad_id không đẩy đơn của họ sang người trong team.
    nv = norm_pos_nv(r.nm)
    if not nv:
        ex = norm_pos_external(r.nm)
        nv = EXT_PREFIX + ex if ex else (nv_camp or ad2nv.get(r.ad_id or "") or ad2nv.get(r.adset_id or "") or UNASSIGNED)
    prod = sp_camp or ad2sp.get(r.ad_id or "") or ad2sp.get(r.adset_id or "") or "(khác)"
    # Đã nghỉ → "(không gán)" (bucket_nv), kể cả khi tag POS ghi đúng tên họ.
    nv=bucket_nv(nv)
    # Đơn từ camp TEST (ad_id thuộc camp test, hoặc page chỉ chạy test) → tách khỏi báo cáo doanh số.
    # Thị trường miễn rule test (Taiwan) → đơn LUÔN tính thật.
    t=(mkt not in NO_TEST_MARKETS) and ((r.ad_id in test_ads) or (str(r.page_id) in purely_test_pages))
    c=(cell_test if t else cell)[(nv,mkt,prod,str(r.d))]; c["orders"]+=1; c["cod"]+=r.cod or 0; c["cod_gtc"]+=r.cod_gtc or 0
def H(local): return ["Ngày","TỔNG TIỀN ADS","SỐ TIN NHẮN","Giá Tiền/TN","CPO","Tỷ lệ chốt","Số đơn",local,"Tỉ giá","Doanh Số","DS Giao TC","% Ads/DT","% Ads/DT giao","TB đơn"]
def drow(day,c,rate,div):
    # X13: `div` là số chia của CHÍNH thị trường đó (MONEY_DIV) — GCC 100, Đài 1.
    # Gõ thẳng /100 ở đây là làm tiền Đài tụt 100 lần trên Sheet.
    s=c["spend"];m=c["msg"];o=c["orders"];rev=c["cod"]/div*rate;loc=c["cod"]/div;gtc=c["cod_gtc"]/div*rate
    return [day,round(s),m,round(s/m) if m else 0,round(s/o) if o else 0,round(o/m*100,2) if m else 0,o,round(loc),rate,round(rev),round(gtc),round(s/rev*100,2) if rev else 0,round(s/gtc*100,2) if gtc else 0,round(rev/o) if o else 0]
def market_tab(cells,rate,local,div):
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"cod":0.0,"cod_gtc":0.0} for d in DAYS}
    for k,c in cells.items():
        if k[3] in pd:
            for kk in("spend","msg","orders","cod","cod_gtc"): pd[k[3]][kk]+=c[kk]
    rows=[H(local)]; tot={"spend":0,"msg":0,"orders":0,"cod":0,"cod_gtc":0}
    for d in DAYS:
        c=pd[str(d)]; rows.append(drow(d.strftime("%d/%m/%Y"),c,rate,div))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(drow("TỔNG",tot,rate,div)); return rows
def vrow(day,c):
    s=c["spend"];m=c["msg"];o=c["orders"];rev=c["rev"];gtc=c["rev_gtc"]
    return [day,round(s),m,round(s/m) if m else 0,round(s/o) if o else 0,round(o/m*100,2) if m else 0,o,"","",round(rev),round(gtc),round(s/rev*100,2) if rev else 0,round(s/gtc*100,2) if gtc else 0,round(rev/o) if o else 0]
def combined_tab(nv):  # cộng tất cả thị trường, VND
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"rev":0.0,"rev_gtc":0.0} for d in DAYS}
    for k,c in cell.items():
        if k[0]!=nv or k[3] not in pd: continue
        pd[k[3]]["spend"]+=c["spend"]; pd[k[3]]["msg"]+=c["msg"]; pd[k[3]]["orders"]+=c["orders"]; pd[k[3]]["rev"]+=c["cod"]/MONEY_DIV[k[1]]*RATE[k[1]]; pd[k[3]]["rev_gtc"]+=c["cod_gtc"]/MONEY_DIV[k[1]]*RATE[k[1]]
    rows=[H("Tiền (local)")]; tot={"spend":0,"msg":0,"orders":0,"rev":0,"rev_gtc":0}
    for d in DAYS:
        c=pd[str(d)]; rows.append(vrow(d.strftime("%d/%m/%Y"),c))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(vrow("TỔNG",tot)); return rows
def test_tab(nv, prod=None):  # file TEST: gộp mọi thị trường (VND); prod=None → tất cả sản phẩm test
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"rev":0.0,"rev_gtc":0.0} for d in DAYS}
    for k,c in cell_test.items():
        if k[0]!=nv or (prod is not None and k[2]!=prod) or k[3] not in pd: continue
        pd[k[3]]["spend"]+=c["spend"]; pd[k[3]]["msg"]+=c["msg"]; pd[k[3]]["orders"]+=c["orders"]; pd[k[3]]["rev"]+=c["cod"]/MONEY_DIV[k[1]]*RATE[k[1]]; pd[k[3]]["rev_gtc"]+=c["cod_gtc"]/MONEY_DIV[k[1]]*RATE[k[1]]
    rows=[H("Tiền (local)")]; tot={"spend":0,"msg":0,"orders":0,"rev":0,"rev_gtc":0}
    for d in DAYS:
        c=pd[str(d)]; rows.append(vrow(d.strftime("%d/%m/%Y"),c))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(vrow("TỔNG",tot)); return rows
def grand_tab():  # cộng marketer TRONG TEAM + TẤT CẢ thị trường, quy VND
    # 10/08: TỔNG chỉ gồm người TRONG TEAM. Trước đây cộng tất cả các ô nên đơn của
    # người ngoài team (nằm ở "(không gán)") bị tính vào số của team — lệch ~381tr/10 ngày.
    # 02/09 (CEO chốt): loại luôn cả ô "(không gán)". Từ khi Mai/Thế nghỉ, ô này ôm số
    # của người đã nghỉ nên cộng vào TỔNG là thổi số team lên (đo 01–02/09: +34,6tr).
    # TỔNG = đúng người đang chạy; tab "(không gán)" vẫn còn nguyên để CEO lọc tay.
    # Đây cũng là cách tin WhatsApp tính TỔNG TEAM — hai báo cáo nay khớp nhau.
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"rev":0.0,"rev_gtc":0.0} for d in DAYS}
    for k,c in cell.items():
        if k[3] not in pd or k[0]==UNASSIGNED or str(k[0]).startswith(EXT_PREFIX): continue
        pd[k[3]]["spend"]+=c["spend"]; pd[k[3]]["msg"]+=c["msg"]; pd[k[3]]["orders"]+=c["orders"]; pd[k[3]]["rev"]+=c["cod"]/MONEY_DIV[k[1]]*RATE[k[1]]; pd[k[3]]["rev_gtc"]+=c["cod_gtc"]/MONEY_DIV[k[1]]*RATE[k[1]]
    rows=[H("Tiền (local)")]; tot={"spend":0,"msg":0,"orders":0,"rev":0,"rev_gtc":0}
    for d in DAYS:
        c=pd[str(d)]; rows.append(vrow(d.strftime("%d/%m/%Y"),c))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(vrow("TỔNG",tot)); return rows
def safe(t,used):
    t=re.sub(r'[\[\]\:\*\?/\\]',' ',str(t)).strip()[:90] or "(khác)"; b=t; i=2
    while t.lower() in used: t=f"{b} {i}"; i+=1
    used.add(t.lower()); return t
DG=(.21,.34,.14);ORG=(.96,.69,.52);PCH=(.99,.89,.84);PNK=(.93,.76,.84);LBL=(.87,.92,.97);BLU=(.74,.84,.93);GRN=(.66,.82,.56);GRND=(.78,.94,.81);YEL=(1.,1.,0.);WHT=(1,1,1);RED=(.86,0.,0.)
def cc(r): return {"red":r[0],"green":r[1],"blue":r[2]}
NUM="#,##0";DDv='#,##0" đ"';PCT='0.00"%"'
CMETA=[(DG,1,WHT,None),(ORG,0,PCH,NUM),(PNK,0,PCH,NUM),(LBL,0,WHT,DDv),(LBL,0,WHT,DDv),(LBL,0,WHT,PCT),(BLU,0,PCH,NUM),(ORG,0,PCH,NUM),(ORG,0,PCH,NUM),(GRN,0,GRND,NUM),(GRN,0,GRND,NUM),(YEL,0,WHT,PCT),(YEL,0,WHT,PCT),(YEL,0,WHT,DDv)]
def freq(sid,nr):
    t=nr-1; R=[{"updateSheetProperties":{"properties":{"sheetId":sid,"gridProperties":{"frozenRowCount":1}},"fields":"gridProperties.frozenRowCount"}}]
    for ci,(hbg,hw,dbg,nf) in enumerate(CMETA):
        R.append({"repeatCell":{"range":{"sheetId":sid,"startRowIndex":0,"endRowIndex":1,"startColumnIndex":ci,"endColumnIndex":ci+1},"cell":{"userEnteredFormat":{"backgroundColor":cc(hbg),"horizontalAlignment":"CENTER","verticalAlignment":"MIDDLE","wrapStrategy":"WRAP","textFormat":{"bold":True,"fontSize":9,"foregroundColor":cc(WHT if hw else (0,0,0))}}},"fields":"userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)"}})
        cf={"backgroundColor":cc(dbg)};fl="userEnteredFormat.backgroundColor"
        if nf: cf["numberFormat"]={"type":"NUMBER","pattern":nf};fl+=",userEnteredFormat.numberFormat"
        if ci>=1: cf["horizontalAlignment"]="RIGHT";fl+=",userEnteredFormat.horizontalAlignment"
        cf["textFormat"]={"foregroundColor":cc((0,0,0)),"bold":False}; fl+=",userEnteredFormat.textFormat"  # ép chữ ĐEN, xoá chữ trắng sót
        R.append({"repeatCell":{"range":{"sheetId":sid,"startRowIndex":1,"endRowIndex":nr,"startColumnIndex":ci,"endColumnIndex":ci+1},"cell":{"userEnteredFormat":cf},"fields":fl}})
    R.append({"repeatCell":{"range":{"sheetId":sid,"startRowIndex":t,"endRowIndex":t+1,"startColumnIndex":0,"endColumnIndex":14},"cell":{"userEnteredFormat":{"backgroundColor":cc(RED),"textFormat":{"bold":True,"foregroundColor":cc(WHT)}}},"fields":"userEnteredFormat.backgroundColor,userEnteredFormat.textFormat"}})
    return R
gc=gspread.authorize(Credentials.from_service_account_file(KEY,scopes=['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive']))
def do(fn):
    for a in range(7):
        try: return fn()
        except APIError as e:
            es=str(e)
            # 20/08: thêm '-1]'/'DOCTYPE' — Google có lúc trả trang HTML lỗi thay vì JSON
            # (log 09/08: APIError [-1]: <!DOCTYPE html>), bản cũ không retry → chết cả chain.
            if any(x in es for x in ('429','500','502','503','RATE','unavailable','Internal','[-1]','DOCTYPE')): time.sleep(15); continue
            raise
    return fn()
# TALPHA_FORMAT_DRY=1: chỉ IN file nào sẽ nhận tab nào, KHÔNG mở Sheets — để soát bố cục
# bằng số thật trước khi đổi cách ghi (đổi bố cục là write_file xoá sạch tab cũ của file).
DRY=os.environ.get("TALPHA_FORMAT_DRY")=="1"
def write_file(key, tabs, title=None, month_suffix=False):
    if DRY:
        print(f"    [DRY] {key}: {len(tabs)} tab — " + " · ".join(f"{t} ({rows[-1][6]} đơn)" for t,rows in tabs)); return
    # 20/08 FIX: `sh.sheet1` CŨNG gọi API (fetch_sheet_metadata). Bản cũ để nó NGOÀI do()
    # nên 1 lần Google trả 503 là chết cả chain → file thị trường mang số mới, file TỔNG
    # mang số cũ (báo cáo nửa vời, đã xảy ra 18/344 vòng). Nay bọc chung trong do().
    sh, first = do(lambda: (lambda s: (s, s.sheet1))(gc.open_by_key(key))); nr=len(tabs[0][1])
    # Tên file tự đặt theo tháng đang chạy — trước đây gõ tay nên tháng 8 vẫn ghi
    # "THÁNG 7" suốt (CEO phát hiện 10/08).
    # month_suffix: giữ nguyên tên gốc, chỉ thay đuôi ' T<tháng>' (file [Test] mỗi người
    # đặt tên một kiểu — Loc/Chu Thuý/Nhung — nên KHÔNG dựng lại tên từ đầu).
    if month_suffix and not title:
        title = re.sub(r'\s*[Tt]\d{1,2}$', '', sh.title).strip() + f' T{_T.month}'
    if title and sh.title != title:
        try: do(lambda: sh.update_title(title)); print(f'    đổi tên file → {title}')
        except Exception as e: print(f'    (không đổi được tên file: {e})')
    ex=do(lambda: sh.worksheets())
    dr=[{"deleteSheet":{"sheetId":w.id}} for w in ex[1:]]
    if dr: do(lambda: sh.batch_update({"requests":dr}))
    # 01/09 FIX: lưới phải ĐÚNG nr dòng, không phải nr+2. Bản cũ chừa 2 dòng thừa mà
    # values_batch_update chỉ ghi đè tới dòng nr → tháng ngắn hơn tháng trước thì dòng
    # TỔNG của tháng cũ SỐNG SÓT ngay dưới dòng TỔNG mới. Tháng 9 (30 ngày) kế tháng 8
    # (31 ngày) là dính: dòng 33 còn nguyên tổng tháng 8 trong cả 46 file.
    # freq() format tới hết dòng nr (dòng đỏ ở t=nr-1) nên rowCount=nr là vừa đủ.
    rq=[{"updateSpreadsheetProperties":{"properties":{"locale":"vi_VN"},"fields":"locale"}},{"updateSheetProperties":{"properties":{"sheetId":first.id,"title":tabs[0][0],"gridProperties":{"rowCount":nr,"columnCount":14}},"fields":"title,gridProperties"}}]
    for t,_ in tabs[1:]: rq.append({"addSheet":{"properties":{"title":t,"gridProperties":{"rowCount":nr,"columnCount":14}}}})
    do(lambda: sh.batch_update({"requests":rq}))
    do(lambda: sh.values_batch_update({"valueInputOption":"RAW","data":[{"range":f"'{t}'!A1","values":rows} for t,rows in tabs]}))
    wm={w.title:w.id for w in do(lambda: sh.worksheets())}
    fr=[]
    for t,_ in tabs: fr+=freq(wm[t],nr)
    do(lambda: sh.batch_update({"requests":fr}))
n=0
# 8 TỔNG files
for emp,key in TONG_MAP.items():
    used=set(); tabs=[("Tổng",combined_tab(emp))]; used.add("tổng")
    for mkt in ALLM:
        sub={k:v for k,v in cell.items() if k[0]==emp and k[1]==mkt}
        tabs.append((safe(mkt.upper(),used),market_tab(sub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt])))
    # title: trước đây chỉ file GRAND được đổi tên → 7 file này kẹt tên 'THÁNG 7' suốt tháng 8.
    write_file(key,tabs,title=f"TỔNG ADS THÁNG {_T.month}"); n+=1; print(f"[{n}] TỔNG {emp}: {len(tabs)} tab"); time.sleep(1.0)
# ── FILE RIÊNG: MỖI MARKETER × MỖI NƯỚC MỘT FILE ──
# 16/09/2026 — Sỹ Anh chốt: mỗi nước một file ("TAIWAN T9", "SINGAPORE T9", "UAE T9"… trong
# thư mục của từng người). Bản 15/09 gộp mọi nước vào MỘT file, mỗi nước một tab — nhưng tên
# file vẫn là "TAIWAN T9", mở thư mục ra tưởng thiếu Singapore.
# Nên file nào cũng chỉ MỘT nước, bố cục như trước giờ: "Tổng" = bảng của nước đó (tiền địa
# phương + tỷ giá), rồi mỗi sản phẩm một tab. Tên file do CEO đặt — code không đổi tên.
# ID ở <key thị trường viết thường>_files.json cạnh script — taiwan_files.json,
# singapore_files.json, uae_files.json — dạng {key marketer: ID}. Service account KHÔNG tự
# tạo được file (quota Drive của nó = 0): người tạo sheet trong thư mục marketer, rồi thêm ID.
_HERE=os.path.dirname(os.path.abspath(__file__))
def _mapping_path(ten):  # chạy được ở CẢ repo lẫn runtime: file cạnh script thắng
    canh=os.path.join(_HERE,ten)
    return canh if os.path.exists(canh) else os.path.join(os.path.expanduser('~/talpha_reports'),ten)
def _doc_map(ten):
    # Chưa có file map = nước đó chưa ai có file → {}. Có file mà JSON hỏng thì CHO NỔ: nuốt
    # lỗi là cả một nước ngừng ghi mà không ai hay (vòng lỗi thì tin Zalo 8h30 báo số cũ).
    p=_mapping_path(ten)
    return json.load(open(p)) if os.path.exists(p) else {}
FILE_NUOC={mkt: _doc_map(f"{mkt.lower()}_files.json") for mkt in ALLM}
_TEN_NUOC={m: v.get("display", m) for m, v in RULES_MARKETS.items()}
def nuoc_co_so(cells, loc=lambda k: True):
    """Các nước có số (chi tiêu hoặc đơn) trong tập ô, xếp Đài trước rồi theo thứ tự cấu hình."""
    co={k[1] for k,c in cells.items() if loc(k) and (c["spend"] or c["orders"] or c["msg"])}
    return [m for m in ALLM if m in co]
def tabs_mot_nuoc(emp, mkt):
    sub={k:v for k,v in cell.items() if k[0]==emp and k[1]==mkt}
    used=set(); used.add("tổng")
    tabs=[("Tổng",market_tab(sub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt]))]
    prods=sorted({k[2] for k in sub}, key=lambda p:(-sum(sub[x]["spend"] for x in sub if x[2]==p), str(p)))
    for prod in prods:
        psub={k:v for k,v in sub.items() if k[2]==prod}; tabs.append((safe(prod,used),market_tab(psub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt])))
    return tabs
MAT_FILE=[]
for mkt in ALLM:
    for emp,key in FILE_NUOC[mkt].items():
        if not key: continue
        tabs=tabs_mot_nuoc(emp,mkt)
        # File đã bị xoá HẲN (thùng rác Drive tự dọn sau 30 ngày) hoặc bị gỡ quyền: bỏ qua riêng
        # file đó, KHÔNG làm chết cả vòng — nổ ở đây là file TỔNG TEAM ghi phía sau đứng số, và
        # tin Zalo 8h30 đọc đúng file đó. Dính thật 16/09/2026: thư mục ANH nằm trong thùng rác
        # từ trước, job vẫn ghi vào file trong đó mỗi giờ — tới ngày thùng rác dọn là nổ.
        try: write_file(key,tabs)
        except SpreadsheetNotFound:
            MAT_FILE.append((emp,mkt,key)); print(f"[SKIP] FILE {emp}/{mkt}: không mở được {key} — đã xoá hẳn hoặc mất quyền"); continue
        n+=1; print(f"[{n}] FILE {emp}/{mkt}: {len(tabs)} tab — https://docs.google.com/spreadsheets/d/{key}")
# Người CÓ SỐ ở một nước mà chưa có file nước đó: số KHÔNG mất — vẫn nằm trong file TỔNG TEAM
# (tab của người đó + tab nước) — nhưng thư mục riêng của họ thiếu file. Cảnh báo ở cuối log.
THIEU_FILE=sorted({(k[0],k[1]) for k,c in cell.items()
                   if (c["spend"] or c["orders"] or c["msg"]) and k[0] in DISPLAY and k[0] not in UNASSIGN
                   and not FILE_NUOC.get(k[1],{}).get(k[0])})
CO_FILE={emp for m in FILE_NUOC.values() for emp,key in m.items() if key}
# 1 file TỔNG THÁNG — gộp tất cả marketer: tab "Tổng" (all mkt) + 1 tab mỗi marketer
if GRAND_KEY and not GRAND_KEY.endswith("placeholder"):
    used=set(); tabs=[("Tổng",grand_tab())]; used.add("tổng")
    # Tab theo ROSTER trong talpha_rules.json (không phải TONG_MAP) — người mới vào team
    # là có tab ngay, không cần chờ tạo file Sheet riêng cho họ.
    # 01/09: người ĐÃ NGHỈ vẫn nằm trong roster (để đơn rơi rớt của họ không biến mất
    # vào "(không gán)") nhưng KHÔNG nên chiếm một tab trống trong báo cáo tháng sau.
    # Quy tắc: hiện tab nếu đang là thành viên chạy số (có file riêng ở một nước nào đó)
    # HOẶC tháng này còn phát sinh số. Người nghỉ mà hết đơn thì tab tự biến mất.
    for emp in DISPLAY:
        # Người đã nghỉ (unassign_marketers): KHÔNG tab — số của họ nằm ở "(không gán)".
        # Chặn tường minh ở đây để dù có ai thêm lại vào một <nước>_files.json cũng không mọc tab rỗng.
        if emp in UNASSIGN: continue
        if emp not in CO_FILE and not any(k[0] == emp for k in cell): continue
        tabs.append((safe(emp,used),combined_tab(emp)))
    # Người NGOÀI TEAM: KHÔNG có tab trong báo cáo của team (CEO chốt 10/08).
    # Số của họ vẫn bị loại khỏi tab Tổng nhờ EXT_PREFIX ở grand_tab() — chỉ là
    # không hiển thị nữa. Cần soi thì xem khối "NGOÀI TEAM" trên dashboard.
    # Đơn không gán được cho ai (không tag + ad không thuộc team) — hiện riêng, không giấu
    if any(k[0]==UNASSIGNED for k in cell): tabs.append((safe(UNASSIGNED,used),combined_tab(UNASSIGNED)))
    # Ba thị trường (15/09/2026): từ HAI nước có số trở lên thì thêm mỗi nước một tab,
    # CHỈ người trong team như tab Tổng, tiền địa phương + tỷ giá của nước đó.
    ds_nuoc=nuoc_co_so(cell, lambda k: k[0]!=UNASSIGNED and not str(k[0]).startswith(EXT_PREFIX))
    if len(ds_nuoc)>1:
        for mkt in ds_nuoc:
            sub={k:v for k,v in cell.items() if k[1]==mkt and k[0]!=UNASSIGNED and not str(k[0]).startswith(EXT_PREFIX)}
            tabs.append((safe(_TEN_NUOC[mkt],used),market_tab(sub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt])))
    write_file(GRAND_KEY,tabs,title=f"TỔNG TEAM THÁNG {_T.month}"); n+=1; print(f"[{n}] GRAND TỔNG THÁNG: {len(tabs)} tab")
# ── FILE TEST mỗi marketer (chung mọi thị trường, tab theo sản phẩm) ──
# ID file lưu ở test_files.json (tạo lần đầu qua service account, share anyone-link editor).
TESTMAP_PATH=_mapping_path('test_files.json')
try: TESTMAP=json.load(open(TESTMAP_PATH))
except Exception: TESTMAP={}
for emp in TESTMAP:
    sub={k:v for k,v in cell_test.items() if k[0]==emp}
    if not sub: continue
    key=TESTMAP.get(emp)
    if not key:
        # SA KHÔNG tự tạo được file (Google chặn quota) — user phải tạo + share rồi thêm ID
        # vào test_files.json. Thiếu file thì bỏ qua marketer này, KHÔNG làm chết cả chain.
        print(f"[SKIP] TEST {emp}: chưa có file trong {TESTMAP_PATH} — tạo sheet, share SA, thêm ID.")
        continue
    prods=sorted({k[2] for k in sub}, key=lambda p:(-sum(sub[x]["spend"] for x in sub if x[2]==p), str(p)))
    used=set(); tabs=[("Tổng",test_tab(emp))]; used.add("tổng")
    for prod in prods: tabs.append((safe(prod,used),test_tab(emp,prod)))
    write_file(key,tabs,month_suffix=True); n+=1
    print(f"[{n}] TEST {emp}: {len(tabs)} tab — https://docs.google.com/spreadsheets/d/{key}")
print("ALL DONE", n)
print("NOI NGUON DON: " + " · ".join(f"{k} {v}" for k,v in sorted(DEM_KHOP.items())))
if MAT_FILE:
    print(f"CANH BAO: {len(MAT_FILE)} file rieng KHONG MO DUOC (da xoa han hoac mat quyen) — bo khoi <nuoc>_files.json hoac tao lai file.")
    for _e,_m,_k in MAT_FILE:
        print(f"    {_e:8s} {_m:10s} {_k}")
if THIEU_FILE:
    print(f"CANH BAO: {len(THIEU_FILE)} cap nguoi/nuoc CO SO nhung CHUA CO FILE rieng — so van nam trong TONG TEAM. Tao sheet '<NUOC> T{_T.month}' trong thu muc nguoi do, them ID vao <nuoc>_files.json.")
    for _e,_m in THIEU_FILE:
        print(f"    {_e:8s} {_m:10s} -> {_m.lower()}_files.json")
if THIEU_NUOC:
    _tn=sum(THIEU_NUOC.values())
    print(f"CANH BAO: {len(THIEU_NUOC)} campaign KHONG GHI NUOC o dau ten — {_tn:,.0f} d dang tinh ve {PRIMARY_MARKET}. Doi ten thanh TW/… SG/… AE/… de khoi nham nuoc.")
    for _c,_s in sorted(THIEU_NUOC.items(), key=lambda x:-x[1])[:10]:
        print(f"    {_s:>12,.0f} d | {_c[:90]}")
if DROPPED:
    _ts=sum(DROPPED.values())
    print(f"CANH BAO: {len(DROPPED)} campaign KHONG VAO BAO CAO — {_ts:,.0f} d bi roi (ten camp sai format/typo thi truong)")
    for _c,_s in sorted(DROPPED.items(), key=lambda x:-x[1])[:10]:
        print(f"    {_s:>12,.0f} d | {_c[:90]}")
