"""Expose the active Pod's voice actions and advertised hardware tools to the Botone worker."""
import asyncio
import hmac

from aiohttp import web
from jsonschema import Draft7Validator
from referencing import Registry

from core.providers.tools.device_mcp.mcp_handler import call_mcp_tool

from .client import BotoneError

DEFAULT_TOOLS = (
    "self.get_device_status", "self.audio_speaker.set_volume", "self.screen.set_brightness",
    "self.screen.set_theme", "self.screen.play_animation", "self.system.reconfigure_wifi",
)

VOICE_TOOLS = {
    "pod_end_conversation": {
        "description": "结束当前 Pod 对话，播放告别语并进入待机。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    "pod_play_music": {
        "description": "在当前 Pod 播放曲库中的歌曲，省略 song 时随机选择。",
        "inputSchema": {"type": "object", "properties": {"song": {"type": "string", "minLength": 1,
                                                                 "maxLength": 200}}, "additionalProperties": False},
    },
}


def mount_device_tools(app, sessions, config):
    async def handle(request):
        expected = ("Bearer " + config["secret"]).encode()
        if not hmac.compare_digest(request.headers.get("Authorization", "").encode(), expected):
            raise web.HTTPUnauthorized()
        try:
            body = await request.json()
        except (ValueError, UnicodeError):
            raise web.HTTPBadRequest()
        if not isinstance(body, dict) or not isinstance(body.get("turnId"), str):
            raise web.HTTPBadRequest()
        def active(session):
            return (not session.closed and session.owner and session.hardware_turn == body["turnId"]
                    and session._device_key() == body.get("deviceKey"))

        session = next((s for s in sessions if active(s)), None)
        if session is None:
            raise web.HTTPConflict(reason="Pod turn unavailable")
        try:
            await asyncio.wait_for(session.hardware_ready.wait(), timeout=2)
        except asyncio.TimeoutError:
            raise web.HTTPConflict(reason="Pod turn not acknowledged")
        if not session.hardware_run or session.hardware_run != body.get("runId"):
            raise web.HTTPConflict(reason="Pod run changed")
        try:
            await session._identity()
        except BotoneError:
            raise web.HTTPConflict(reason="Pod binding unavailable")
        if not active(session):
            raise web.HTTPConflict(reason="Pod turn changed")
        client = getattr(session.conn, "mcp_client", None)
        allowed = config.get("device_tools", DEFAULT_TOOLS)
        available = {}
        if client and await client.is_ready():
            available = {name: tool for name, tool in client.tools.items() if tool["name"] in allowed}
        available.update(VOICE_TOOLS)
        if request.match_info["action"] == "list":
            definitions = []
            for name, tool in available.items():
                definition = {"name": name, "description": tool["description"], "inputSchema": tool["inputSchema"]}
                if tool.get("name") == "self.system.reconfigure_wifi":
                    definition["readOnly"] = False
                definitions.append(definition)
            return web.json_response(definitions)
        name, args, execution = body.get("tool"), body.get("args"), body.get("executionId")
        if (not active(session)
                or not isinstance(name, str) or name not in available
                or not isinstance(args, dict) or not isinstance(execution, str) or not execution):
            raise web.HTTPConflict(reason="Pod tool unavailable")
        schema = available[name]["inputSchema"]
        if set(args).difference(schema.get("properties", {})):
            raise web.HTTPBadRequest(reason="Unknown hardware argument")
        if not Draft7Validator(schema, registry=Registry()).is_valid(args):
            raise web.HTTPBadRequest(reason="Invalid hardware arguments")
        # A worker retry must observe the original hardware acknowledgement.
        calls = session.hardware_calls
        if execution not in calls:
            if session.audio_tool_turn is not None:
                raise web.HTTPConflict(reason="Pod voice turn already handled")
            if len(calls) >= 128:
                raise web.HTTPTooManyRequests()
            action = (session.play_voice_tool(body["turnId"], name, args) if name in VOICE_TOOLS
                      else call_mcp_tool(session.conn, client, name, args, timeout=12))
            calls[execution] = asyncio.create_task(action)
        try:
            result = await asyncio.shield(calls[execution])
        except asyncio.CancelledError:
            if not active(session):
                raise web.HTTPConflict(reason="Pod turn ended")
            raise
        except (RuntimeError, ValueError, TimeoutError) as error:
            return web.json_response({"error": str(error)}, status=502)
        return web.json_response({"result": result})

    app.router.add_post("/internal/device-tools/{action:list|call}", handle)
