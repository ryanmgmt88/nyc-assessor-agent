from __future__ import annotations

from functools import lru_cache
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import json


class SocrataClient:
    def __init__(self, *, domain: str = "data.cityofnewyork.us", app_token: str | None = None) -> None:
        self.domain = domain
        self.app_token = app_token

    def dataset_url(self, dataset: str) -> str:
        return f"https://{self.domain}/d/{dataset}"

    @lru_cache(maxsize=32)
    def columns(self, dataset: str) -> set[str]:
        metadata = self._get_json(f"https://{self.domain}/api/views/{dataset}")
        columns = metadata.get("columns") or []
        field_names = {column.get("fieldName", "").lower() for column in columns}
        return {field for field in field_names if field}

    def rows(self, dataset: str, params: dict[str, str]) -> list[dict[str, Any]]:
        url = f"https://{self.domain}/resource/{dataset}.json?{urlencode(params)}"
        payload = self._get_json(url)
        if not isinstance(payload, list):
            raise ValueError(f"Unexpected Socrata response for dataset {dataset}: {payload!r}")
        return payload

    def _get_json(self, url: str) -> Any:
        headers = {"User-Agent": "nyc-assessor-agent/0.1"}
        if self.app_token:
            headers["X-App-Token"] = self.app_token
        request = Request(url, headers=headers)
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
