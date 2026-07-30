from nyc_assessor_agent.agent import NYCAssessorAgent
from nyc_assessor_agent.models import BBL


class FakeSocrata:
    def __init__(self):
        self.calls = []

    def columns(self, dataset):
        if dataset == "assess":
            return {"bbl", "year", "market_value", "assessed_value"}
        return {"borough", "block", "lot", "sale_date", "sale_price"}

    def rows(self, dataset, params):
        self.calls.append((dataset, params))
        if dataset == "assess":
            return [{"year": "2027", "market_value": "1000000", "assessed_value": "450000"}]
        return [{"sale_date": "2025-01-02", "sale_price": "950000"}]

    def dataset_url(self, dataset):
        return f"https://example.test/{dataset}"


def test_bbl_parse_formats_components():
    bbl = BBL.parse("1000477501")
    assert bbl.borough_name == "Manhattan"
    assert bbl.block == 47
    assert bbl.lot == 7501
    assert bbl.value == "1000477501"


def test_agent_builds_brief_for_bbl():
    fake = FakeSocrata()
    agent = NYCAssessorAgent(socrata=fake, assessment_dataset="assess", sales_dataset="sales")

    brief = agent.brief_for_bbl("1000477501")

    assert brief.bbl.value == "1000477501"
    assert "Market Value: 1000000" in brief.signals
    assert any("Found 1 matching sales record(s)" in signal for signal in brief.signals)
    assert fake.calls[0][1]["$where"] == "bbl='1000477501'"
    assert "block='47'" in fake.calls[1][1]["$where"]
