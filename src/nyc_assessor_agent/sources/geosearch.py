from __future__ import annotations

from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen
import json

from ..models import AddressCandidate


class GeoSearchClient:
    base_url = "https://geosearch.planninglabs.nyc/v2/search"
    docs_url = "https://geosearch.planninglabs.nyc/docs/"

    def resolve_address(self, text: str) -> AddressCandidate | None:
        payload = self._get_json({"text": text, "size": "1"})
        features = payload.get("features") or []
        if not features:
            return None

        feature: dict[str, Any] = features[0]
        properties = feature.get("properties") or {}
        bbl = _find_bbl(properties)
        return AddressCandidate(label=properties.get("label", text), bbl=bbl, raw=feature)

    def _get_json(self, params: dict[str, str]) -> dict[str, Any]:
        url = f"{self.base_url}?{urlencode(params)}"
        with urlopen(url, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))


def _find_bbl(properties: dict[str, Any]) -> str | None:
    for key in ("bbl", "boroughBlockLot", "pad_bbl"):
        value = properties.get(key)
        if value:
            text = str(value).strip()
            if len(text) == 10 and text.isdigit():
                return text
    pad = (properties.get("addendum") or {}).get("pad") or {}
    value = pad.get("bbl")
    if value:
        text = str(value).strip()
        if len(text) == 10 and text.isdigit():
            return text
    return None
