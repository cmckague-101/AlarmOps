#!/usr/bin/env python3
"""Incrementally import USDA dispatch priority lists and VIN-matched award rates."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from scraper import (  # noqa: E402
    ForestServiceClient,
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


def existing_lists(connection) -> dict[int, dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(
            "select file_id, name, sync_status, last_checked_at, pdf_sha256 from public.usfs_priority_lists"
        )
        return {
            int(row[0]): {
                "name": row[1],
                "sync_status": row[2],
                "last_checked_at": row[3],
                "pdf_sha256": row[4],
            }
            for row in cursor.fetchall()
        }


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


def write_list(connection, item, parsed, dpl_sha: str, agreement_data, errors: list[str]) -> None:
    file_id = int(item["id"])
    status = "partial" if errors else "complete"
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
                "\n".join(errors) or None,
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
        except Exception as exc:
            rates_by_piid[piid] = []
            errors.append(f"{piid}: {exc}")

    parsed["rows"] = enrich_rows(parsed["rows"], rates_by_piid)
    return parsed, hashlib.sha256(dpl.content).hexdigest(), agreements, errors


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


def main() -> int:
    args = arguments()
    if args.recheck_days < 1:
        raise SystemExit("--recheck-days must be at least 1")
    if not args.dry_run and not os.getenv("FS_USER_AGENT"):
        raise SystemExit("FS_USER_AGENT is required; include FireOps and a monitored contact")

    client = ForestServiceClient(ROOT / "data" / "cache")
    print("Discovering USDA catalog…", flush=True)
    areas, centers, lists = discover(client, args)
    print(f"Found {len(areas)} areas, {len(centers)} centers, {len(lists)} lists", flush=True)

    connection = None if args.dry_run else connect_database()
    previous: dict[int, dict[str, Any]] = {}
    run_id = None
    if connection:
        previous = existing_lists(connection)
        full_catalog = args.area_id is None and args.center_id is None and args.file_id is None
        upsert_catalog(connection, areas, centers, lists, deactivate_missing=full_catalog)
        run_id = create_run(connection, len(lists))

    prioritized_targets = [
        (priority, position, item)
        for position, item in enumerate(lists)
        if (priority := selection_priority(item, previous.get(int(item["id"])), args)) is not None
    ]
    prioritized_targets.sort(key=lambda target: (target[0], target[1]))
    targets = [item for _, _, item in prioritized_targets]
    if args.limit is not None:
        targets = targets[: args.limit]
    if args.metadata_only:
        targets = []
    print(f"Processing {len(targets)} new, incomplete, or due lists", flush=True)

    total_entries = 0
    completed = 0
    all_errors: list[str] = []
    for number, item in enumerate(targets, 1):
        file_id = int(item["id"])
        print(f"[{number}/{len(targets)}] DPL {file_id}: {item['name']}", flush=True)
        try:
            parsed, dpl_sha, agreements, errors = process_list(client, item)
            total_entries += len(parsed["rows"])
            all_errors.extend(f"DPL {file_id} {error}" for error in errors)
            if connection:
                write_list(connection, item, parsed, dpl_sha, agreements, errors)
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
            completed += 1
        except Exception as exc:
            if connection:
                connection.rollback()
                mark_list_failed(connection, file_id, str(exc))
            message = f"DPL {file_id}: {exc}"
            all_errors.append(message)
            print(f"  ERROR: {message}", file=sys.stderr, flush=True)

    if connection and run_id is not None:
        status = "completed" if not all_errors else "completed_with_errors"
        finish_run(connection, run_id, status, completed, total_entries, all_errors)
        connection.close()
    print(f"Done: {completed} lists, {total_entries} entries, {len(all_errors)} errors")
    return 0 if not all_errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
