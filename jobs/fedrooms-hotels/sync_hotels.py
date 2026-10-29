#!/usr/bin/env python3
"""Import the GSA FedRooms accepted-properties list into Supabase.

The XLSX filename changes with each GSA update, so every run reads the FedRooms
page for the current link and only rewrites hotels when the file content changes.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import os
import random
import sys
import time
from html.parser import HTMLParser
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

PAGE_URL = "https://www.gsa.gov/travel/hotels-fedrooms"
COLUMNS = {
    "hotel name": "name",
    "address": "address",
    "postal city": "city",
    "city": "city",
    "state": "state",
    "zip": "postal_code",
    "zip code": "postal_code",
    "postal code": "postal_code",
    "country": "country",
}
FIELDS = ("name", "address", "city", "state", "postal_code", "country")
# Refuse to drop more than half the stored hotels in one run unless forced; a
# truncated or reformatted upstream file should not empty the app's list.
MIN_KEEP_RATIO = 0.5


class SourceError(RuntimeError):
    pass


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Download and parse without writing Supabase")
    parser.add_argument("--force", action="store_true", help="Import even when the XLSX is unchanged")
    parser.add_argument("--allow-shrink", action="store_true", help="Allow removing more than half of stored hotels")
    parser.add_argument("--url", help="Use this XLSX URL instead of discovering it from the FedRooms page")
    return parser.parse_args()


def fetch(url: str, attempts: int = 3) -> bytes:
    user_agent = os.getenv("FEDROOMS_USER_AGENT", "FireOps/1.0 FedRooms hotel import")
    timeout = float(os.getenv("FEDROOMS_TIMEOUT", "90"))
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = Request(url, headers={"User-Agent": user_agent, "Accept": "*/*"})
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except HTTPError as exc:
            last_error = exc
            if exc.code not in (429, 500, 502, 503, 504):
                break
        except OSError as exc:
            last_error = exc
        if attempt + 1 < attempts:
            time.sleep((2**attempt) * 5 + random.random())
    raise SourceError(f"GSA request failed for {url}: {last_error}") from last_error


class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href is not None:
            self.links.append((self._href, " ".join("".join(self._text).split())))
            self._href = None


def find_xlsx_url(html: str, base_url: str = PAGE_URL) -> str:
    parser = _LinkParser()
    parser.feed(html)
    candidates = [
        (href, text) for href, text in parser.links
        if href.lower().split("?")[0].endswith(".xlsx")
    ]
    if not candidates:
        raise SourceError("No XLSX link found on the FedRooms page")

    def score(link: tuple[str, str]) -> int:
        href, text = link[0].lower(), link[1].lower()
        return (2 if "fedrooms properties" in text else 0) + (1 if "propert" in href else 0)

    return urljoin(base_url, max(candidates, key=score)[0])


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = " ".join(str(value).split())
    return text or None


def property_key(hotel: dict[str, str | None]) -> str:
    normalized = "|".join((hotel.get(field) or "").casefold() for field in FIELDS)
    return hashlib.sha256(normalized.encode()).hexdigest()


def parse_hotels(content: bytes) -> list[dict[str, str | None]]:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    try:
        for sheet in workbook.worksheets:
            rows = sheet.iter_rows(values_only=True)
            for header in rows:
                names = [(_clean(cell) or "").casefold() for cell in header]
                if "hotel name" not in names:
                    continue
                index = {COLUMNS[name]: i for i, name in enumerate(names) if name in COLUMNS}
                return _read_rows(rows, index)
    finally:
        workbook.close()
    raise SourceError("No sheet with a 'Hotel Name' header found in the FedRooms XLSX")


def _read_rows(rows, index: dict[str, int]) -> list[dict[str, str | None]]:
    hotels: dict[str, dict[str, str | None]] = {}
    for row in rows:
        hotel = {field: _clean(row[i]) if i < len(row) else None for field, i in index.items()}
        hotel = {field: hotel.get(field) for field in FIELDS}
        if not hotel["name"]:
            continue
        hotel["country"] = hotel["country"] or "United States"
        # Numeric ZIP cells lose leading zeros (e.g. 02134 -> 2134).
        zip_code = hotel["postal_code"]
        if hotel["country"] == "United States" and zip_code and zip_code.isdigit() and len(zip_code) < 5:
            hotel["postal_code"] = zip_code.zfill(5)
        hotels.setdefault(property_key(hotel), hotel)
    return [{"property_key": key, **hotel} for key, hotel in hotels.items()]


def connect_database():
    database_url = os.getenv("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required unless --dry-run is used")
    try:
        import psycopg
    except ImportError as exc:
        raise SystemExit("Install database dependency: pip install 'psycopg[binary]'") from exc
    return psycopg.connect(database_url)


def last_imported_sha(conn) -> str | None:
    row = conn.execute(
        "select source_sha256 from public.fedrooms_sync_runs"
        " where status in ('completed', 'unchanged') and source_sha256 is not null"
        " order by started_at desc limit 1"
    ).fetchone()
    return row[0] if row else None


def write_hotels(conn, hotels: list[dict[str, str | None]], *, allow_shrink: bool) -> tuple[int, int]:
    """Replace stored hotels with this file's set. Returns (added, removed)."""
    with conn.transaction():
        stored = conn.execute("select count(*) from public.fedrooms_hotels").fetchone()[0]
        if stored and len(hotels) < stored * MIN_KEEP_RATIO and not allow_shrink:
            raise SourceError(
                f"Parsed {len(hotels)} hotels but {stored} are stored; refusing to drop more than"
                f" {int((1 - MIN_KEEP_RATIO) * 100)}% (rerun with --allow-shrink if intended)"
            )
        conn.execute(
            "create temp table fedrooms_import (like public.fedrooms_hotels including defaults) on commit drop"
        )
        columns = ("property_key", *FIELDS)
        with conn.cursor().copy(f"copy fedrooms_import ({', '.join(columns)}) from stdin") as copy:
            for hotel in hotels:
                copy.write_row([hotel[column] for column in columns])
        added = conn.execute(
            f"insert into public.fedrooms_hotels ({', '.join(columns)})"
            f" select {', '.join(columns)} from fedrooms_import"
            " on conflict (property_key) do update set last_seen_at = now()"
            " returning (xmax = 0)"
        ).fetchall()
        removed = conn.execute(
            "delete from public.fedrooms_hotels hotel"
            " where not exists (select 1 from fedrooms_import i where i.property_key = hotel.property_key)"
        ).rowcount
    return sum(1 for (inserted,) in added if inserted), removed


def main() -> int:
    args = arguments()
    conn = None if args.dry_run else connect_database()
    run_id = None
    if conn:
        run_id = conn.execute(
            "insert into public.fedrooms_sync_runs default values returning id"
        ).fetchone()[0]
        conn.commit()

    def finish(status: str, **values: Any) -> None:
        if not conn:
            return
        values = {"status": status, **values}
        assignments = ", ".join(f"{key} = %({key})s" for key in values)
        conn.execute(
            f"update public.fedrooms_sync_runs set {assignments}, finished_at = now() where id = %(id)s",
            {**values, "id": run_id},
        )
        conn.commit()

    source_url = args.url
    try:
        if not source_url:
            source_url = find_xlsx_url(fetch(PAGE_URL).decode("utf-8", "replace"))
        print(f"Source: {source_url}")
        content = fetch(source_url)
        sha256 = hashlib.sha256(content).hexdigest()
        if conn and not args.force and last_imported_sha(conn) == sha256:
            print("XLSX unchanged since last import; nothing to do.")
            finish("unchanged", source_url=source_url, source_sha256=sha256)
            return 0
        hotels = parse_hotels(content)
        if not hotels:
            raise SourceError("FedRooms XLSX contained no hotels")
        print(f"Parsed {len(hotels)} hotels")
        if not conn:
            for hotel in hotels[:5]:
                print(f"  {hotel['name']} - {hotel['city']}, {hotel['state'] or hotel['country']}")
            return 0
        added, removed = write_hotels(conn, hotels, allow_shrink=args.allow_shrink)
        print(f"Added {added}, removed {removed}, total {len(hotels)}")
        finish(
            "completed", source_url=source_url, source_sha256=sha256,
            hotels_total=len(hotels), hotels_added=added, hotels_removed=removed,
        )
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        if conn:
            conn.rollback()
            finish("failed", source_url=source_url, error_message=str(exc)[:2000])
        return 1
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
