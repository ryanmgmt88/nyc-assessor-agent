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
        self.supplemental_datasets = {
            "dob_now_jobs": os.getenv("NYC_DOB_NOW_JOBS_DATASET", "w9ak-ipjd"),
            "dob_co": os.getenv("NYC_DOB_CO_DATASET", "bs8b-p36w"),
            "dob_now_co": os.getenv("NYC_DOB_NOW_CO_DATASET", "pkdm-hqz6"),
            "dob_violations": os.getenv("NYC_DOB_VIOLATIONS_DATASET", "3h2n-5cm9"),
            "dob_ecb_violations": os.getenv("NYC_DOB_ECB_VIOLATIONS_DATASET", "6bgk-3dad"),
            "pluto": os.getenv("NYC_PLUTO_DATASET", "64uk-42ks"),
        }

    def brief_for_bbl(self, bbl: str | int) -> AssessorBrief:
        parsed = BBL.parse(bbl)
        assessments = self._assessment_records(parsed)
        sales = self._sales_records(parsed)
        supplemental = self._supplemental_records(parsed)
        return self._build_brief(parsed, assessments, sales, supplemental, resolved_address=None)

    def brief_for_address(self, address: str) -> AssessorBrief:
        candidate = self.geosearch.resolve_address(address)
        if not candidate or not candidate.bbl:
            raise ValueError(f"Could not resolve address to a NYC BBL: {address}")

        parsed = BBL.parse(candidate.bbl)
        assessments = self._assessment_records(parsed)
        sales = self._sales_records(parsed)
        supplemental = self._supplemental_records(parsed)
        return self._build_brief(parsed, assessments, sales, supplemental, resolved_address=candidate.label)

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

    def _supplemental_records(self, bbl: BBL) -> dict[str, list[dict[str, Any]]]:
        limits = {
            "dob_now_jobs": 10,
            "dob_co": 10,
            "dob_now_co": 10,
            "dob_violations": 10,
            "dob_ecb_violations": 10,
            "pluto": 3,
        }
        records: dict[str, list[dict[str, Any]]] = {}
        for label, dataset in self.supplemental_datasets.items():
            try:
                records[label] = self._records_by_bbl(dataset, bbl, limit=limits[label])
            except Exception as exc:
                records[label] = [{"error": str(exc), "dataset": dataset}]
        return records

    def _records_by_bbl(self, dataset: str, bbl: BBL, *, limit: int) -> list[dict[str, Any]]:
        columns = self.socrata.columns(dataset)
        where = self._where_for_bbl(columns, bbl)
        if not where:
            return []
        params = {
            "$limit": str(limit),
            "$where": where,
            "$order": self._best_order(
                columns,
                [
                    "c_o_issue_date",
                    "c_of_o_issuance_date",
                    "filing_date",
                    "submitted_date",
                    "issue_date",
                    "dobrundate",
                    "version",
                ],
            ),
        }
        return self.socrata.rows(dataset, params)

    def _build_brief(
        self,
        bbl: BBL,
        assessments: list[dict[str, Any]],
        sales: list[dict[str, Any]],
        supplemental: dict[str, list[dict[str, Any]]],
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

        counts = {
            "DOB NOW jobs": len(supplemental.get("dob_now_jobs", [])),
            "DOB certificates of occupancy": len(supplemental.get("dob_co", [])),
            "DOB NOW certificates of occupancy": len(supplemental.get("dob_now_co", [])),
            "DOB violations": len(supplemental.get("dob_violations", [])),
            "DOB ECB violations": len(supplemental.get("dob_ecb_violations", [])),
        }
        for label, count in counts.items():
            if count:
                signals.append(f"{label}: {count} record(s) returned.")

        next_steps = [
            "Verify final figures in NYC DOF property records before relying on them.",
            "Compare assessment trend against recent arms-length sales and nearby comparable parcels.",
            "Check BIS and DOB NOW together because DOB says public building records are split across both systems during the transition.",
            "Review ACRIS deeds and recorded documents for transfer, condo, easement, mortgage, and legal-description context.",
            "Check exemptions, abatements, building class, tax class, zoning, CO/legal use, and physical changes if evaluating an appeal.",
        ]

        return AssessorBrief(
            bbl=bbl,
            resolved_address=resolved_address,
            assessment_records=assessments,
            sales_records=sales,
            supplemental_records=supplemental,
            signals=signals,
            next_steps=next_steps,
            methodology_notes=self._methodology_notes(),
            external_links=self._external_links(bbl),
            sources={
                "assessment": self.socrata.dataset_url(self.assessment_dataset),
                "sales": self.socrata.dataset_url(self.sales_dataset),
                **{label: self.socrata.dataset_url(dataset) for label, dataset in self.supplemental_datasets.items()},
                "geosearch": self.geosearch.docs_url,
                "dof_market_value": "https://www.nyc.gov/site/finance/property/property-determining-your-market-value.page",
                "dof_assessment_roll": "https://www.nyc.gov/site/finance/property/assessment-roll-explanation.page",
                "dof_terms": "https://www.nyc.gov/site/finance/property/definitions-of-property-assessment-terms.page",
                "dob_find_building_data": "https://www.nyc.gov/site/buildings/dob/find-building-data.page",
                "dob_co_guidance": "https://www.nyc.gov/site/buildings/industry/obtain-a-co.page",
                "acris": "https://www.nyc.gov/site/finance/property/acris.page",
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
        block_values = [str(bbl.block), f"{bbl.block:05d}"]
        lot_values = [str(bbl.lot), f"{bbl.lot:04d}", f"{bbl.lot:05d}"]
        block_clause = _or_equals("block", block_values)
        lot_clause = _or_equals("lot", lot_values)
        if "bbl" in lowered:
            return f"bbl='{bbl.value}'"
        if "bble" in lowered:
            return f"bble='{bbl.value}'"
        if "parid" in lowered:
            return f"parid='{bbl.value}'"
        if {"boro", "block", "lot"}.issubset(lowered):
            return f"boro='{bbl.borough}' AND ({block_clause}) AND ({lot_clause})"
        if {"borough", "block", "lot"}.issubset(lowered):
            borough_clause = _or_equals("borough", [str(bbl.borough), bbl.borough_name.upper(), _borough_abbrev(bbl.borough)])
            return f"({borough_clause}) AND ({block_clause}) AND ({lot_clause})"
        return None

    @staticmethod
    def _best_order(columns: set[str], candidates: list[str]) -> str:
        lowered = {column.lower() for column in columns}
        clauses = [f"{candidate} DESC" for candidate in candidates if candidate in lowered]
        return ", ".join(clauses) if clauses else ":id DESC"

    @staticmethod
    def _external_links(bbl: BBL) -> dict[str, str]:
        return {
            "DOB BIS property profile": (
                "https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet"
                f"?boro={bbl.borough}&block={bbl.block}&lot={bbl.lot}&go2=+GO+&requestid=0"
            ),
            "DOB NOW public portal": "https://a810-dobnow.nyc.gov/publish/Index.html#!/",
            "DOB NOW certificate of occupancy search": "https://a810-dobnow.nyc.gov/publish/Index.html#!/",
            "ACRIS property records": "https://a836-acris.nyc.gov/CP/",
            "ZoLa zoning lot": f"https://zola.planning.nyc.gov/l/lot/{bbl.borough}/{bbl.block}/{bbl.lot}",
            "NYC Digital Tax Map": "https://propertyinformationportal.nyc.gov/",
            "DOF property tax bills": "https://www.nyc.gov/site/finance/property/property-tax-bills.page",
            "NYC Property Information Portal": "https://propertyinformationportal.nyc.gov/",
        }

    @staticmethod
    def _methodology_notes() -> list[str]:
        return [
            "DOF determines market value every year, and the method varies by tax class.",
            "Class 1 valuation uses statistical modeling of comparable neighborhood sales from the prior three years.",
            "Class 2 co-ops, condos, and larger residential properties are valued as income-producing properties under state law.",
            "Class 4 commercial properties are generally valued from income earning potential and expenses, including RPIE data where applicable.",
            "Assessed value is market value multiplied by the assessment percentage, then caps, phase-ins, exemptions, and abatements can affect taxable value.",
        ]


def brief_to_dict(brief: AssessorBrief) -> dict[str, Any]:
    return asdict(brief)


def _or_equals(field: str, values: list[str]) -> str:
    unique = []
    for value in values:
        if value and value not in unique:
            unique.append(value)
    return " OR ".join(f"{field}='{value}'" for value in unique)


def _borough_abbrev(borough: int) -> str:
    return {1: "MN", 2: "BX", 3: "BK", 4: "QN", 5: "SI"}[borough]
