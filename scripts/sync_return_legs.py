"""Sync return-to-client AWBs from euShipments into BigQuery.

These are new AWBs created by the courier when re-delivering returned items.
They are discovered from existing ffm_shipments records where REFERENCENUMBER
contains "The New is: {AWB}".
"""
import sys, os, io, json, re, time, requests, logging
from datetime import datetime, timezone
from pathlib import Path

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from google.cloud import bigquery

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BQ_KEY = PROJECT_ROOT / "bigquery_key.json"
ENV_FFM = PROJECT_ROOT / ".env.ffm"
PROJECT = "levelup-465304"
DS = f"{PROJECT}.STRAMARK_Dataset"
TABLE = f"{DS}.ffm_shipments"
BGN_TO_EUR = 1.95583
VAT_RATE = 0.20

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


def load_tokens():
    config = {}
    with open(ENV_FFM, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, _, v = line.partition("=")
                config[k.strip()] = v.strip()
    return {
        "old": (config["EU_SHIPMENT_CLIENT_ID_OLD"], config["EU_SHIPMENT_TOKEN_OLD"]),
        "new": (config["EU_SHIPMENT_CLIENT_ID_NEW"], config["EU_SHIPMENT_TOKEN_NEW"]),
    }, config["EU_SHIPMENT_BASE_URL"]


def normalize_status(status_history):
    if not status_history:
        return "Unknown"
    last = status_history[-1].get("STATUS", "")
    sl = last.lower()
    if "returned" in sl or "back" in sl:
        return "Returned"
    if "delivered" in sl:
        return "Delivered"
    if "warehouse" in sl:
        return "Warehouse"
    if "shipped" in sl or "transit" in sl or "delivery" in sl:
        return "Shipped"
    return last or "Unknown"


def main():
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(BQ_KEY)
    bq = bigquery.Client(project=PROJECT)
    tokens, base_url = load_tokens()

    # Step 1: Find return-to-client AWBs
    log.info("Finding return-to-client AWBs from existing ffm_shipments...")
    q = f"""SELECT awb, pos_order_id, client_id,
        JSON_VALUE(raw_response, '$.REFERENCENUMBER') as api_ref
    FROM `{TABLE}`
    WHERE JSON_VALUE(raw_response, '$.REFERENCENUMBER') LIKE '%The New is:%'"""
    rows = list(bq.query(q).result())
    log.info(f"Found {len(rows)} returned orders with new AWBs")

    to_sync = []
    for r in rows:
        match = re.search(r"The New is:\s*(\S+)", r.api_ref or "")
        if match:
            to_sync.append({
                "new_awb": match.group(1),
                "pos_order_id": r.pos_order_id,
                "original_awb": r.awb,
                "client_id": r.client_id,
            })

    # Filter already synced
    if to_sync:
        awb_list = ",".join([f'"{s["new_awb"]}"' for s in to_sync])
        q2 = f"SELECT awb FROM `{TABLE}` WHERE awb IN ({awb_list})"
        existing = set(r.awb for r in bq.query(q2).result())
        to_sync = [s for s in to_sync if s["new_awb"] not in existing]

    log.info(f"Need to sync: {len(to_sync)} return-to-client AWBs")
    if not to_sync:
        log.info("Nothing to sync!")
        return

    # Step 2: Fetch each AWB via API
    records = []
    errors = 0
    for i, item in enumerate(to_sync):
        awb = item["new_awb"]
        cid = item["client_id"]

        # Select token by client_id
        if cid == tokens["old"][0]:
            token = tokens["old"][1]
        else:
            token = tokens["new"][1]

        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        try:
            r = requests.get(f"{base_url}/get-awb/{awb}?testMode=0", headers=headers, timeout=10)
            time.sleep(0.5)
            if r.status_code != 200:
                other = tokens["old"][1] if token == tokens["new"][1] else tokens["new"][1]
                headers2 = {"Authorization": f"Bearer {other}", "Content-Type": "application/json"}
                r = requests.get(f"{base_url}/get-awb/{awb}?testMode=0", headers=headers2, timeout=10)
                time.sleep(0.5)

            if r.status_code != 200:
                log.warning(f"  [{i+1}/{len(to_sync)}] AWB={awb} | HTTP {r.status_code} — skipped")
                errors += 1
                continue

            d = r.json()
            price_bgn = float(d.get("PRICE", 0) or 0)
            price_eur = round(price_bgn / BGN_TO_EUR, 4)
            cod = float(d.get("COD", 0) or 0)
            wad = d.get("WAYBILL_AVAILABLE_DATE")

            # Get status history
            r2 = requests.get(f"{base_url}/get-status/history/{awb}?testMode=0", headers=headers, timeout=10)
            time.sleep(0.3)
            last_status = "Unknown"
            created_date = None
            delivered_date = None
            returned_date = None

            if r2.status_code == 200:
                hist = r2.json().get("statusesHistory", [])
                last_status = normalize_status(hist)
                for ev in hist:
                    st = (ev.get("STATUS", "") or "").lower()
                    dt = ev.get("DATE")
                    if dt and ("information" in st or "created" in st or "registered" in st):
                        if not created_date:
                            created_date = dt
                    elif dt and "delivered" in st:
                        delivered_date = dt
                    elif dt and ("returned" in st or "back" in st):
                        returned_date = dt

            if not created_date and wad:
                created_date = wad

            ref = d.get("REFERENCENUMBER", "")
            pos_match = re.match(r"^(\d+)", ref)
            pos_id = pos_match.group(1) if pos_match else item["pos_order_id"]

            record = {
                "awb": str(awb),
                "ref_number": ref,
                "pos_order_id": pos_id,
                "ffm_partner": "euShipments",
                "client_id": cid,
                "status": last_status,
                "price_excl_vat": price_eur,
                "price_incl_vat": round(price_eur * (1 + VAT_RATE), 4),
                "vat_rate": VAT_RATE,
                "currency": "EUR",
                "is_return_shipment": True,
                "original_order_id": item["pos_order_id"],
                "cod_amount": cod,
                "created_date": created_date,
                "delivered_date": delivered_date,
                "returned_date": returned_date,
                "raw_response": json.dumps(d, default=str, ensure_ascii=False)[:5000],
                "synced_at": datetime.now(timezone.utc).isoformat(),
                "sync_source": "api_return_leg",
            }
            records.append(record)
            log.info(f"  [{i+1}/{len(to_sync)}] AWB={awb} | POS={pos_id} | Status={last_status} | COD={cod} | Cost={price_eur:.2f}")

        except Exception as e:
            log.error(f"  [{i+1}/{len(to_sync)}] AWB={awb} | ERROR: {e}")
            errors += 1

    log.info(f"\nTotal: {len(records)} fetched, {errors} errors")

    # Step 3: Merge into BQ
    if not records:
        log.info("No records to insert")
        return

    schema = [
        bigquery.SchemaField("awb", "STRING"),
        bigquery.SchemaField("ref_number", "STRING"),
        bigquery.SchemaField("pos_order_id", "STRING"),
        bigquery.SchemaField("ffm_partner", "STRING"),
        bigquery.SchemaField("client_id", "STRING"),
        bigquery.SchemaField("status", "STRING"),
        bigquery.SchemaField("price_excl_vat", "FLOAT64"),
        bigquery.SchemaField("price_incl_vat", "FLOAT64"),
        bigquery.SchemaField("vat_rate", "FLOAT64"),
        bigquery.SchemaField("currency", "STRING"),
        bigquery.SchemaField("is_return_shipment", "BOOLEAN"),
        bigquery.SchemaField("original_order_id", "STRING"),
        bigquery.SchemaField("cod_amount", "FLOAT64"),
        bigquery.SchemaField("created_date", "TIMESTAMP"),
        bigquery.SchemaField("delivered_date", "TIMESTAMP"),
        bigquery.SchemaField("returned_date", "TIMESTAMP"),
        bigquery.SchemaField("raw_response", "STRING"),
        bigquery.SchemaField("synced_at", "TIMESTAMP"),
        bigquery.SchemaField("sync_source", "STRING"),
    ]

    temp = f"{DS}._ffm_return_staging"
    job_config = bigquery.LoadJobConfig(schema=schema, write_disposition="WRITE_TRUNCATE")
    job = bq.load_table_from_json(records, temp, job_config=job_config)
    job.result()

    merge_sql = f"""
        MERGE `{TABLE}` AS t
        USING `{temp}` AS s ON t.awb = s.awb
        WHEN MATCHED THEN UPDATE SET
            status=s.status, price_excl_vat=s.price_excl_vat, price_incl_vat=s.price_incl_vat,
            cod_amount=s.cod_amount, is_return_shipment=s.is_return_shipment,
            created_date=s.created_date, delivered_date=s.delivered_date, returned_date=s.returned_date,
            raw_response=s.raw_response, synced_at=s.synced_at, sync_source=s.sync_source
        WHEN NOT MATCHED THEN INSERT (
            awb, ref_number, pos_order_id, ffm_partner, client_id,
            status, price_excl_vat, price_incl_vat, vat_rate, currency,
            is_return_shipment, original_order_id, cod_amount,
            created_date, delivered_date, returned_date,
            raw_response, synced_at, sync_source
        ) VALUES (
            s.awb, s.ref_number, s.pos_order_id, s.ffm_partner, s.client_id,
            s.status, s.price_excl_vat, s.price_incl_vat, s.vat_rate, s.currency,
            s.is_return_shipment, s.original_order_id, s.cod_amount,
            s.created_date, s.delivered_date, s.returned_date,
            s.raw_response, s.synced_at, s.sync_source
        )
    """
    bq.query(merge_sql).result()
    bq.delete_table(temp, not_found_ok=True)
    log.info(f"✓ Merged {len(records)} return-to-client records into ffm_shipments")


if __name__ == "__main__":
    main()
