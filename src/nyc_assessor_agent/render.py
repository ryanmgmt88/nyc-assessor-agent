from __future__ import annotations

from .models import AssessorBrief


def render_text(brief: AssessorBrief) -> str:
    lines = [
        "NYC Assessor Brief",
        f"BBL: {brief.bbl.value} ({brief.bbl.borough_name}, block {brief.bbl.block}, lot {brief.bbl.lot})",
    ]
    if brief.resolved_address:
        lines.append(f"Resolved address: {brief.resolved_address}")

    lines.append("")
    lines.append("Signals")
    lines.extend(f"- {signal}" for signal in brief.signals)

    lines.append("")
    lines.append("Next steps")
    lines.extend(f"- {step}" for step in brief.next_steps)

    lines.append("")
    lines.append("Sources")
    for label, url in brief.sources.items():
        lines.append(f"- {label}: {url}")

    return "\n".join(lines)
