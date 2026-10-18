from __future__ import annotations

import hashlib
import io
import json
import os
import random
import re
import threading
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from pypdf import PdfReader

BASE_URL = "https://www.fs.usda.gov/business/incident"
API_URL = f"{BASE_URL}/vipr/iipa_api.php"
PIID_RE = re.compile(r"^(?:12[A-Z0-9]{6}T\d{4}|AG-[A-Z0-9]{4}-[A-Z]-\d{2}-\d{4})$", re.I)


class UpstreamError(RuntimeError):
    pass


class ParseError(RuntimeError):
    pass


@dataclass
class CachedFile:
    content: bytes
    path: Path
    from_cache: bool


class ForestServiceClient:
    """Rate-limited USDA client. Requests are serialized within each worker."""

    def __init__(self, cache_dir: Path | str = "data/cache") -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.user_agent = os.getenv(
            "FS_USER_AGENT",
            "FireOps/1.0 USFS dispatch import (set FS_USER_AGENT with operator contact)",
        )
        self.min_interval = float(os.getenv("FS_REQUEST_INTERVAL", "3.0"))
        self.timeout = float(os.getenv("FS_TIMEOUT", "90"))
        self.cache_max_age = float(os.getenv("FS_CACHE_MAX_AGE", "86400"))
        self._lock = threading.Lock()
        self._last_request = 0.0

    def _request(self, url: str, attempts: int = 3) -> tuple[bytes, dict[str, str]]:
        last_error: Exception | None = None
        for attempt in range(attempts):
            server_wait = 0.0
            with self._lock:
                wait = self.min_interval - (time.monotonic() - self._last_request)
                if wait > 0:
                    time.sleep(wait)
                request = Request(url, headers={"User-Agent": self.user_agent, "Accept": "*/*"})
                try:
                    with urlopen(request, timeout=self.timeout) as response:
                        body = response.read()
                        headers = {key.lower(): value for key, value in response.headers.items()}
                    self._last_request = time.monotonic()
                    return body, headers
                except HTTPError as exc:
                    self._last_request = time.monotonic()
                    last_error = exc
                    if exc.code not in (429, 500, 502, 503, 504):
                        break
                    retry_after = exc.headers.get("Retry-After")
                    if retry_after and retry_after.isdigit():
                        server_wait = float(retry_after)
                except OSError as exc:
                    self._last_request = time.monotonic()
                    last_error = exc
            time.sleep(max(server_wait, (2**attempt) + random.random()))
        raise UpstreamError(f"USDA request failed: {last_error}") from last_error

    @staticmethod
    def _api_url(service_name: str) -> str:
        query = urlencode(
            {"rAccess": random.randint(10_000_000, 99_999_999), "serviceName": service_name}
        )
        return f"{API_URL}?{query}"

    def json_service(self, service_name: str) -> Any:
        body, headers = self._request(self._api_url(service_name))
        if "application/json" not in headers.get("content-type", ""):
            raise UpstreamError(f"Expected JSON for {service_name}")
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise UpstreamError(f"Invalid JSON for {service_name}") from exc

    def geographic_areas(self) -> list[dict[str, Any]]:
        return self.json_service("AllGeographicAreas")

    def dispatch_centers(self, area_id: int) -> list[dict[str, Any]]:
        return self.json_service(f"AllDispatchCentersForGeographicArea?gaccId={area_id}")

    def priority_lists(self, center_id: int) -> list[dict[str, Any]]:
        return self.json_service(f"PublishedDplsForDispatchCenter?dispatchCenterId={center_id}")

    def _cached_pdf(self, cache_key: str, service_name: str, legacy_url: str | None = None) -> CachedFile:
        safe_key = re.sub(r"[^A-Za-z0-9_.-]", "_", cache_key)
        path = self.cache_dir / f"{safe_key}.pdf"
        if path.exists() and path.stat().st_size > 4 and time.time() - path.stat().st_mtime <= self.cache_max_age:
            return CachedFile(path.read_bytes(), path, True)

        try:
            body, _ = self._request(self._api_url(service_name))
        except UpstreamError:
            if not legacy_url:
                raise
            body, _ = self._request(legacy_url)
        if not body.startswith(b"%PDF") and legacy_url:
            body, _ = self._request(legacy_url)
        if not body.startswith(b"%PDF"):
            raise UpstreamError(f"Expected PDF for {cache_key}")

        temporary = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            temporary.write_bytes(body)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
        path.with_suffix(".sha256").write_text(hashlib.sha256(body).hexdigest() + "\n")
        return CachedFile(body, path, False)

    def dpl_pdf(self, file_id: int) -> CachedFile:
        return self._cached_pdf(f"dpl-{file_id}", f"DplPdf?fileid={file_id}")

    def agreement_pdf(self, piid: str) -> CachedFile:
        piid = piid.strip().upper()
        if not PIID_RE.fullmatch(piid):
            raise ValueError(f"Invalid agreement PIID: {piid}")
        legacy = f"{BASE_URL}/static/awarded_equipment_reports/{quote(piid)}.pdf"
        return self._cached_pdf(
            f"agreement-{piid}",
            f"AgreementPdfByContractNumber?contractNumber={piid}",
            legacy,
        )


def pdf_text(pdf: bytes, layout: bool = False) -> str:
    reader = PdfReader(io.BytesIO(pdf))
    mode = "layout" if layout else "plain"
    return "\n\f\n".join(page.extract_text(extraction_mode=mode) or "" for page in reader.pages)


def normalize_vin(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def _header_columns(line: str) -> list[tuple[str, int]]:
    matches = list(re.finditer(r"\S(?:.*?\S)?(?=\s{2,}|$)", line.rstrip()))
    return [(match.group().strip(), match.start()) for match in matches]


def _key(label: str) -> str:
    aliases = {
        "agreement piid": "agreement_piid",
        "company name, dba": "company_name",
        "equipment location": "equipment_location",
    }
    normalized = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    return aliases.get(label.lower(), normalized)


def parse_dpl(pdf: bytes) -> dict[str, Any]:
    return parse_dpl_text(pdf_text(pdf, layout=True))


def parse_dpl_text(text: str) -> dict[str, Any]:
    lines = text.splitlines()
    title_lines = [line.strip() for line in lines[:8] if line.strip()]
    published = next(
        (line.removeprefix("Published On:").strip() for line in title_lines if line.startswith("Published On:")),
        None,
    )
    dispatch_center = title_lines[0] if title_lines else ""
    resource_type = title_lines[1] if len(title_lines) > 1 else ""
    rows: list[dict[str, str]] = []
    columns: list[tuple[str, int]] = []
    current: dict[str, str] | None = None
    kept_fields = {"rank", "agreement_piid", "company_name", "equipment_location", "vin", "clin", "cafs"}

    for line in lines:
        if "Rank" in line and "Agreement PIID" in line and "CLIN" in line:
            columns = _header_columns(line)
            continue
        if not columns or not line.strip():
            continue
        values: dict[str, str] = {}
        for index, (label, start) in enumerate(columns):
            end = columns[index + 1][1] if index + 1 < len(columns) else None
            key = _key(label)
            if key in kept_fields:
                values[key] = line[start:end].strip()

        rank = values.get("rank", "")
        piid = values.get("agreement_piid", "").upper()
        if rank.isdigit() and PIID_RE.fullmatch(piid):
            if current:
                rows.append(current)
            current = {key: value for key, value in values.items() if value}
            current["rank"] = rank
            current["agreement_piid"] = piid
        elif current:
            for key in ("company_name", "equipment_location", "cafs"):
                value = values.get(key)
                if value:
                    current[key] = f"{current.get(key, '')}\n{value}".strip()
    if current:
        rows.append(current)

    if not dispatch_center or not resource_type or not rows:
        raise ParseError("DPL did not contain expected title and ranked rows")
    return {
        "dispatch_center": dispatch_center,
        "resource_type": resource_type,
        "published_on": published,
        "rows": rows,
    }


def parse_agreement_rates(pdf: bytes) -> list[dict[str, Any]]:
    return parse_agreement_text(pdf_text(pdf))


def parse_agreement_text(text: str) -> list[dict[str, Any]]:
    start = text.find("Schedule of Items (SOI)")
    if start < 0:
        raise ParseError("Agreement did not contain Schedule of Items (SOI)")
    end_match = re.search(r"Section\s+B\s*-\s*Introduction", text[start:], re.I)
    end = start + end_match.start() if end_match else len(text)
    soi = text[start:end]
    blocks = re.split(r"(?=Table\s+\d+\s*-\s*SOI\s+for\s+)", soi, flags=re.I)
    rates: list[dict[str, Any]] = []
    saw_priced_item = False

    for block in blocks:
        if not re.match(r"Table\s+\d+\s*-\s*SOI\s+for\s+", block, re.I):
            continue
        heading = re.search(
            r"Table\s+(\d+)\s*-\s*SOI\s+for\s+(.+?)\s+(?:VIN|Serial Number|Unique ID):\s*(.+?)\s+for\s+(.+?)\s+Resource Information",
            block,
            re.I | re.S,
        )
        clin = re.search(r"(?:^|\n)CLIN\s+([^\s]+)", block, re.I)
        vin = re.search(r"(?:^|\n)(?:VIN|Serial Number|Unique ID)\s+(.+?)\s*(?:\n|$)", block, re.I)
        status = re.search(r"(?:^|\n)Status\s+(.+?)\s*(?:\n|$)", block, re.I)
        daily = re.search(
            r"(?:^|\n)(Min Daily Guarantee Rate|Daily Rate)\s+\$?([\d,]+(?:\.\d{2})?)\s*/\s*Day",
            block,
            re.I,
        )
        raw_vin = vin.group(1).strip() if vin else (heading.group(3).strip() if heading else "")
        award_status = status.group(1).strip() if status else None
        if not (clin and daily and normalize_vin(raw_vin)):
            continue
        saw_priced_item = True
        if award_status and award_status.lower() != "awarded":
            continue
        try:
            amount = Decimal(daily.group(2).replace(",", "")).quantize(Decimal("0.01"))
        except InvalidOperation:
            continue
        record: dict[str, Any] = {
            "clin": clin.group(1).strip(),
            "vin": raw_vin,
            "normalized_vin": normalize_vin(raw_vin),
            "daily_rate": amount,
            "rate_type": "minimum_daily_guarantee" if daily.group(1).lower().startswith("min ") else "daily_rate",
            "award_status": award_status,
            "daily_rate_display": f"${amount:,.2f}/Day",
        }
        if heading:
            record.update(
                {
                    "table": int(heading.group(1)),
                    "resource_type": " ".join(heading.group(2).split()),
                    "dispatch_center": " ".join(heading.group(4).split()),
                }
            )
        rates.append(record)
    if not rates and not saw_priced_item:
        raise ParseError("Agreement SOI did not contain equipment identifiers with daily rates")
    return rates


def enrich_rows(rows: list[dict[str, Any]], rates_by_piid: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Match only within agreement by normalized VIN; never guess using company or CLIN."""
    for row in rows:
        vin = normalize_vin(row.get("vin"))
        candidates = [
            rate
            for rate in rates_by_piid.get(row["agreement_piid"], [])
            if vin and rate.get("normalized_vin") == vin
        ]
        amounts = {rate["daily_rate"] for rate in candidates}
        row["rate"] = candidates[0] if len(amounts) == 1 else None
        row["rate_status"] = "matched" if len(amounts) == 1 else ("ambiguous" if candidates else "not_found")
    return rows
