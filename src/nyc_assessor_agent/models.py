from __future__ import annotations

from dataclasses import dataclass
from typing import Any


BOROUGH_NAMES = {
    1: "Manhattan",
    2: "Bronx",
    3: "Brooklyn",
    4: "Queens",
    5: "Staten Island",
}


@dataclass(frozen=True)
class BBL:
    borough: int
    block: int
    lot: int

    @property
    def value(self) -> str:
        return f"{self.borough}{self.block:05d}{self.lot:04d}"

    @property
    def borough_name(self) -> str:
        return BOROUGH_NAMES[self.borough]

    @classmethod
    def parse(cls, raw: str | int) -> "BBL":
        text = str(raw).strip().replace("-", "")
        if len(text) != 10 or not text.isdigit():
            raise ValueError("BBL must be a 10-digit value like 1000477501.")
        borough = int(text[0])
        if borough not in BOROUGH_NAMES:
            raise ValueError("BBL borough digit must be 1 through 5.")
        return cls(borough=borough, block=int(text[1:6]), lot=int(text[6:10]))


@dataclass(frozen=True)
class AddressCandidate:
    label: str
    bbl: str | None
    raw: dict[str, Any]


@dataclass(frozen=True)
class AssessorBrief:
    bbl: BBL
    resolved_address: str | None
    assessment_records: list[dict[str, Any]]
    sales_records: list[dict[str, Any]]
    supplemental_records: dict[str, list[dict[str, Any]]]
    signals: list[str]
    next_steps: list[str]
    methodology_notes: list[str]
    external_links: dict[str, str]
    sources: dict[str, str]
