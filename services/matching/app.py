"""Internal-only HTTP entry point for deterministic name screening."""

from __future__ import annotations

import json
import os
import re
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from services.matching.service import ScreeningService

MAX_REQUEST_BYTES = 16_384
SERVICE = ScreeningService()


def validate_payload(payload: object) -> tuple[str, str, str | None]:
    if not isinstance(payload, dict):
        raise ValueError("JSON body must be an object")
    name = payload.get("name")
    script = payload.get("script")
    country = payload.get("country")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("name must be a non-empty string")
    if not isinstance(script, str) or script.lower() not in {"latin", "arabic"}:
        raise ValueError("script must be latin or arabic")
    if country is not None and (
        not isinstance(country, str) or not re.fullmatch(r"[A-Za-z]{2}", country)
    ):
        raise ValueError("country must be an optional ISO alpha-2 code")
    return name.strip(), script.lower(), country.upper() if country else None


class MatchingRequestHandler(BaseHTTPRequestHandler):
    def _respond(self, status: HTTPStatus, payload: dict) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self) -> None:
        if self.path != "/screen":
            self._respond(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self._respond(HTTPStatus.BAD_REQUEST, {"error": "invalid_request_size"})
            return
        try:
            payload = json.loads(self.rfile.read(length))
            name, script, country = validate_payload(payload)
            self._respond(HTTPStatus.OK, SERVICE.screen(name, script, country))
        except (ValueError, json.JSONDecodeError) as error:
            self._respond(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except RuntimeError as error:
            self._respond(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
        except Exception:
            self._respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "screening_failed"})

    def log_message(self, _format: str, *_args) -> None:
        return


def main() -> None:
    port = int(os.getenv("MATCHING_SERVICE_PORT", "5001"))
    server = ThreadingHTTPServer(("127.0.0.1", port), MatchingRequestHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()