from decimal import Decimal
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper import ParseError, enrich_rows, normalize_vin, parse_agreement_text, parse_dpl_text


DPL_TEXT = """Durango Interagency Dispatch Center
Communications Unit Mobile Type 2
Published On: 08/27/2026 05:08 PM GMT

 Rank            Agreement PIID                   Company Name, DBA               Contact Information             Equipment Location       VIN                    CLIN    CAFS
 1               12024B26T7074                    Example Vendor                  Example Contact                 Somewhere, Colorado      TEST-VIN-0001          0002    Yes
                                                                                   Email: dispatch@example.test
"""

AGREEMENT_TEXT = """Schedule of Items (SOI)
Table 1 - SOI for Communications Unit Mobile Type 2 (COM2)
VIN: TEST-VIN-0001 for
(CO-DRC) Durango Interagency Dispatch Center
Resource Information Attribute Values & Rates
Status Awarded
CLIN 0002
VIN TEST-VIN-0001
Daily Rate $3,450.00/Day
Section B - Introduction
Daily Rate $999,999.00/Day
"""


def test_parse_dpl_keeps_only_display_fields_and_internal_join_keys():
    parsed = parse_dpl_text(DPL_TEXT)
    row = parsed["rows"][0]

    assert parsed["resource_type"] == "Communications Unit Mobile Type 2"
    assert row["agreement_piid"] == "12024B26T7074"
    assert row["company_name"] == "Example Vendor"
    assert "contact_information" not in row
    assert "dispatch@example.test" not in str(row)
    assert set(row) <= {
        "rank", "agreement_piid", "company_name", "equipment_location", "vin", "clin", "cafs"
    }


def test_agreement_rate_joins_by_agreement_and_normalized_vin():
    parsed = parse_dpl_text(DPL_TEXT)
    rates = parse_agreement_text(AGREEMENT_TEXT)
    parsed["rows"][0]["normalized_vin"] = normalize_vin(parsed["rows"][0]["vin"])
    rows = enrich_rows(parsed["rows"], {"12024B26T7074": rates})

    assert rates[0]["daily_rate"] == Decimal("3450.00")
    assert rows[0]["rate_status"] == "matched"
    assert rows[0]["rate"]["daily_rate"] == Decimal("3450.00")


def test_agreement_accepts_serial_number_used_as_dpl_vin():
    agreement = """Schedule of Items (SOI)
Table 1 - SOI for Chipper Type 1 (CHP1)
Serial Number: 4S8SZ190XNW052886 for
(ID-CDC) Coeur d'Alene Interagency Dispatch Center
Resource Information Attribute Values & Rates
CLIN 0003
Serial Number 4S8SZ190XNW052886
Daily Rate $6,800.00/Day
Section B - Introduction
"""

    rates = parse_agreement_text(agreement)
    assert rates[0]["normalized_vin"] == "4S8SZ190XNW052886"
    assert rates[0]["daily_rate"] == Decimal("6800.00")


def test_agreement_accepts_unique_id_and_excludes_non_awarded_items():
    agreement = """Schedule of Items (SOI)
Table 1 - SOI for Faller Module (FMOD)
Unique ID: ADAMS FALLER MOD2 for
(ID-CDC) Coeur d'Alene Interagency Dispatch Center
Resource Information Attribute Values & Rates
Status Awarded
CLIN 0002
Unique ID ADAMS FALLER MOD2
Daily Rate $2,550.00/Day
Table 2 - SOI for Faller Module (FMOD)
Unique ID: SUSPENDED MOD for
(ID-CDC) Coeur d'Alene Interagency Dispatch Center
Resource Information Attribute Values & Rates
Status Suspended
CLIN 0003
Unique ID SUSPENDED MOD
Daily Rate $9,999.00/Day
Section B - Introduction
"""

    rates = parse_agreement_text(agreement)
    assert len(rates) == 1
    assert rates[0]["vin"] == "ADAMS FALLER MOD2"
    assert rates[0]["normalized_vin"] == "ADAMSFALLERMOD2"
    assert rates[0]["daily_rate"] == Decimal("2550.00")
    assert rates[0]["award_status"] == "Awarded"


def test_agreement_with_only_canceled_items_is_valid_without_rates():
    agreement = """Schedule of Items (SOI)
Table 1 - SOI for Faller Module (FMOD)
Unique ID: CANCELED MOD for
(CA-CCCC) Central California Communications Center
Resource Information Attribute Values & Rates
Status Canceled
CLIN 0001
Unique ID CANCELED MOD
Daily Rate $2,998.99/Day
Section B - Introduction
"""

    assert parse_agreement_text(agreement) == []


def test_agreement_accepts_minimum_daily_guarantee_rate():
    agreement = """Schedule of Items (SOI)
Table 1 - SOI for Crew Carrier Bus (BUCC)
VIN: 1BAKCCPAX8F250929 for
(ID-GVC) Grangeville Interagency Dispatch Center
Resource Information Attribute Values & Rates
Status Awarded
CLIN 0001
VIN 1BAKCCPAX8F250929
Min Daily Guarantee Rate $1,335.00/Day
Per Mile Rate $7.75/Mile
Section B - Introduction
"""

    rate = parse_agreement_text(agreement)[0]
    assert rate["daily_rate"] == Decimal("1335.00")
    assert rate["rate_type"] == "minimum_daily_guarantee"


def test_join_does_not_fall_back_to_clin_when_vin_differs():
    row = {"agreement_piid": "12024B26T7074", "clin": "0002", "vin": "VIN-1"}
    rates = [{"clin": "0002", "normalized_vin": "VIN2", "daily_rate": Decimal("1.00")}]

    result = enrich_rows([row], {"12024B26T7074": rates})[0]
    assert result["rate_status"] == "not_found"
    assert result["rate"] is None


def test_conflicting_rates_for_same_vin_are_ambiguous():
    row = {"agreement_piid": "12024B26T7074", "vin": "VIN-1"}
    rates = [
        {"normalized_vin": "VIN1", "daily_rate": Decimal("1.00")},
        {"normalized_vin": "VIN1", "daily_rate": Decimal("2.00")},
    ]

    result = enrich_rows([row], {"12024B26T7074": rates})[0]
    assert result["rate_status"] == "ambiguous"
    assert result["rate"] is None


def test_empty_dpl_and_agreement_fail_instead_of_replacing_good_data():
    for parser, text in ((parse_dpl_text, "empty"), (parse_agreement_text, "empty")):
        try:
            parser(text)
        except ParseError:
            pass
        else:
            raise AssertionError("Expected ParseError")
