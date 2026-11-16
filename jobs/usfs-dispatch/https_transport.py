from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime
from typing import Any, Optional


class LeaseLostError(RuntimeError):
    """Raised when the sync lease is no longer held by this runner."""


def _parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        if isinstance(value, str):
            if value.endswith("Z"):
                value = value[:-1] + "+00:00"
            return datetime.fromisoformat(value)
    except Exception:
        return None
    return None


class SupabaseHttpClient:
    """Minimal PostgREST RPC client with retries and timeouts."""

    def __init__(self, base_url: str, service_key: str, timeout: float = 30.0, retries: int = 3, backoff_factor: float = 0.5):
        import requests
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry

        if not base_url.endswith("/"):
            base_url += "/"
        self.base_url = base_url
        self._requests = requests
        self.session = requests.Session()
        retry = Retry(
            total=retries,
            connect=retries,
            read=retries,
            status=retries,
            backoff_factor=backoff_factor,
            status_forcelist=(408, 409, 425, 429, 500, 502, 503, 504),
            allowed_methods=frozenset(["GET", "POST"]),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)
        self.timeout = timeout
        self._headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
        }

    def post_rpc(self, name: str, payload: dict[str, Any]) -> Any:
        url = f"{self.base_url}rest/v1/rpc/{name}"
        resp = self.session.post(url, headers=self._headers, data=json.dumps(payload), timeout=self.timeout)
        content_type = resp.headers.get("content-type", "")
        body = None
        try:
            if "application/json" in content_type and resp.text:
                body = resp.json()
        except Exception:
            body = None
        if 200 <= resp.status_code < 300:
            return body
        message = ""
        if isinstance(body, dict):
            message = body.get("message") or body.get("error") or ""
        if resp.status_code == 409 or "USFS sync lease" in (message or "") or "Another USFS dispatch sync" in (message or ""):
            raise LeaseLostError(message or f"Lease lost during RPC {name}")
        raise RuntimeError(f"Supabase RPC {name} failed: HTTP {resp.status_code} {message or (resp.text[:200] if resp.text else '')}")


class HttpSupabaseTransport:
    """Implements the VIPR sync write path over Supabase RPC with a lease/heartbeat."""

    def __init__(self, client: SupabaseHttpClient, holder: uuid.UUID, lease_seconds: int = 1800, heartbeat_interval: int = 60):
        self.client = client
        self.holder = str(holder)
        self.lease_seconds = lease_seconds
        self.heartbeat_interval = heartbeat_interval
        self._hb_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self.run_id: Optional[int] = None

    @staticmethod
    def published_iso_utc(value: Optional[str]) -> Optional[str]:
        """Convert a USDA title timestamp to ISO-8601 UTC for Postgres timestamptz parsing."""
        if not value:
            return None
        # Expect USFS patterns already parsed upstream if needed; prefer passing through ISO from caller when available.
        # The caller converts legacy patterns as needed.
        return value

    def begin_run(self, areas, centers, lists, deactivate_missing: bool, parser_version: str = "1") -> tuple[dict[int, dict[str, Any]], dict[str, str], int]:
        result = self.client.post_rpc(
            "usfs_begin_run",
            {
                "p_holder": self.holder,
                "p_areas": [{"id": int(a["id"]), "name": a["Areaname"]} for a in areas],
                "p_centers": [
                    {"id": int(c["centerid"]), "geographic_area_id": int(c["geographic_area_id"]), "name": c["centername"]}
                    for c in centers
                ],
                "p_lists": [
                    {"file_id": int(l["id"]), "dispatch_center_id": int(l["dispatch_center_id"]), "name": l["name"]}
                    for l in lists
                ],
                "p_deactivate_missing": bool(deactivate_missing),
                "p_lease_seconds": int(self.lease_seconds),
                "p_parser_version": parser_version,
            },
        )
        state = result.get("state") or {}
        prev_lists: dict[int, dict[str, Any]] = {}
        for item in state.get("lists", []) or []:
            prev_lists[int(item["file_id"])] = {
                "name": item.get("name"),
                "sync_status": item.get("sync_status"),
                "last_checked_at": _parse_ts(item.get("last_checked_at")),
                "pdf_sha256": item.get("pdf_sha256"),
                "synced_at": _parse_ts(item.get("synced_at")),
                "last_error": item.get("last_error"),
            }
        agreements: dict[str, str] = dict((k, v) for k, v in (state.get("agreements") or {}).items())
        self.run_id = int(result["run_id"])
        self._start_heartbeat()
        return prev_lists, agreements, self.run_id

    def _start_heartbeat(self) -> None:
        if self._hb_thread is not None:
            return

        def loop():
            try:
                while not self._stop_event.wait(self.heartbeat_interval):
                    self.client.post_rpc("usfs_heartbeat", {"p_holder": self.holder, "p_lease_seconds": int(self.lease_seconds)})
            except LeaseLostError:
                self._stop_event.set()

        t = threading.Thread(target=loop, name="usfs-heartbeat", daemon=True)
        t.start()
        self._hb_thread = t

    def stop(self) -> None:
        self._stop_event.set()
        if self._hb_thread and self._hb_thread.is_alive():
            self._hb_thread.join(timeout=2)

    def write_list(self, file_id: int, parsed: dict[str, Any], dpl_sha: str, agreements: dict[str, Any], errors: list[str], warnings: list[str]) -> dict[str, Any]:
        payload = {
            "p_holder": self.holder,
            "p_file_id": int(file_id),
            "p_list": {
                "dispatch_center_name": parsed.get("dispatch_center"),
                "resource_type": parsed.get("resource_type"),
                # Caller should pass ISO-8601 or None; DB will parse timestamptz input
                "published_at": parsed.get("_published_iso_utc"),
                "pdf_sha256": dpl_sha,
            },
            "p_agreements": [
                {
                    "piid": piid,
                    "pdf_sha256": agreement["sha256"],
                    "rates": [
                        {
                            "clin": str(rate["clin"]),
                            "vin": str(rate["vin"]),
                            "normalized_vin": rate["normalized_vin"],
                            "daily_rate": str(rate["daily_rate"]),
                            "resource_type": rate.get("resource_type"),
                            "dispatch_center": rate.get("dispatch_center"),
                            "source_data": rate,
                        }
                        for rate in agreement.get("rates") or []
                    ],
                }
                for piid, agreement in agreements.items()
            ],
            "p_rows": [
                {
                    "rank": int(row["rank"]),
                    "agreement_piid": row["agreement_piid"],
                    "company_name": row.get("company_name"),
                    "equipment_location": row.get("equipment_location"),
                    "vin": row.get("vin"),
                    "normalized_vin": row.get("normalized_vin", "") or "",
                    "cafs": row.get("cafs"),
                }
                for row in parsed["rows"]
            ],
            "p_errors": errors,
            "p_warnings": warnings,
        }
        return self.client.post_rpc("usfs_write_list", payload)

    def mark_list_failed(self, file_id: int, error: str) -> None:
        self.client.post_rpc("usfs_mark_list_failed", {"p_holder": self.holder, "p_file_id": int(file_id), "p_error": str(error)[:2000]})

    def get_state(self) -> dict[int, dict[str, Any]]:
        state = self.client.post_rpc("usfs_get_state", {"p_holder": self.holder}) or {}
        prev_lists: dict[int, dict[str, Any]] = {}
        for item in (state.get("lists") or []):
            prev_lists[int(item["file_id"])] = {
                "name": item.get("name"),
                "sync_status": item.get("sync_status"),
                "last_checked_at": _parse_ts(item.get("last_checked_at")),
                "pdf_sha256": item.get("pdf_sha256"),
                "synced_at": _parse_ts(item.get("synced_at")),
                "last_error": item.get("last_error"),
            }
        return prev_lists

    def cleanup(self, retention_days: int) -> dict[str, int]:
        out = self.client.post_rpc("usfs_cleanup", {"p_holder": self.holder, "p_retention_days": int(retention_days)}) or {}
        return {
            "retired_lists": int(out.get("lists_deleted") or 0),
            "orphan_agreements": int(out.get("agreements_deleted") or 0),
        }

    def finish_run(self, status: str, lists_synced: int, entries: int, errors: list[str]) -> None:
        if self.run_id is None:
            return
        self.client.post_rpc(
            "usfs_finish_run",
            {
                "p_holder": self.holder,
                "p_run_id": int(self.run_id),
                "p_status": status,
                "p_lists_synced": int(lists_synced),
                "p_entries_synced": int(entries),
                "p_error_message": ("\n".join(errors) or None),
            },
        )
        self.stop()

