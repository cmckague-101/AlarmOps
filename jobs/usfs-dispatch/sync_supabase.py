#!/usr/bin/env python3
"""Incrementally import USDA dispatch priority lists and VIN-matched award rates."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from scraper import (  # noqa: E402
    ForestServiceClient,
    UpstreamNotFoundError,
    enrich_rows,
    normalize_vin,
    parse_agreement_rates,
    parse_dpl,
)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Fetch and parse without writing Supabase")
    parser.add_argument("--force", action="store_true", help="Reprocess all selected lists")
    parser.add_argument("--area-id", type=int, help="Limit sync to one geographic area")
    parser.add_argument("--center-id", type=int, help="Limit sync to one dispatch center")
    parser.add_argument("--file-id", type=int, help="Limit sync to one DPL file ID")
    parser.add_argument("--limit", type=int, help="Maximum number of lists to process")
    parser.add_argument("--metadata-only", action="store_true", help="Update catalog without downloading PDFs")
    parser.add_argument(
        "--incremental-only",
        action="store_true",
        help="Process new, metadata-changed, pending, partial, or failed lists; skip complete-list reconciliation",
    )
    parser.add_argument(
        "--recheck-days",
        type=int,
        default=7,
        help="Reprocess complete lists after this many days to detect replaced PDFs and award changes",
    )
    parser.add_argument("--weekly", action="store_true", help="Spread fresh full-catalog checks across seven daily runs")
    parser.add_argument("--fresh-pdfs", action="store_true", help="Bypass disk cache once per PDF per run")
    parser.add_argument("--cleanup", action="store_true", help="After a successful full catalog discovery and selected sync, prune obsolete data and old cached PDFs")
    parser.add_argument("--retention-days", type=int, default=30, help="Cleanup grace period (default: 30 days)")
    return parser.parse_args()


def connect_database():
    database_url = os.getenv("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required unless --dry-run is used")
    try:
        import psycopg
    except ImportError as exc:
        raise SystemExit("Install database dependency: pip install 'psycopg[binary]'") from exc
    return psycopg.connect(database_url)


def discover(client: ForestServiceClient, args: argparse.Namespace):
    areas = client.geographic_areas()
    if args.area_id is not None:
        areas = [area for area in areas if int(area["id"]) == args.area_id]
    if not areas:
        raise RuntimeError("No matching geographic area")

    centers: list[dict[str, Any]] = []
    lists: list[dict[str, Any]] = []
    for area in areas:
        area_centers = client.dispatch_centers(int(area["id"]))
        for center in area_centers:
            center["geographic_area_id"] = int(area["id"])
        if args.center_id is not None:
            area_centers = [center for center in area_centers if int(center["centerid"]) == args.center_id]
        centers.extend(area_centers)
    if args.center_id is not None and not centers:
        raise RuntimeError("Dispatch center not found inside selected geographic area")

    for center in centers:
        center_lists = client.priority_lists(int(center["centerid"]))
        for item in center_lists:
            item["dispatch_center_id"] = int(center["centerid"])
        if args.file_id is not None:
            center_lists = [item for item in center_lists if int(item["id"]) == args.file_id]
        lists.extend(center_lists)
    if args.file_id is not None and not lists:
        raise RuntimeError("DPL file ID not found inside selected dispatch center/area")
    return areas, centers, lists


def acquire_sync_lock(connection) -> None:
    """Prevent local, manual, and scheduled importers from writing concurrently."""
    with connection.cursor() as cursor:
        cursor.execute("select pg_try_advisory_lock(%s)", (73_185_422_390_455_611,))
        acquired = bool(cursor.fetchone()[0])
    if not acquired:
        connection.close()
        raise SystemExit("Another USFS dispatch sync is already running")


def existing_lists(connection) -> dict[int, dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(
            "select file_id, name, sync_status, last_checked_at, pdf_sha256, synced_at, last_error "
            "from public.usfs_priority_lists"
        )
        return {
            int(row[0]): {
                "name": row[1],
                "sync_status": row[2],
                "last_checked_at": row[3],
                "pdf_sha256": row[4],
                "synced_at": row[5],
                "last_error": row[6],
            }
            for row in cursor.fetchall()
        }


def existing_agreements(connection) -> dict[str, str]:
    with connection.cursor() as cursor:
        cursor.execute("select piid, pdf_sha256 from public.usfs_agreements")
        return dict(cursor.fetchall())


def pdf_change(old_sha: str | None, new_sha: str) -> str:
    return "new" if old_sha is None else "unchanged" if old_sha == new_sha else "changed"


def cleanup_obsolete(connection, cache_dir: Path, retention_days: int) -> dict[str, int]:
    """Only called after full catalog discovery and error/warning-free selected work.

    PDF coverage is independent: inactive lists and unreferenced agreements only
    are retired; references from unprocessed lists remain protected.
    """
    counts: dict[str, int] = {}
    with connection.cursor() as cursor:
        # Keep recently missing lists for recovery if USDA temporarily omits them.
        cursor.execute(
            "delete from public.usfs_priority_lists where not is_active "
            "and last_seen_at < now() - make_interval(days => %s)", (retention_days,),
        )
        counts["retired_lists"] = cursor.rowcount
        # Cascades remove rates; references from retained inactive lists also protect agreements.
        cursor.execute(
            "delete from public.usfs_agreements a where "
            "a.last_checked_at < now() - make_interval(days => %s) and not exists "
            "(select 1 from public.usfs_dpl_entries e where e.agreement_piid = a.piid)",
            (retention_days,),
        )
        counts["orphan_agreements"] = cursor.rowcount
    connection.commit()
    counts["cached_files"] = prune_cache(cache_dir, retention_days)
    return counts


def prune_cache(cache_dir: Path, retention_days: int) -> int:
    """Only managed PDFs/hash sidecars are disposable; never touch other local files."""
    cutoff = time.time() - retention_days * 86400
    removed = 0
    for path in cache_dir.iterdir():
        if (path.name.startswith(("dpl-", "agreement-"))
                and path.suffix in (".pdf", ".sha256")
                and not path.is_symlink() and path.is_file() and path.stat().st_mtime < cutoff):
            path.unlink()
            removed += 1
    return removed


def upsert_catalog(connection, areas, centers, lists, deactivate_missing: bool = False) -> None:
    with connection.cursor() as cursor:
        if deactivate_missing:
            cursor.execute("update public.usfs_priority_lists set is_active = false")
            cursor.execute("update public.usfs_dispatch_centers set is_active = false")
            cursor.execute("update public.usfs_geographic_areas set is_active = false")
        cursor.executemany(
            """
            insert into public.usfs_geographic_areas (id, name, is_active, source_updated_at)
            values (%s, %s, true, now())
            on conflict (id) do update set
              name = excluded.name, is_active = true, source_updated_at = now()
            """,
            [(int(item["id"]), item["Areaname"]) for item in areas],
        )
        cursor.executemany(
            """
            insert into public.usfs_dispatch_centers
              (id, geographic_area_id, name, is_active, source_updated_at)
            values (%s, %s, %s, true, now())
            on conflict (id) do update set
              geographic_area_id = excluded.geographic_area_id,
              name = excluded.name,
              is_active = true,
              source_updated_at = now()
            """,
            [
                (int(item["centerid"]), int(item["geographic_area_id"]), item["centername"])
                for item in centers
            ],
        )
        cursor.executemany(
            """
            insert into public.usfs_priority_lists
              (file_id, dispatch_center_id, name, is_active, last_seen_at)
            values (%s, %s, %s, true, now())
            on conflict (file_id) do update set
              dispatch_center_id = excluded.dispatch_center_id,
              name = excluded.name,
              is_active = true,
              last_seen_at = now()
            """,
            [(int(item["id"]), int(item["dispatch_center_id"]), item["name"]) for item in lists],
        )
    connection.commit()


def create_run(connection, discovered: int) -> int:
    with connection.cursor() as cursor:
        cursor.execute(
            "insert into public.usfs_sync_runs (lists_discovered, parser_version) values (%s, %s) returning id",
            (discovered, "1"),
        )
        run_id = int(cursor.fetchone()[0])
    connection.commit()
    return run_id


def finish_run(connection, run_id: int, status: str, lists_synced: int, entries: int, errors: list[str]) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            update public.usfs_sync_runs
            set finished_at = now(), status = %s, lists_synced = %s,
                entries_synced = %s, error_message = %s
            where id = %s
            """,
            (status, lists_synced, entries, "\n".join(errors) or None, run_id),
        )
    connection.commit()


def parse_published_at(value: str | None) -> datetime | None:
    if not value:
        return None
    for pattern in ("%m/%d/%Y %I:%M %p GMT", "%m/%d/%Y %I:%M %p"):
        try:
            return datetime.strptime(value, pattern).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def write_list(
    connection,
    item,
    parsed,
    dpl_sha: str,
    agreement_data,
    errors: list[str],
    warnings: list[str],
) -> None:
    file_id = int(item["id"])
    status = "partial" if errors or warnings else "complete"
    messages = errors + warnings
    with connection.cursor() as cursor:
        for piid, agreement in agreement_data.items():
            cursor.execute(
                """
                insert into public.usfs_agreements
                  (piid, pdf_sha256, sync_status, last_checked_at, synced_at, last_error)
                values (%s, %s, 'complete', now(), now(), null)
                on conflict (piid) do update set
                  pdf_sha256 = excluded.pdf_sha256,
                  sync_status = 'complete', last_checked_at = now(), synced_at = now(), last_error = null
                """,
                (piid, agreement["sha256"]),
            )
            cursor.execute("delete from public.usfs_agreement_rates where agreement_piid = %s", (piid,))
            for rate in agreement["rates"]:
                cursor.execute(
                    """
                    insert into public.usfs_agreement_rates
                      (agreement_piid, clin, vin, normalized_vin, daily_rate,
                       resource_type, dispatch_center, source_data, synced_at)
                    values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, now())
                    """,
                    (
                        piid,
                        str(rate["clin"]),
                        str(rate["vin"]),
                        rate["normalized_vin"],
                        rate["daily_rate"],
                        rate.get("resource_type"),
                        rate.get("dispatch_center"),
                        json.dumps(rate, default=str),
                    ),
                )

        cursor.execute("delete from public.usfs_dpl_entries where priority_list_file_id = %s", (file_id,))
        for row in parsed["rows"]:
            cursor.execute(
                """
                insert into public.usfs_dpl_entries
                  (priority_list_file_id, rank, agreement_piid, company_name,
                   equipment_location, vin, normalized_vin, cafs, synced_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s, now())
                """,
                (
                    file_id,
                    int(row["rank"]),
                    row["agreement_piid"],
                    row.get("company_name"),
                    row.get("equipment_location"),
                    row.get("vin"),
                    row.get("normalized_vin", ""),
                    row.get("cafs"),
                ),
            )

        cursor.execute(
            """
            update public.usfs_priority_lists set
              dispatch_center_name = %s, resource_type = %s, published_at = %s,
              pdf_sha256 = %s, sync_status = %s, last_error = %s,
              row_count = %s, last_checked_at = now(),
              synced_at = case when %s = 'complete' then now() else synced_at end
            where file_id = %s
            """,
            (
                parsed.get("dispatch_center"),
                parsed.get("resource_type"),
                parse_published_at(parsed.get("published_on")),
                dpl_sha,
                status,
                "\n".join(messages) or None,
                len(parsed["rows"]),
                status,
                file_id,
            ),
        )
    connection.commit()


def mark_list_failed(connection, file_id: int, error: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            update public.usfs_priority_lists
            set sync_status = 'failed', last_error = %s, last_checked_at = now()
            where file_id = %s
            """,
            (error, file_id),
        )
    connection.commit()


def process_list(client: ForestServiceClient, item: dict[str, Any]):
    dpl = client.dpl_pdf(int(item["id"]))
    parsed = parse_dpl(dpl.content)
    rates_by_piid: dict[str, list[dict[str, Any]]] = {}
    agreements: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    warnings: list[str] = []

    for row in parsed["rows"]:
        row["normalized_vin"] = normalize_vin(row.get("vin"))
    for piid in dict.fromkeys(row["agreement_piid"] for row in parsed["rows"]):
        try:
            agreement = client.agreement_pdf(piid)
            rates = parse_agreement_rates(agreement.content)
            rates_by_piid[piid] = rates
            agreements[piid] = {
                "rates": rates,
                "sha256": hashlib.sha256(agreement.content).hexdigest(),
            }
        except UpstreamNotFoundError:
            rates_by_piid[piid] = []
            warnings.append(f"{piid}: agreement PDF unavailable from USDA (404)")
        except Exception as exc:
            rates_by_piid[piid] = []
            errors.append(f"{piid}: {exc}")

    parsed["rows"] = enrich_rows(parsed["rows"], rates_by_piid)
    return parsed, hashlib.sha256(dpl.content).hexdigest(), agreements, errors, warnings


def selection_priority(
    item: dict[str, Any], previous: dict[str, Any] | None, args: argparse.Namespace
) -> int | None:
    """Return processing priority; lower values run first and None means skip."""
    if args.force or args.file_id is not None:
        return 0
    if previous is None or previous["name"] != item["name"]:
        return 0
    if previous["sync_status"] in ("partial", "failed"):
        return 1
    if previous["sync_status"] == "pending":
        return 2
    if args.incremental_only:
        return None
    checked = previous["last_checked_at"]
    if checked is None or checked <= datetime.now(timezone.utc) - timedelta(days=args.recheck_days):
        return 3
    return None


def weekly_plan(lists, previous, now: datetime):
    """Reserve rotation capacity independently of retries; catch deadlines a day early."""
    minimum = datetime.min.replace(tzinfo=timezone.utc)
    baseline = max(1, math.ceil(len(lists) / 7))
    immediate, rotation, retries = [], [], []
    for item in lists:
        old = previous.get(int(item["id"]))
        if old is None or old["name"] != item["name"]:
            immediate.append(item)
        elif old["sync_status"] in ("partial", "failed") or old.get("last_error"):
            retries.append(item)
        else:
            rotation.append(item)

    rotation.sort(key=lambda item: (
        previous[int(item["id"])].get("synced_at") or minimum, int(item["id"]),
    ))
    retries.sort(key=lambda item: (
        previous[int(item["id"])].get("last_checked_at") or minimum, int(item["id"]),
    ))
    # Complete every healthy list whose last success expires before tomorrow.
    # Never-synced pending backfill is spread over the baseline rather than all at once.
    deadline = now - timedelta(days=6)
    at_risk = sum(
        1 for item in rotation
        if (synced := previous[int(item["id"])].get("synced_at")) is not None
        and synced <= deadline
    )
    # Reserve backfill capacity too, so early deadline refreshes cannot starve
    # lists that have never succeeded during the initial seven-day rollout.
    pending_count = sum(previous[int(item["id"])].get("synced_at") is None for item in rotation)
    quota = max(baseline, at_risk + min(baseline, pending_count))
    # Pending lists must not push imminent deadlines out of the catch-up quota.
    urgent = [item for item in rotation
              if (synced := previous[int(item["id"])].get("synced_at")) is not None
              and synced <= deadline]
    urgent_ids = {int(item["id"]) for item in urgent}
    remaining = [item for item in rotation if int(item["id"]) not in urgent_ids]
    selected_rotation = urgent + remaining[:max(0, quota - len(urgent))]
    retry_budget = max(1, math.ceil(baseline / 4))
    targets = immediate + selected_rotation + retries[:retry_budget]
    return targets, {
        "baseline": baseline, "rotation": len(selected_rotation),
        "deadline_catchup": at_risk, "new_or_renamed": len(immediate),
        "retries": min(len(retries), retry_budget), "retry_budget": retry_budget,
        "retries_deferred": max(0, len(retries) - retry_budget),
        "rotation_deferred": len(rotation) - len(selected_rotation),
    }


def weekly_coverage(lists, previous, now: datetime) -> dict[str, int]:
    counts = {"total": len(lists), "current_7_days": 0, "overdue": 0,
              "never_successful": 0, "never_checked": 0, "failed_or_partial": 0}
    for item in lists:
        old = previous.get(int(item["id"]), {})
        synced = old.get("synced_at")
        if old.get("last_checked_at") is None:
            counts["never_checked"] += 1
        if old.get("sync_status") in ("failed", "partial") or old.get("last_error"):
            counts["failed_or_partial"] += 1
        if synced is None:
            counts["never_successful"] += 1
        elif (synced > now - timedelta(days=7) and old.get("sync_status") == "complete"
              and not old.get("last_error") and old.get("name") == item["name"]):
            counts["current_7_days"] += 1
        else:
            counts["overdue"] += 1
    return counts


def main() -> int:
    args = arguments()
    if args.recheck_days < 1 or args.retention_days < 1:
        raise SystemExit("--recheck-days and --retention-days must be at least 1")
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit must be at least 1")
    full_catalog = args.area_id is None and args.center_id is None and args.file_id is None
    if args.weekly and (not full_catalog or args.force or args.limit is not None
                        or args.incremental_only or args.metadata_only or args.dry_run):
        raise SystemExit("--weekly requires a full database catalog (no force, limit, filters, dry-run or incremental-only)")
    if args.cleanup and (not full_catalog or args.metadata_only or args.incremental_only or args.dry_run):
        raise SystemExit("--cleanup requires a full database catalog (no filters, dry-run or incremental-only)")
    if not args.dry_run and not os.getenv("FS_USER_AGENT"):
        raise SystemExit("FS_USER_AGENT is required; include FireOps and a monitored contact")

    client = ForestServiceClient(ROOT / "data" / "cache", fresh_pdfs=args.fresh_pdfs or args.weekly)
    print("Discovering USDA catalog…", flush=True)
    areas, centers, lists = discover(client, args)
    print(f"Found {len(areas)} areas, {len(centers)} centers, {len(lists)} lists", flush=True)

    if not lists:
        raise SystemExit("Empty USDA catalog; refusing reconciliation or cleanup")

    connection = None if args.dry_run else connect_database()
    previous: dict[int, dict[str, Any]] = {}
    agreement_hashes: dict[str, str] = {}
    run_id = None
    if connection:
        acquire_sync_lock(connection)
        previous = existing_lists(connection)
        agreement_hashes = existing_agreements(connection)
        upsert_catalog(connection, areas, centers, lists, deactivate_missing=full_catalog)
        run_id = create_run(connection, len(lists))

    prioritized_targets = [
        (priority, position, item)
        for position, item in enumerate(lists)
        if (priority := selection_priority(item, previous.get(int(item["id"])), args)) is not None
    ]
    # Oldest checks first within a priority to prevent starvation when a cap is used.
    prioritized_targets.sort(key=lambda target: (
        target[0],
        (previous.get(int(target[2]["id"]), {}).get("last_checked_at")
         or datetime.min.replace(tzinfo=timezone.utc)),
        target[1],
    ))
    reasons = Counter(priority for priority, _, _ in prioritized_targets)
    if not args.weekly:
        print(
            f"Eligible: {len(prioritized_targets)} lists "
            f"(new/renamed/forced: {reasons[0]}, partial/failed: {reasons[1]}, "
            f"pending: {reasons[2]}, due: {reasons[3]})", flush=True,
        )
    targets = [item for _, _, item in prioritized_targets]
    if args.weekly:
        print(f"Weekly coverage before: {json.dumps(weekly_coverage(lists, previous, datetime.now(timezone.utc)))}", flush=True)
        targets, plan = weekly_plan(lists, previous, datetime.now(timezone.utc))
        print(f"Weekly plan: {json.dumps(plan)}", flush=True)
    if args.limit is not None:
        targets = targets[: args.limit]
    if args.metadata_only:
        targets = []
    if args.weekly:
        print(f"Selected: {len(targets)}; deferred by weekly rotation: {len(lists) - len(targets)}", flush=True)
    else:
        print(f"Selected: {len(targets)}; deferred: {len(prioritized_targets) - len(targets)}; "
              f"not due: {len(lists) - len(prioritized_targets)}", flush=True)

    total_entries = 0
    completed = 0
    all_errors: list[str] = []
    all_warnings: list[str] = []
    dpl_changes: Counter = Counter()
    agreement_changes: Counter = Counter()
    seen_agreements: set[str] = set()
    for number, item in enumerate(targets, 1):
        file_id = int(item["id"])
        print(f"[{number}/{len(targets)}] DPL {file_id}: {item['name']}", flush=True)
        try:
            parsed, dpl_sha, agreements, errors, warnings = process_list(client, item)
            dpl_changes[pdf_change(previous.get(file_id, {}).get("pdf_sha256"), dpl_sha)] += 1
            for piid, agreement in agreements.items():
                if piid not in seen_agreements:
                    agreement_changes[pdf_change(agreement_hashes.get(piid), agreement["sha256"])] += 1
                    seen_agreements.add(piid)
            all_warnings.extend(f"DPL {file_id} {warning}" for warning in warnings)
            all_errors.extend(f"DPL {file_id} {error}" for error in errors)
            for warning in warnings:
                print(f"  WARNING: {warning}", flush=True)
            if connection:
                write_list(connection, item, parsed, dpl_sha, agreements, errors, warnings)
            else:
                matched = sum(row["rate_status"] == "matched" for row in parsed["rows"])
                print(f"  dry-run: {len(parsed['rows'])} rows, {matched} VIN rates matched")
                for row in parsed["rows"][:3]:
                    print(
                        " ",
                        json.dumps(
                            {
                                "rank": row["rank"],
                                "company_name": row.get("company_name"),
                                "equipment_location": row.get("equipment_location"),
                                "vin": row.get("vin"),
                                "cafs": row.get("cafs"),
                                "daily_rate": str((row.get("rate") or {}).get("daily_rate") or ""),
                            }
                        ),
                    )
            total_entries += len(parsed["rows"])
            completed += 1
        except Exception as exc:
            if connection:
                connection.rollback()
                mark_list_failed(connection, file_id, str(exc))
            message = f"DPL {file_id}: {exc}"
            all_errors.append(message)
            print(f"  ERROR: {message}", file=sys.stderr, flush=True)

    if args.weekly and connection:
        coverage = weekly_coverage(lists, existing_lists(connection), datetime.now(timezone.utc))
        print(f"Weekly coverage after: {json.dumps(coverage)}", flush=True)
        if coverage["overdue"] or coverage["never_successful"]:
            print("Weekly coverage incomplete: overdue/never-successful lists remain; inspect failures and the next plan.", flush=True)

    if args.cleanup and connection:
        if all_errors or all_warnings:
            print("Cleanup skipped: errors or unavailable agreement PDFs; retained existing data/files.", flush=True)
        else:
            try:
                counts = cleanup_obsolete(connection, client.cache_dir, args.retention_days)
                print(f"Cleanup (grace {args.retention_days} days): {json.dumps(counts)}", flush=True)
            except Exception as exc:
                connection.rollback()
                all_errors.append(f"Cleanup: {exc}")
                print(f"  ERROR: cleanup: {exc}", file=sys.stderr, flush=True)

    if connection and run_id is not None:
        status = "completed" if not all_errors else "completed_with_errors"
        finish_run(connection, run_id, status, completed, total_entries, all_errors)
        connection.close()
    if args.dry_run:
        print("Dry-run: no database baseline loaded; 'new' means no comparison hash available.")
    for label, changes in (("DPL", dpl_changes), ("Agreement", agreement_changes)):
        print(f"{label} PDFs: {changes['new']} new, {changes['changed']} changed, "
              f"{changes['unchanged']} unchanged (compared with stored hashes)")
    print(f"PDF reads: {client.pdf_downloads} downloads, {client.pdf_cache_hits} cache reuses")
    for label, messages in (("Error", all_errors), ("Warning", all_warnings)):
        if messages:
            print(f"{label} summary ({len(messages)}):", flush=True)
            for message in messages:
                print(f"  {label.upper()}: {message}", flush=True)
    row_action = "parsed" if args.dry_run else "written"
    print(f"Done: {completed} lists, {total_entries} equipment rows {row_action}, "
          f"{len(all_errors)} errors, {len(all_warnings)} warnings")
    return 0 if not all_errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
