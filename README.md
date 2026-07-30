# NYC Assessor Agent

A local Python agent for researching NYC property assessment context from public city data.

It can:

- Resolve a NYC address to a likely BBL using NYC Planning GeoSearch.
- Accept a BBL directly.
- Query NYC Open Data for property valuation / assessment records.
- Query NYC Open Data annualized sales records for comparable transaction context.
- Return a concise assessor-style research brief with source URLs and caveats.

The implementation uses only the Python standard library.

## Data Sources

- NYC Department of Finance assessment and roll datasets are listed on the DOF Open Data portal.
- NYC DOF annualized property sales use NYC Open Data dataset `w2pb-icbu`.
- NYC Planning GeoSearch resolves address text to authoritative NYC address records.

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

## Important Caveat

This is a research assistant, not an official assessment determination. Always verify final figures against NYC Department of Finance records before filing, appealing, buying, selling, or advising.
