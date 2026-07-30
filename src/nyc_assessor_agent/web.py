from __future__ import annotations

import argparse
import base64
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .agent import NYCAssessorAgent, brief_to_dict

ASSET_DIR = Path(__file__).with_name("web_assets")


class AssessorWebHandler(BaseHTTPRequestHandler):
    agent = NYCAssessorAgent()

    def do_GET(self) -> None:
        if not self._authorized():
            self._send_auth_challenge()
            return

        parsed = urlparse(self.path)
        if parsed.path in ("", "/"):
            self._send_file(ASSET_DIR / "index.html", "text/html; charset=utf-8")
            return
        if parsed.path == "/styles.css":
            self._send_file(ASSET_DIR / "styles.css", "text/css; charset=utf-8")
            return
        if parsed.path == "/app.js":
            self._send_file(ASSET_DIR / "app.js", "application/javascript; charset=utf-8")
            return
        if parsed.path == "/api/brief":
            self._send_brief(parse_qs(parsed.query))
            return
        self.send_error(404, "Not found")

    def log_message(self, format: str, *args: object) -> None:
        return

    def _authorized(self) -> bool:
        password = os.getenv("NYC_ASSESSOR_PASSWORD")
        if not password:
            return True

        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            decoded = base64.b64decode(header.removeprefix("Basic ").strip()).decode("utf-8")
        except Exception:
            return False

        username, separator, provided_password = decoded.partition(":")
        return bool(separator) and username == "admin" and hmac.compare_digest(provided_password, password)

    def _send_auth_challenge(self) -> None:
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="NYC Assessor Agent"')
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_brief(self, params: dict[str, list[str]]) -> None:
        bbl = _first(params, "bbl")
        address = _first(params, "address")
        try:
            if bbl:
                brief = self.agent.brief_for_bbl(bbl)
            elif address:
                brief = self.agent.brief_for_address(address)
            else:
                raise ValueError("Provide a BBL or address.")
            self._send_json(brief_to_dict(brief))
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=400)

    def _send_file(self, path: Path, content_type: str) -> None:
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, payload: object, *, status: int = 200) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _first(params: dict[str, list[str]], key: str) -> str:
    values = params.get(key) or [""]
    return values[0].strip()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the NYC Assessor Agent web UI.")
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    parser.add_argument("--port", default=int(os.getenv("PORT", "8765")), type=int)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    server = ThreadingHTTPServer((args.host, args.port), AssessorWebHandler)
    print(f"NYC Assessor Agent UI: http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
