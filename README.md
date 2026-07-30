# NYC Assessor Agent

A local Python agent for researching NYC property assessment context from public city data.

It can:

- Resolve a NYC address to a likely BBL using NYC Planning GeoSearch.
- Accept a BBL directly.
- Query NYC Open Data for property valuation / assessment records.
- Query NYC Open Data annualized sales records for comparable transaction context.
- Query DOB NOW job filings, DOB Certificate of Occupancy, DOB NOW Certificate of Occupancy, DOB violations, DOB ECB violations, and PLUTO records where public Open Data APIs support BBL/block/lot lookup.
- Generate direct research links for DOB BIS, DOB NOW, ACRIS, ZoLa, NYC Digital Tax Map, DOF property tax bills, and the NYC Property Information Portal.
- Summarize official DOF assessment-methodology context by tax class.
- Return a concise assessor-style research brief with source URLs and caveats.

The implementation uses only the Python standard library.

## Data Sources

- NYC Department of Finance assessment and roll datasets are listed on the DOF Open Data portal.
- NYC DOF annualized property sales use NYC Open Data dataset `w2pb-icbu`.
- NYC Planning GeoSearch resolves address text to authoritative NYC address records.
- NYC DOB guidance says BIS and DOB NOW should both be checked while records are split across the two systems.
- NYC DOF publishes guidance on market value, assessment roll fields, assessment terms, NOPVs, exemptions, abatements, and assessment challenges.

## Quick Start

```powershell
py -m nyc_assessor_agent --bbl 1000477501
py -m nyc_assessor_agent --address "120 Broadway, Manhattan"
py -m nyc_assessor_agent --bbl 1000477501 --json
```

## Web UI

```powershell
py -c "import sys; sys.path.insert(0, 'src'); from nyc_assessor_agent.web import main; main()"
```

Then open:

```text
http://127.0.0.1:8765
```

You can also open the standalone UI file directly in a browser:

```text
src/nyc_assessor_agent/web_assets/index.html
```

## Docker

Build and run locally:

```powershell
docker build -t nyc-assessor-agent .
docker run --rm -p 8765:8765 nyc-assessor-agent
```

Then open:

```text
http://127.0.0.1:8765
```

Run with a password before exposing it on the internet:

```powershell
docker run --rm -p 8765:8765 -e NYC_ASSESSOR_PASSWORD="choose-a-strong-password" nyc-assessor-agent
```

The username is `admin`.

The web UI follows the `NYC DOB NOW / BIS Assessor Lookup v26` workflow:

- Auto-detects BBL, BIN, DOB NOW job number, or address keyword.
- Groups DOB NOW filings by parent job number.
- Tracks initial/subsequent/PAA-style suffixes such as `-I1`, `-S1`, `-P1`, and `-A1`.
- Separates approval/declared construction cost from permit-estimated cost signals.
- Pulls DOB NOW CO and legacy BIS job records where available.
- Provides assessor deep links for DOB BIS, DOB NOW, ACRIS, ZoLa, Finance, and the Property Information Portal.

With Docker Compose:

```powershell
docker compose up --build
```

## Access From Anywhere

The simplest cloud path is Render:

1. Push this folder to a GitHub repository.
2. In Render, create a new Blueprint from the repository.
3. Render will use `render.yaml` and the `Dockerfile`.
4. When prompted for `NYC_ASSESSOR_PASSWORD`, enter a strong password.
5. After deploy, open the generated `onrender.com` URL.

Login username:

```text
admin
```

For private access from your own computer instead of cloud hosting, use a VPN-style tool such as Tailscale, ZeroTier, or Cloudflare Tunnel rather than opening a router port directly.

If running from a fresh checkout:

```powershell
$env:PYTHONPATH = "src"
py -m nyc_assessor_agent --bbl 1000477501
```

## Configuration

Optional environment variables:

- `NYC_OPEN_DATA_APP_TOKEN`: Socrata app token for higher rate limits.
- `NYC_ASSESSMENT_DATASET`: NYC Open Data dataset id for assessment records. Defaults to `8y4t-faws`.
- `NYC_SALES_DATASET`: NYC Open Data dataset id for annualized sales. Defaults to `w2pb-icbu`.
- `NYC_DOB_NOW_JOBS_DATASET`: Defaults to `w9ak-ipjd`.
- `NYC_DOB_CO_DATASET`: Defaults to `bs8b-p36w`.
- `NYC_DOB_NOW_CO_DATASET`: Defaults to `pkdm-hqz6`.
- `NYC_DOB_VIOLATIONS_DATASET`: Defaults to `3h2n-5cm9`.
- `NYC_DOB_ECB_VIOLATIONS_DATASET`: Defaults to `6bgk-3dad`.
- `NYC_PLUTO_DATASET`: Defaults to `64uk-42ks`.

## Important Caveat

This is a research assistant, not an official assessment determination. Always verify final figures against NYC Department of Finance records before filing, appealing, buying, selling, or advising.
