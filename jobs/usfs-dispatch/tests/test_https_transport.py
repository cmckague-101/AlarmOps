import time
import uuid

import sys
from pathlib import Path
# Ensure ROOT (jobs/usfs-dispatch) is on sys.path for module imports in tests
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sync_supabase as _sync  # noqa: E402,F401
from https_transport import HttpSupabaseTransport, SupabaseHttpClient, LeaseLostError  # type: ignore
from sync_supabase import published_iso_utc, start_watchdog  # type: ignore


class FakeClient:
    def __init__(self):
        self.calls = []
        self.responses = {}

    def post_rpc(self, name: str, payload: dict):
        self.calls.append((name, payload))
        if name in self.responses:
            resp = self.responses[name]
            if isinstance(resp, Exception):
                raise resp
            return resp
        return {}


def test_rpc_payload_mapping_for_write_list():
    fake = FakeClient()
    t = HttpSupabaseTransport(fake, uuid.uuid4())
    parsed = {
        "dispatch_center": "Great Basin Coordination Center",
        "resource_type": "Type 6 Engines",
        "published_on": "07/14/2026 02:30 PM GMT",
    }
    parsed["_published_iso_utc"] = published_iso_utc(parsed["published_on"])
    agreements = {
        "PIID123": {
            "sha256": "abc",
            "rates": [
                {
                    "clin": "0001",
                    "vin": "1C6RR7YT5CS123456",
                    "normalized_vin": "1C6RR7YT5CS123456",
                    "daily_rate": "450.00",
                    "resource_type": "Engine",
                    "dispatch_center": "Great Basin",
                    "source_data": {"clin": "0001"},
                }
            ],
        }
    }
    rows = [{"rank": 1, "agreement_piid": "PIID123", "company_name": "Acme", "equipment_location": "Boise, ID", "vin": "1C6RR7YT5CS123456", "normalized_vin": "1C6RR7YT5CS123456", "cafs": None}]
    result = {"ok": True}
    fake.responses["usfs_write_list"] = result

    out = t.write_list(42, {"rows": rows, **parsed}, "dplsha", agreements, [], [])
    assert out is result
    name, payload = fake.calls[-1]
    assert name == "usfs_write_list"
    assert payload["p_file_id"] == 42
    assert payload["p_list"]["dispatch_center_name"] == "Great Basin Coordination Center"
    assert payload["p_list"]["resource_type"] == "Type 6 Engines"
    assert payload["p_list"]["pdf_sha256"] == "dplsha"
    assert payload["p_list"]["published_at"] == parsed["_published_iso_utc"]
    assert payload["p_agreements"][0]["piid"] == "PIID123"
    assert payload["p_rows"][0]["rank"] == 1
    assert payload["p_rows"][0]["agreement_piid"] == "PIID123"


def test_supabase_http_client_retries_configured():
    client = SupabaseHttpClient("https://example.test", "sk_test", timeout=12, retries=5, backoff_factor=0.1)
    https_adapter = client.session.get_adapter("https://")
    # The adapter must be configured with a Retry object with our totals
    assert getattr(https_adapter, "max_retries").total == 5


def test_lease_loss_abort_heartbeat_stops():
    fake = FakeClient()
    # Begin run returns a run and empty state
    fake.responses["usfs_begin_run"] = {"run_id": 1, "state": {"lists": [], "agreements": {}}}
    # Heartbeat raises lease loss
    fake.responses["usfs_heartbeat"] = LeaseLostError("lost")
    t = HttpSupabaseTransport(fake, uuid.uuid4(), lease_seconds=60, heartbeat_interval=0)  # immediate heartbeat
    t.begin_run([], [], [], False, parser_version="1")
    # Permit the heartbeat loop to run at least once
    time.sleep(0.05)
    assert t._stop_event.is_set()


def test_watchdog_trips_after_interval():
    fired = start_watchdog(0.05)
    assert not fired.is_set()
    time.sleep(0.1)
    assert fired.is_set()

