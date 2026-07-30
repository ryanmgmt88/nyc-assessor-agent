from __future__ import annotations

import argparse
import json
import sys

from .agent import NYCAssessorAgent, brief_to_dict
from .render import render_text


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Research NYC property assessment context.")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--bbl", help="10-digit NYC borough-block-lot identifier.")
    target.add_argument("--address", help="NYC street address to resolve to a BBL.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    agent = NYCAssessorAgent()

    try:
        brief = agent.brief_for_bbl(args.bbl) if args.bbl else agent.brief_for_address(args.address)
    except Exception as exc:
        print(f"nyc-assessor: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(brief_to_dict(brief), indent=2, default=str))
    else:
        print(render_text(brief))
    return 0
