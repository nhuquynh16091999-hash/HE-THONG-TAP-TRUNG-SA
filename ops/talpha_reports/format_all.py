import os, collections, datetime, time, re, json
KEY='/Users/syanh/talpha_reports/runtime/bigquery_key.json'
os.environ['GOOGLE_APPLICATION_CREDENTIALS']=KEY
from google.cloud import bigquery
import gspread
from google.oauth2.service_account import Credentials
from gspread.exceptions import APIError
import calendar as _cal
_T=datetime.date.today()
PROJECT='cty-507710'; DS='TALPHA_Dataset'
FROM=_T.replace(day=1).isoformat(); TO=_T.isoformat()  # ngày ĐỘNG: đầu tháng -> hôm nay
# ── RULE CHUNG: đọc từ talpha_rules.json qua loader (golden-test 29/07 = 100% khớp bản cũ).
# Sửa rule (marketer/tỷ giá/thị trường/test) → sửa talpha_rules.json, KHÔNG sửa tại đây.
from talpha_rules import (RATE, LOCALCUR, MONEY_DIV, ALLM, MARKETS, SHOP2MKT, GTC_CAT, POS_TZ,
                          NUMID, norm_nv, norm_pos_nv, is_test,
                          DISPLAY, EXTERNAL_DISPLAY, norm_pos_external, norm_nv_external,
                          UNASSIGN, bucket_nv)
def page_of(p):
    for i,seg in enumerate(p):
        if NUMID.match(seg.replace(' ','')) and i+1<len(p) and p[i+1].strip(): return p[i+1].strip()
    return None
def page_id_of(p):  # trả (page_id, tên page) từ campaign — dùng build map page_id→tên page
    for i,seg in enumerate(p):
        s=seg.replace(' ','')
        if NUMID.match(s) and i+1<len(p) and p[i+1].strip(): return s, p[i+1].strip()
    return None,None
# SHOP2MKT + norm_pos_nv: import từ talpha_rules (xem trên)
def parse_camp(cn):
    p=[x.strip() for x in (cn or "").split("/")]
    if not p: return None,None,None
    # Tìm ô đầu tiên là tên thị trường (bất kể tiền tố như "Tặng/", "LADI/"...);
    # marketer là ô ngay SAU thị trường, sản phẩm là ô kế tiếp.
    mi=next((i for i,s in enumerate(p) if s.upper() in MARKETS), None)
    if mi is None: return None,None,None
    mkt=MARKETS[p[mi].upper()]
    nv=norm_nv(p[mi+1]) if mi+1<len(p) else None
    ci=mi+2
    prod=page_of(p) or (p[ci] if len(p)>ci and p[ci] else "(khác)")
    return mkt,nv,prod
MARKET_MAP={  # THÁNG 9/2026 — thư mục Drive 1rAXMda0ENOd… (quét 31/08). Mai & Thế đã nghỉ, không còn file.
("ChuThuy","Saudi"):"1HaSZPN92LAlo3C_DnlGixRVyHME6dStaMgU7uAwGCbE",("ChuThuy","UAE"):"1WAj1XelYabijDPKp0hjRcQtty4-XQ3VZlrzzVX2ncVw",("ChuThuy","Kuwait"):"1sfzGRad8FM1Br8TW9NoxTKbk488ETIlYb9KqpPszRHI",("ChuThuy","Oman"):"1JE51T9o2R4dB-1lme6IkKis93XbI-yIuGB5dZZ8srZY",("ChuThuy","Qatar"):"1apvGBxD6_UTCqNbEKTAWdvRLR3alU7e1sBOmkm-uhG8",("ChuThuy","Bahrain"):"1L31lzTeyHiIABd4KMurTnwMMCs0_jXHJMWXtIp0dTfA",
("Loc","Saudi"):"1ot_W3Y3VyIs9rEep86nrn1-pcCj54DVUJqZnlZpqNug",("Loc","UAE"):"14QIA14udqlbfP-9iBiAbGCCSpoiJr4ymyNwWCGoPjvU",("Loc","Kuwait"):"1agummCT2AfA7XW3OEuImhcUp3zHxpj5f-cE8Y_0g7vs",("Loc","Oman"):"1A-qd-XBrFhHAdmfUMsvbOK3pZqZPBNpY1Zzl2WIWwrw",("Loc","Qatar"):"1VfjRtBruVuC33e9taLK7BIM99UHQtgpygwa3RjlpC9E",("Loc","Bahrain"):"1i8eX45J00CdS5ajLMOEy_DTATGvDlWJfP7N_HwE0yzY",
("Nhung","Saudi"):"1ss5ibZDJAoOL-VQXhHDydBWFORTFSWGFXtKfs_Am7LQ",("Nhung","UAE"):"1V47IJU8ehcKQFnazYIDAUw6HLXk7IMSZfTo9LDQc8vo",("Nhung","Kuwait"):"1S2qZOJtY7FZJaHCNGrTTvzwEwSdh-_lvhsurPCTTv3w",("Nhung","Oman"):"1zF-S-7VEM9oLlLg_kpD8wjKkGPE4TRp0gzdtEAD6aSI",("Nhung","Qatar"):"1dFJjdhHOQrvTIbAROpsYQxFMvffkjpZR-Y6ckJOIRI8",("Nhung","Bahrain"):"1GNOtttswM3epOUTf85CTAA7zTDWbq2s-mphKYsu8RBk",
("Chinh","Saudi"):"1gzXNKVO9S48_y9a5wdAuyKaQYkjsvEbfIbN3rDdc7i8",("Chinh","UAE"):"1URc6kIZa9ZbYW1XngChm431I7tScu5TKsAZX0pfozvw",("Chinh","Kuwait"):"1ORuY7TbhmMSZRS2VLiLqTkhySmJMFDkoTPMnE2bwpIk",("Chinh","Oman"):"16F9fXoitzf6sSo6Lxwi7G4lrvEH8cjuCWDQxuQOigHg",("Chinh","Qatar"):"1lIwvAc9-QSC7rIx0ZTXYyfQ5ZaZtL7XpDwqMsz27Tso",("Chinh","Bahrain"):"1Tnf3UoNRfWPbNvmLcstaLnnzT56mpxIVNeSd87mqtO0",
("SAnh","Saudi"):"1rIRLrJ_Kl6MxLapsQ5iIaUci-zqmJCBjoffW0UEvZdE",("SAnh","UAE"):"1du-Q_mFE0BZmHP67vYtawpkDaGQCzAZ8prQlA1cyhVk",("SAnh","Kuwait"):"1dyYfTXe-lhNje2Oqf3ZyMy5reOds9-SnpoYPeA9XVfw",("SAnh","Oman"):"1rKdWEt_KU5zlffEE5pGmSP3OzQxWACfQQviweavc9Ec",("SAnh","Qatar"):"1dxsmC-T_4hSs91aWJdiUQv6mLseM-6n9NwKAHF2Cdxk",("SAnh","Bahrain"):"142rGFJU6WR5pl-e8SsQGSqy0FYVlKebrwjZJSF0NbYw",
}
TONG_MAP={"ChuThuy":"1PGIqWBVLQiV7xEodxDzTs0JJHdCto0Sx5o3QiqrIc6w","Loc":"1mIR-39Q7iWQ1NwCEFRFAc_5F2WbwQXiG3yvLct_wcRY","Nhung":"1vywu0nfuV-c4s4ilAo0F5_flHG2uxF1T4_3uPMLEC00","Chinh":"1gP3_P0LrvxJGEu8kRUTJo_782kJua9kb3wsB8XrSkBI","SAnh":"1zOjGiL8L7Navcyv0Ll_VdnqS_zLgYX6GLAbop_rl1KM"}
GRAND_KEY="1cGduV47THi-4u43n66oyr1iGxoPc1x0tx5soH3YvpKA"  # file "TỔNG TEAM THÁNG 9" — gộp tất cả marketer (rỗng="" thì bỏ qua)
# Mỗi tháng CEO tạo file mới; ID tháng 8 là 1B5kzf8uXp3RG1YzKSKMyLUsc5CsLmdDduJRWG2PB4gM
# — ĐỪNG dùng lại ID tháng cũ, write_file() xoá sạch tab rồi ghi đè.
DAYS=[datetime.date(_T.year,_T.month,d) for d in range(1,_cal.monthrange(_T.year,_T.month)[1]+1)]  # đủ ngày tháng hiện tại
bq=bigquery.Client(project=PROJECT)
cell=collections.defaultdict(lambda:{"spend":0.0,"msg":0,"pur":0,"orders":0,"cod":0.0,"cod_gtc":0.0})
# ── CAMP TEST (duyệt 06/07): campaign chứa từ "test/TEST/Test" = test sản phẩm →
# TÁCH khỏi mọi báo cáo doanh số (file thị trường + TỔNG marketer + TỔNG TEAM),
# gom vào 1 file Test riêng cho mỗi marketer (chung mọi thị trường, tab theo sản phẩm).
from talpha_rules import NO_TEST_MARKETS  # is_test đã import ở đầu file; rule test nằm trong talpha_rules.json
cell_test=collections.defaultdict(lambda:{"spend":0.0,"msg":0,"pur":0,"orders":0,"cod":0.0,"cod_gtc":0.0})
test_pages=set(); main_pages=set()  # page thuộc camp test / camp thường (để chia đơn không có ad_id)
# ADS: spend/tin nhắn/purchases theo campaign (giữ nguyên). Đồng thời build map page_id → tên page (sản phẩm).
pageid2name={}
# 20/08: camp không parse được (typo thị trường 'TAIWAIN', tên không theo format 'tt 20/7')
# trước đây bị bỏ IM LẶNG — spend biến mất khỏi mọi báo cáo mà không ai biết. Nay gom lại
# và in cảnh báo ở cuối (report_health đọc tail log → bot WA thấy được).
DROPPED=collections.defaultdict(float)
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
    nv=bucket_nv(nv)
    t=is_test(r.campaign_name, mkt)
    pid,_=page_id_of([x.strip() for x in (r.campaign_name or "").split("/")])
    if pid:
        pageid2name[pid]=prod  # để đơn tra tên page qua page_id
        (test_pages if t else main_pages).add(pid)
    c=(cell_test if t else cell)[(nv,mkt,prod,str(r.date))]; c["spend"]+=r.spend or 0; c["msg"]+=r.msg or 0; c["pur"]+=r.pur or 0
# ad_id → chủ campaign (marketer) — dùng cho FALLBACK đơn không tag (duyệt 06/07).
# X9 (06/08): POS không phải lúc nào cũng ghi ad_id vào ô `ad_id` — 999 đơn/10.634 (9,4%)
# mang ADSET id ở ô đó. Nạp CẢ adset vào chung bảng tra; ad_id nạp SAU để đè lên adset
# nếu trùng (bản ad chính xác hơn). Trượt cả hai mới coi là không gán được.
ad2nv={}; test_ads=set()
for _tbl,_col in (("fb_adset_data","adset_id"), ("fb_ads_data","ad_id")):
    for r in bq.query(f"SELECT DISTINCT CAST({_col} AS STRING) ad_id, campaign_name FROM `{PROJECT}.{DS}.{_tbl}` WHERE date BETWEEN '{FROM}' AND '{TO}' AND {_col} IS NOT NULL").result():
        _m,_nv,_p=parse_camp(r.campaign_name)
        # Người đã nghỉ không vào bảng tra — nếu không, đơn không tag lại theo ad_id
        # chui ngược vào ô của họ, đúng thứ vừa bỏ đi.
        if _nv and _nv not in UNASSIGN and r.ad_id: ad2nv[r.ad_id]=_nv
        if r.ad_id and is_test(r.campaign_name, _m): test_ads.add(r.ad_id)
purely_test_pages=test_pages-main_pages  # page CHỈ chạy camp test → đơn không ad_id trên page đó = test
# ĐƠN HÀNG: ưu tiên TAG marketer trong POS (JSON $.name) + shop_label.
# Đơn KHÔNG tag / tag người ngoài team nhưng ad_id thuộc campaign team → tính cho CHỦ CAMPAIGN
# (chứng cứ cứng, không đoán — audit 06/07: ~338 đơn/6 ngày kiểu này, trước đây bị bỏ rơi).
# Vẫn không gán được → gom "(không gán)" (chỉ hiện ở file TỔNG THÁNG, không bỏ lặng lẽ).
# Sản phẩm = tên page tra từ page_id (map ở trên); không tra được → "(khác)".
UNASSIGNED="(không gán)"
# Tiền tố đánh dấu người ngoài team — để grand_tab() loại khỏi TỔNG mà vẫn có tab riêng.
EXT_PREFIX="~ngoai~"
for r in bq.query(f"SELECT DATE(TIMESTAMP(inserted_at),'{POS_TZ}') d, JSON_EXTRACT_SCALAR(marketer,'$.name') nm, shop_label, page_id, CAST(ad_id AS STRING) ad_id, SUM(cod) cod, COUNT(*) n, SUM(IF(status_category='{GTC_CAT}', cod, 0)) cod_gtc FROM `{PROJECT}.{DS}.sale_order` WHERE DATE(TIMESTAMP(inserted_at),'{POS_TZ}') BETWEEN '{FROM}' AND '{TO}' AND status_category NOT IN ('HUY','DON_THO') GROUP BY d, nm, shop_label, page_id, ad_id").result():
    # Người NGOÀI TEAM (Kính, Thắng…) chạy chung TKQC + bán chung shop POS. Nhận diện
    # TRƯỚC bậc 2 để fallback ad_id không đẩy đơn của họ sang người trong team.
    nv = norm_pos_nv(r.nm)
    if not nv:
        ex = norm_pos_external(r.nm)
        nv = EXT_PREFIX + ex if ex else (ad2nv.get(r.ad_id or "") or UNASSIGNED)
    # Đã nghỉ → "(không gán)" ngay ở bậc 1, KHÔNG rơi xuống fallback ad_id: tag POS là
    # bằng chứng đơn này của họ, để ad_id đẩy sang người khác là gán sai người.
    nv=bucket_nv(nv)
    mkt=SHOP2MKT.get((r.shop_label or "").upper())
    if not mkt: continue
    prod=pageid2name.get(str(r.page_id)) or "(khác)"
    # Đơn từ camp TEST (ad_id thuộc camp test, hoặc page chỉ chạy test) → tách khỏi báo cáo doanh số.
    # Thị trường miễn rule test (Taiwan) → đơn LUÔN tính thật.
    t=(mkt not in NO_TEST_MARKETS) and ((r.ad_id in test_ads) or (str(r.page_id) in purely_test_pages))
    c=(cell_test if t else cell)[(nv,mkt,prod,str(r.d))]; c["orders"]+=r.n or 0; c["cod"]+=r.cod or 0; c["cod_gtc"]+=r.cod_gtc or 0
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
def write_file(key, tabs, title=None, month_suffix=False):
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
# 48 market files
for (emp,mkt),key in MARKET_MAP.items():
    rate=RATE[mkt];local=LOCALCUR[mkt];div=MONEY_DIV[mkt];sub={k:v for k,v in cell.items() if k[0]==emp and k[1]==mkt}
    prods=sorted({k[2] for k in sub}, key=lambda p:-sum(sub[x]["spend"] for x in sub if x[2]==p))
    used=set(); tabs=[("Tổng",market_tab(sub,rate,local,div))]; used.add("tổng")
    for prod in prods:
        psub={k:v for k,v in sub.items() if k[2]==prod}; tabs.append((safe(prod,used),market_tab(psub,rate,local,div)))
    write_file(key,tabs); n+=1; print(f"[{n}] MKT {emp}/{mkt}: {len(tabs)} tab"); time.sleep(1.0)
# 8 TỔNG files
for emp,key in TONG_MAP.items():
    used=set(); tabs=[("Tổng",combined_tab(emp))]; used.add("tổng")
    for mkt in ALLM:
        sub={k:v for k,v in cell.items() if k[0]==emp and k[1]==mkt}
        tabs.append((safe(mkt.upper(),used),market_tab(sub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt])))
    # title: trước đây chỉ file GRAND được đổi tên → 7 file này kẹt tên 'THÁNG 7' suốt tháng 8.
    write_file(key,tabs,title=f"TỔNG ADS THÁNG {_T.month}"); n+=1; print(f"[{n}] TỔNG {emp}: {len(tabs)} tab"); time.sleep(1.0)
# File TAIWAN riêng mỗi marketer (Đài MIỄN rule test → camp 'test' vẫn tính thật).
# ID ở taiwan_files.json (user tạo sheet + share SA rồi thêm ID; thiếu → bỏ qua, không crash).
TWFILES_PATH='/Users/syanh/talpha_reports/taiwan_files.json'
try: TWFILES=json.load(open(TWFILES_PATH))
except Exception: TWFILES={}
for emp in TONG_MAP:
    key=TWFILES.get(emp)
    if not key: continue
    sub={k:v for k,v in cell.items() if k[0]==emp and k[1]=="Taiwan"}
    prods=sorted({k[2] for k in sub}, key=lambda p:-sum(sub[x]["spend"] for x in sub if x[2]==p))
    used=set(); tabs=[("Tổng",market_tab(sub,RATE["Taiwan"],LOCALCUR["Taiwan"],MONEY_DIV["Taiwan"]))]; used.add("tổng")
    for prod in prods:
        psub={k:v for k,v in sub.items() if k[2]==prod}; tabs.append((safe(prod,used),market_tab(psub,RATE["Taiwan"],LOCALCUR["Taiwan"],MONEY_DIV["Taiwan"])))
    write_file(key,tabs); n+=1; print(f"[{n}] TAIWAN {emp}: {len(tabs)} tab — https://docs.google.com/spreadsheets/d/{key}")
# 1 file TỔNG THÁNG — gộp tất cả marketer: tab "Tổng" (all mkt) + 1 tab mỗi marketer
if GRAND_KEY and not GRAND_KEY.endswith("placeholder"):
    used=set(); tabs=[("Tổng",grand_tab())]; used.add("tổng")
    # Tab theo ROSTER trong talpha_rules.json (không phải TONG_MAP) — người mới vào team
    # là có tab ngay, không cần chờ tạo file Sheet riêng cho họ.
    # 01/09: người ĐÃ NGHỈ vẫn nằm trong roster (để đơn rơi rớt của họ không biến mất
    # vào "(không gán)") nhưng KHÔNG nên chiếm một tab trống trong báo cáo tháng sau.
    # Quy tắc: hiện tab nếu đang là thành viên chạy số (có bộ file riêng trong TONG_MAP)
    # HOẶC tháng này còn phát sinh số. Người nghỉ mà hết đơn thì tab tự biến mất.
    for emp in DISPLAY:
        # Người đã nghỉ (unassign_marketers): KHÔNG tab — số của họ nằm ở "(không gán)".
        # Chặn tường minh ở đây để dù có ai thêm lại vào TONG_MAP cũng không mọc tab rỗng.
        if emp in UNASSIGN: continue
        if emp not in TONG_MAP and not any(k[0] == emp for k in cell): continue
        tabs.append((safe(emp,used),combined_tab(emp)))
    # Người NGOÀI TEAM: KHÔNG có tab trong báo cáo của team (CEO chốt 10/08).
    # Số của họ vẫn bị loại khỏi tab Tổng nhờ EXT_PREFIX ở grand_tab() — chỉ là
    # không hiển thị nữa. Cần soi thì xem khối "NGOÀI TEAM" trên dashboard.
    # Đơn không gán được cho ai (không tag + ad không thuộc team) — hiện riêng, không giấu
    if any(k[0]==UNASSIGNED for k in cell): tabs.append((safe(UNASSIGNED,used),combined_tab(UNASSIGNED)))
    write_file(GRAND_KEY,tabs,title=f"TỔNG TEAM THÁNG {_T.month}"); n+=1; print(f"[{n}] GRAND TỔNG THÁNG: {len(tabs)} tab")
# ── FILE TEST mỗi marketer (chung mọi thị trường, tab theo sản phẩm) ──
# ID file lưu ở test_files.json (tạo lần đầu qua service account, share anyone-link editor).
TESTMAP_PATH='/Users/syanh/talpha_reports/test_files.json'
try: TESTMAP=json.load(open(TESTMAP_PATH))
except Exception: TESTMAP={}
for emp in TONG_MAP:
    sub={k:v for k,v in cell_test.items() if k[0]==emp}
    if not sub: continue
    key=TESTMAP.get(emp)
    if not key:
        # SA KHÔNG tự tạo được file (Google chặn quota) — user phải tạo + share rồi thêm ID
        # vào test_files.json. Thiếu file thì bỏ qua marketer này, KHÔNG làm chết cả chain.
        print(f"[SKIP] TEST {emp}: chưa có file trong {TESTMAP_PATH} — tạo sheet, share SA, thêm ID.")
        continue
    prods=sorted({k[2] for k in sub}, key=lambda p:-sum(sub[x]["spend"] for x in sub if x[2]==p))
    used=set(); tabs=[("Tổng",test_tab(emp))]; used.add("tổng")
    for prod in prods: tabs.append((safe(prod,used),test_tab(emp,prod)))
    write_file(key,tabs,month_suffix=True); n+=1
    print(f"[{n}] TEST {emp}: {len(tabs)} tab — https://docs.google.com/spreadsheets/d/{key}")
print("ALL DONE", n)
if DROPPED:
    _ts=sum(DROPPED.values())
    print(f"CANH BAO: {len(DROPPED)} campaign KHONG VAO BAO CAO — {_ts:,.0f} d bi roi (ten camp sai format/typo thi truong)")
    for _c,_s in sorted(DROPPED.items(), key=lambda x:-x[1])[:10]:
        print(f"    {_s:>12,.0f} d | {_c[:90]}")
