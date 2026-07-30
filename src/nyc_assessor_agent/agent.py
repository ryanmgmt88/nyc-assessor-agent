from __future__ import annotations

import os
from dataclasses import asdict
from typing import Any

from .models import AssessorBrief, BBL
from .sources.geosearch import GeoSearchClient
from .sources.socrata import SocrataClient


class NYCAssessorAgent:
    """Coordinates public NYC property data into an assessor-style brief."""

    def __init__(
        self,
        *,
        socrata: SocrataClient | None = None,
        geosearch: GeoSearchClient | None = None,
        assessment_dataset: str | None = None,
        sales_dataset: str | None = None,
    ) -> None:
        self.socrata = socrata or SocrataClient(app_token=os.getenv("NYC_OPEN_DATA_APP_TOKEN"))
        self.geosearch = geosearch or GeoSearchClient()
        self.assessment_dataset = assessment_dataset or os.getenv("NYC_ASSESSMENT_DATASET", "8y4t-faws")
        self.sales_dataset = sales_dataset or os.getenv("NYC_SALES_DATASET", "w2pb-icbu")

    def brief_for_bbl(self, bbl: str | int) -> AssessorBrief:
        parsed = BBL.parse(bbl)
        assessments = self._assessment_records(parsed)
        sales = self._sales_records(parsed)
        return self._build_brief(parsed, assessments, sales, resolved_address=None)

    def brief_for_address(self, address: str) -> AssessorBrief:
        candidate = self.geosearch.resolve_address(address)
        if not candidate or not candidate.bbl:
            raise ValueError(f"Could not resolve address to a NYC BBL: {address}")

        parsed = BBL.parse(candidate.bbl)
        assessments = self._assessment_records(parsed)
        sales = self._sales_records(parsed)
        return self._build_brief(parsed, assessments, sales, resolved_address=candidate.label)

    def _assessment_records(self, bbl: BBL) -> list[dict[str, Any]]:
        columns = self.socrata.columns(self.assessment_dataset)
        where = self._where_for_bbl(columns, bbl)
        params: dict[str, str] = {
            "$limit": "8",
            "$order": self._best_order(columns, ["year", "tax_year", "roll_year", "period"]),
        }
        if where:
            params["$where"] = where
        return self.socrata.rows(self.assessment_dataset, params)

    def _sales_records(self, bbl: BBL) -> list[dict[str, Any]]:
        columns = self.socrata.columns(self.sales_dataset)
        where = self._where_for_bbl(columns, bbl)
        if not where:
            borough_name = bbl.borough_name.upper()
            where = f"upper(borough)='{borough_name}' AND block='{bbl.block}' AND lot='{bbl.lot}'"
        params = {
            "$limit": "10",
            "$where": where,
            "$order": self._best_order(columns, ["sale_date", "year", "sale_price"]),
        }
        return self.socrata.rows(self.sales_dataset, params)

    def _build_brief(
        self,
        bbl: BBL,
        assessments: list[dict[str, Any]],
        sales: list[dict[str, Any]],
        *,
        resolved_address: str | None,
    ) -> AssessorBrief:
        signals = []
        if assessments:
            latest = assessments[0]
            signals.extend(self._assessment_signals(latest))
        else:
            signals.append("No assessment rows were returned for this parcel from the configured assessment dataset.")

        if sales:
            signals.append(f"Found {len(sales)} matching sales record(s) in the annualized sales dataset.")
        else:
            signals.append("No matching annualized sales records were returned for this BBL.")

        next_steps = [
            "Verify final figures in NYC DOF property records before relying on them.",
            "Compare assessment trend against recent arms-length sales and nearby comparable parcels.",
            "Check exemptions, abatements, building class, tax class, and notice of property value if evaluating an appeal.",
        ]

        return AssessorBrief(
            bbl=bbl,
            resolved_address=resolved_address,
            assessment_records=assessments,
            sales_records=sales,
            signals=signals,
            next_steps=next_steps,
            sources={
                "assessment": self.socrata.dataset_url(self.assessment_dataset),
                "sales": self.socrata.dataset_url(self.sales_dataset),
                "geosearch": self.geosearch.docs_url,
            },
        )

    @staticmethod
    def _assessment_signals(row: dict[str, Any]) -> list[str]:
        preferred = [
            "year",
            "tax_year",
            "roll_year",
            "period",
            "owner",
            "street_name",
            "tax_class",
            "taxclass",
            "curtaxclass",
            "fintaxclass",
            "building_class",
            "bldgcl",
            "bldg_class",
            "zoning",
            "market_value",
            "full_market_value",
            "fullval",
            "curmkttot",
            "finmkttot",
            "assessed_value",
            "actual_assessed_value",
            "curacttot",
            "finacttot",
            "transitional_assessed_value",
            "curtrntot",
            "fintrntot",
            "avland",
            "avtot",
            "exempt_value",
            "exland",
            "extot",
        ]
        signals = []
        normalized = {key.lower(): value for key, value in row.items()}
        for key in preferred:
            value = normalized.get(key)
            if value not in (None, ""):
                signals.append(f"{key.replace('_', ' ').title()}: {value}")
        if not signals:
            sample = {key: row[key] for key in list(row)[:6]}
            signals.append(f"Latest assessment row returned with fields: {sample}")
        return signals

    @staticmethod
    def _where_for_bbl(columns: set[str], bbl: BBL) -> str | None:
        lowered = {column.lower() for column in columns}
        if "bbl" in lowered:
            return f"bbl='{bbl.value}'"
        if "bble" in lowered:
            return f"bble='{bbl.value}'"
        if {"boro", "block", "lot"}.issubset(lowered):
            return f"boro='{bbl.borough}' AND block='{bbl.block}' AND lot='{bbl.lot}'"
        if {"borough", "block", "lot"}.issubset(lowered):
            return f"borough='{bbl.borough_name.upper()}' AND block='{bbl.block}' AND lot='{bbl.lot}'"
        return None

    @staticmethod
    def _best_order(columns: set[str], candidates: list[str]) -> str:
        lowered = {column.lower() for column in columns}
        clauses = [f"{candidate} DESC" for candidate in candidates if candidate in lowered]
        return ", ".join(clauses) if clauses else ":id DESC"


def brief_to_dict(brief: AssessorBrief) -> dict[str, Any]:
    return asdict(brief)
