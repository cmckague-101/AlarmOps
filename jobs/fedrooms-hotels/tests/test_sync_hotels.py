import io
import sys
from pathlib import Path

import pytest
from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sync_hotels import SourceError, find_xlsx_url, parse_hotels, property_key


PAGE = """
<p>Download the <a href="/system/files/other.xlsx">per diem rates [XLSX]</a></p>
<p><a download="" href="https://www.gsa.gov/system/files/Oct26-2026%20Accepted%20PropertiesAC.xlsx">full list of
  FedRooms properties [XLSX - 778 KB]</a></p>
"""


def workbook_bytes(rows):
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_find_xlsx_url_prefers_properties_link():
    assert find_xlsx_url(PAGE) == "https://www.gsa.gov/system/files/Oct26-2026%20Accepted%20PropertiesAC.xlsx"


def test_find_xlsx_url_resolves_relative_links():
    html = '<a href="/system/files/Nov-2026 Accepted Properties.xlsx">full list of FedRooms properties</a>'
    assert find_xlsx_url(html) == "https://www.gsa.gov/system/files/Nov-2026 Accepted Properties.xlsx"


def test_find_xlsx_url_requires_a_link():
    with pytest.raises(SourceError):
        find_xlsx_url("<a href='/travel'>Travel</a>")


def test_parse_hotels_maps_headers_pads_zips_and_dedupes():
    content = workbook_bytes([
        ["FedRooms 2026"],
        ["Hotel Name", "Address", "Postal City", "State", "Zip", "Country"],
        ["Courtyard Boston", "1 Main St", "Boston", "Massachusetts", 2134, "United States"],
        ["Courtyard  Boston", "1 Main St", "Boston", "Massachusetts", "02134", "United States"],
        ["GRAND HYATT KUWAIT", "360 MALL", "Kuwait City", None, "47451", "Kuwait"],
        [None, None, None, None, None, None],
    ])
    hotels = parse_hotels(content)
    assert [hotel["name"] for hotel in hotels] == ["Courtyard Boston", "GRAND HYATT KUWAIT"]
    assert hotels[0]["postal_code"] == "02134"
    assert hotels[1]["state"] is None and hotels[1]["country"] == "Kuwait"
    assert hotels[0]["property_key"] == property_key(hotels[0])


def test_parse_hotels_handles_reordered_columns():
    content = workbook_bytes([
        ["Country", "Zip", "Hotel Name", "City", "State", "Address"],
        ["United States", "71129", "Courtyard Shreveport", "Shreveport", "Louisiana", "6001 Financial Plaza"],
    ])
    [hotel] = parse_hotels(content)
    assert hotel["city"] == "Shreveport" and hotel["address"] == "6001 Financial Plaza"


def test_parse_hotels_requires_header():
    with pytest.raises(SourceError):
        parse_hotels(workbook_bytes([["Name", "Where"], ["A", "B"]]))


def test_property_key_ignores_case():
    hotel = {"name": "Hotel", "address": "1 St", "city": "X", "state": "Y", "postal_code": "1", "country": "US"}
    assert property_key(hotel) == property_key({**hotel, "name": "HOTEL"})
