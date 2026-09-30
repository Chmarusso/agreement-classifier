"""HTTP API: GET /health, POST /anonymize, POST /deanonymize (stdlib ThreadingHTTPServer)."""

from __future__ import annotations

import json
import logging
import os
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .engine import SUPPORTED_LANGUAGES, Anonymizer, Options, deanonymize
from .ner import load_ner
from .spans import LABELS

API_VERSION = "1"
MAX_BODY_BYTES = 5 * 1024 * 1024

log = logging.getLogger("anonymizer.server")


class RequestError(Exception):
    def __init__(self, message: str, status: int = HTTPStatus.BAD_REQUEST):
        super().__init__(message)
        self.status = status


class AnonymizerServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], engine: Anonymizer):
        super().__init__(address, Handler)
        self.engine = engine


class Handler(BaseHTTPRequestHandler):
    server: AnonymizerServer
    protocol_version = "HTTP/1.1"
    server_version = "anonymizer/" + API_VERSION

    def do_GET(self) -> None:
        started = time.perf_counter()
        if self._route() == "/health":
            engine = self.server.engine
            self._reply(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "version": API_VERSION,
                    "ner": engine.ner is not None,
                    "engine": engine.engine_name,
                    "labels": list(LABELS),
                    "ner_models": engine.ner.available() if engine.ner else {},
                    "ner_default_models": engine.ner.defaults if engine.ner else {},
                },
                started,
            )
        else:
            self._reply(HTTPStatus.NOT_FOUND, {"error": "not found"}, started)

    def do_POST(self) -> None:
        started = time.perf_counter()
        handler = {"/anonymize": self._anonymize, "/deanonymize": self._deanonymize}.get(self._route())
        if handler is None:
            self.close_connection = True
            self._reply(HTTPStatus.NOT_FOUND, {"error": "not found"}, started)
            return
        try:
            payload, stats = handler(self._read_json())
        except RequestError as e:
            self._reply(e.status, {"error": str(e)}, started)
        except Exception:  # noqa: BLE001 - never leak internals (or text) to the client
            log.exception("unhandled error in %s", self._route())
            self._reply(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal error"}, started)
        else:
            self._reply(HTTPStatus.OK, payload, started, stats)

    def _anonymize(self, body: dict[str, Any]) -> tuple[dict, str]:
        text = body.get("text")
        if not isinstance(text, str):
            raise RequestError('"text" must be a string')
        language = body.get("language")
        if language is not None and language not in SUPPORTED_LANGUAGES:
            raise RequestError('"language" must be "pl", "en" or null')
        keep = body.get("keep") or []
        if not isinstance(keep, list) or not all(isinstance(k, str) for k in keep):
            raise RequestError('"keep" must be a list of strings')
        try:
            options = Options.from_dict(body.get("options"))
            result = self.server.engine.anonymize(text, language, keep, options)
        except ValueError as e:
            raise RequestError(str(e)) from None
        stats = f"lang={result.language} chars={len(text)} entities={len(result.entities)} spans={len(result.spans)}"
        return result.to_dict(), stats

    def _deanonymize(self, body: dict[str, Any]) -> tuple[dict, str]:
        text = body.get("text")
        entities = body.get("entities")
        if not isinstance(text, str):
            raise RequestError('"text" must be a string')
        if not isinstance(entities, list) or not all(
            isinstance(e, dict) and isinstance(e.get("placeholder"), str) and isinstance(e.get("value"), str)
            for e in entities
        ):
            raise RequestError('"entities" must be a list of {"placeholder", "value"} objects')
        return {"text": deanonymize(text, entities)}, f"chars={len(text)} entities={len(entities)}"

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.close_connection = True
            raise RequestError("Content-Length header required") from None
        if length > MAX_BODY_BYTES:
            self.close_connection = True
            raise RequestError("request body exceeds 5 MB", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise RequestError("body must be valid UTF-8 JSON") from None
        if not isinstance(body, dict):
            raise RequestError("body must be a JSON object")
        return body

    def _route(self) -> str:
        return self.path.split("?", 1)[0].rstrip("/") or "/"

    def _reply(self, status: int, payload: dict, started: float, stats: str = "") -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        # One line per request; never the text or entity values.
        elapsed = (time.perf_counter() - started) * 1000
        log.info("%s %s %d %.1fms %s", self.command, self._route(), status, elapsed, stats)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        pass  # replaced by the single line in _reply


def make_server(
    host: str = "127.0.0.1", port: int = 8090, engine: Anonymizer | None = None
) -> AnonymizerServer:
    return AnonymizerServer((host, port), engine or Anonymizer(ner=load_ner()))


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    host = os.environ.get("ANONYMIZER_HOST", "127.0.0.1")
    port = int(os.environ.get("ANONYMIZER_PORT", "8090"))
    server = make_server(host, port)
    log.info("listening on http://%s:%d engine=%s", host, server.server_port, server.engine.engine_name)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
