from websockets.datastructures import Headers

from core.utils.util import normalize_ws_headers


def test_normalize_ws_headers_merges_duplicate_headers():
    raw = Headers(
        [
            ("Device-Id", "c4:9e:7e:0b:d8:7c"),
            ("Client-Id", "test-uuid"),
            ("Via", "1.1 Caddy"),
            ("Via", "2.0 Caddy"),
            ("X-Forwarded-For", "1.2.3.4"),
            ("X-Forwarded-For", "5.6.7.8"),
        ]
    )
    normalized = normalize_ws_headers(raw)
    assert normalized["device-id"] == "c4:9e:7e:0b:d8:7c"
    assert normalized["client-id"] == "test-uuid"
    assert normalized["via"] == "1.1 Caddy, 2.0 Caddy"
    assert normalized["x-forwarded-for"] == "1.2.3.4, 5.6.7.8"


def test_normalize_ws_headers_plain_dict_and_none():
    assert normalize_ws_headers(None) == {}
    assert normalize_ws_headers({"Device-Id": "aa:bb"}) == {"device-id": "aa:bb"}
