"""Internal status endpoints for manager-api: live Pod session state and read-only Botone readiness."""
import asyncio
import hmac
import time

from aiohttp import web

from .client import BotoneClient, BotoneError


def _session_state(session):
    if session.call_started or session.incoming:
        return "calling"
    if (session.turn and not session.turn.done()) or getattr(session.conn, "client_is_speaking", False):
        return "speaking"
    if session.standby:
        return "standby"
    return "online"


def _authorize(request, secret):
    if not secret:
        raise web.HTTPServiceUnavailable()
    expected = ("Bearer " + secret).encode()
    if not hmac.compare_digest(request.headers.get("Authorization", "").encode(), expected):
        raise web.HTTPUnauthorized()


def mount_status_api(app, sessions, config):
    server_secret = (config.get("manager-api") or {}).get("secret", "")
    botone_cfg = config.get("botone") or {}

    async def handle_sessions(request):
        _authorize(request, server_secret)
        live = {}
        standby_count = 0
        active_count = 0
        calling_count = 0

        for session in list(sessions or ()):
            if session.closed or not session.connected or not getattr(session.conn, "device_id", None):
                continue
            mac = session.conn.device_id.lower()
            state = _session_state(session)
            if state == "calling":
                calling_count += 1
                active_count += 1
            elif state == "speaking":
                active_count += 1
            elif state == "standby":
                standby_count += 1
            else:
                active_count += 1
            live[mac] = {
                "state": state,
                "onlineStandby": bool(session.online_standby),
                "inCall": bool(session.call_started or session.incoming),
                "targetBotId": session.target,
                "lastActivityAt": getattr(session.conn, "last_activity_time", None),
            }

        return web.json_response({
            "botoneConfigured": bool(botone_cfg.get("url") and botone_cfg.get("secret")),
            "botoneUrl": str(botone_cfg.get("url") or "").rstrip("/"),
            "summary": {
                "connected": len(live),
                "standby": standby_count,
                "active": active_count,
                "calling": calling_count,
            },
            "sessions": live,
        })

    async def handle_botone_status(request):
        _authorize(request, server_secret)
        botone_url = str(botone_cfg.get("url") or "").rstrip("/")
        if not botone_url or not botone_cfg.get("secret"):
            return web.json_response({
                "bridgeOk": False,
                "botoneUrl": botone_url,
                "accountReady": False,
                "boboReady": False,
                "boboBotId": None,
                "authStatus": "bridge_unconfigured",
                "modelReady": False,
            })

        try:
            body = await request.json()
        except (ValueError, UnicodeError):
            raise web.HTTPBadRequest()
        if not isinstance(body, dict) or not body.get("issuer") or not body.get("subject"):
            raise web.HTTPBadRequest()

        payload = {
            "issuer": str(body["issuer"]),
            "subject": str(body["subject"]),
        }
        if isinstance(body.get("chatModel"), str) and body["chatModel"].strip():
            payload["chatModel"] = body["chatModel"].strip()

        started = time.monotonic()
        client = BotoneClient(botone_cfg)
        try:
            res = await asyncio.wait_for(client.request("status", payload), timeout=4.0)
            latency_ms = int((time.monotonic() - started) * 1000)
            body_out = {
                "bridgeOk": True,
                "latencyMs": latency_ms,
                "botoneUrl": botone_url,
                "accountReady": bool(res.get("accountReady")),
                "boboReady": bool(res.get("boboReady")),
                "boboBotId": res.get("boboBotId"),
                "authStatus": res.get("authStatus") or "unavailable",
                "modelReady": bool(res.get("modelReady")),
            }
            if isinstance(res.get("availableModels"), dict):
                body_out["availableModels"] = res["availableModels"]
            return web.json_response(body_out)
        except (BotoneError, Exception):
            latency_ms = int((time.monotonic() - started) * 1000)
            return web.json_response({
                "bridgeOk": False,
                "latencyMs": latency_ms,
                "botoneUrl": botone_url,
                "accountReady": False,
                "boboReady": False,
                "boboBotId": None,
                "authStatus": "unavailable",
                "modelReady": False,
            })
        finally:
            await client.close()

    app.router.add_get("/internal/pod/sessions", handle_sessions)
    app.router.add_post("/internal/pod/botone-status", handle_botone_status)
