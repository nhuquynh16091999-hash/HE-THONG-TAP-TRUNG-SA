"""
Deploy STRAMARK views from sql/stramark/*.sql
Usage: python sql/deploy_stramark.py [--dry-run] [--force]
"""
import os, sys, glob, argparse
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = 'bigquery_key.json'
sys.stdout.reconfigure(encoding='utf-8')

def main():
    parser = argparse.ArgumentParser(description='Deploy STRAMARK SQL views')
    parser.add_argument('--dry-run', action='store_true', help='Show SQL without executing')
    parser.add_argument('--force', action='store_true', help='Skip pre-flight checks')
    args = parser.parse_args()

    from google.cloud import bigquery
    P = 'levelup-465304'
    DS = 'STRAMARK_Dataset'
    c = bigquery.Client(project=P)

    SQL_DIR = os.path.join(os.path.dirname(__file__), 'stramark')
    sql_files = sorted(glob.glob(os.path.join(SQL_DIR, '*.sql')))

    if not sql_files:
        print('❌ No SQL files found in sql/stramark/')
        return

    print('='*70)
    print(' 🚀 STRAMARK SQL Deploy')
    print(f' Source: {SQL_DIR}')
    print(f' Files:  {len(sql_files)}')
    print(f' Mode:   {"DRY RUN" if args.dry_run else "LIVE DEPLOY"}')
    print('='*70)

    # ── PRE-FLIGHT CHECKS ──
    if not args.force:
        print('\n📋 PRE-FLIGHT CHECKS')
        issues = []

        # Check sale_order
        for r in c.query(f"SELECT COUNT(*) n FROM `{P}.{DS}.sale_order`").result():
            s = '✅' if r.n > 0 else '❌'
            print(f'  {s} sale_order: {r.n} rows')
            if r.n == 0: issues.append('sale_order empty')

        # Check fb_ads freshness
        try:
            for r in c.query(f"SELECT COUNT(*) n, MAX(date) mx FROM `{P}.{DS}.fb_ads_data`").result():
                stale = r.mx is not None
                s = '✅' if r.n > 50 else '⚠️'
                print(f'  {s} fb_ads_data: {r.n} rows (latest: {r.mx})')
                if r.n < 50: issues.append(f'fb_ads only {r.n} rows')
        except:
            print(f'  ❌ fb_ads_data: not found')
            issues.append('fb_ads_data missing')

        # Check dims
        for dim in ['dim_status_mapping', 'dim_marketer_mapping', 'dim_market_mapping']:
            try:
                for r in c.query(f"SELECT COUNT(*) n FROM `{P}.{DS}.{dim}`").result():
                    s = '✅' if r.n > 0 else '❌'
                    print(f'  {s} {dim}: {r.n} rows')
                    if r.n == 0: issues.append(f'{dim} empty')
            except:
                print(f'  ❌ {dim}: NOT FOUND')
                issues.append(f'{dim} missing')

        if issues:
            print(f'\n  ⚠️ {len(issues)} issue(s) found:')
            for i in issues:
                print(f'    • {i}')
            if not args.force:
                print('  Use --force to deploy anyway')
        else:
            print('  ✅ All pre-flight checks passed')

    # ── DEPLOY ──
    print(f'\n{"="*70}')
    print(' DEPLOYING VIEWS')
    print(f'{"="*70}')

    success, failed = 0, 0
    for sf in sql_files:
        fname = os.path.basename(sf)
        if fname.startswith('00_'):
            print(f'\n  ⏭️ {fname} (reference only, skip)')
            continue

        with open(sf, 'r', encoding='utf-8') as f:
            sql = f.read()

        # Strip comment lines at top
        lines = sql.strip().split('\n')
        sql_clean = '\n'.join(l for l in lines if not l.strip().startswith('--'))

        if args.dry_run:
            print(f'\n  📋 {fname} (DRY RUN)')
            print(f'     {sql_clean[:100]}...')
            success += 1
        else:
            try:
                c.query(sql_clean).result()
                print(f'\n  ✅ {fname}')
                success += 1
            except Exception as e:
                print(f'\n  ❌ {fname}: {str(e)[:200]}')
                failed += 1

    # ── POST-DEPLOY VALIDATION ──
    if not args.dry_run:
        print(f'\n{"="*70}')
        print(' POST-DEPLOY VALIDATION')
        print(f'{"="*70}')

        checks = [
            ('fact_orders = sale_order',
             f"SELECT ABS((SELECT COUNT(*) FROM `{P}.{DS}.vw_fact_orders`) - (SELECT COUNT(*) FROM `{P}.{DS}.sale_order`)) diff",
             lambda r: r.diff < 300, 'row count diff < 300'),
            ('Avg price < 500 RON',
             f"SELECT ROUND(AVG(total_price),0) avg FROM `{P}.{DS}.vw_fact_orders` WHERE total_price > 0",
             lambda r: r.avg < 500, f'avg = {{r.avg}}'),
            ('No mart fan-out',
             f"SELECT COUNT(*) n FROM (SELECT report_date, marketer_id, COUNT(*) c FROM `{P}.{DS}.mart_performance_master` GROUP BY 1,2 HAVING c > 1)",
             lambda r: r.n == 0, 'duplicate rows'),
            ('Items dedup working',
             f"SELECT (SELECT COUNT(*) FROM `{P}.{DS}.fact_order_items_dedup`) < (SELECT COUNT(*) FROM `{P}.{DS}.order_items`) AS ok",
             lambda r: r.ok, 'dedup < raw'),
        ]

        passed, warnings = 0, 0
        for name, sql, check_fn, detail in checks:
            try:
                for r in c.query(sql).result():
                    ok = check_fn(r)
                    s = '✅' if ok else '⚠️'
                    print(f'  {s} {name}')
                    if ok: passed += 1
                    else: warnings += 1
            except Exception as e:
                print(f'  ❌ {name}: {str(e)[:100]}')
                warnings += 1

        print(f'\n  Results: {passed} passed, {warnings} warnings')

    # ── SUMMARY ──
    print(f'\n{"="*70}')
    print(f' {"DRY RUN" if args.dry_run else "DEPLOY"} COMPLETE: {success} success, {failed} failed')
    print(f'{"="*70}')


if __name__ == '__main__':
    main()
