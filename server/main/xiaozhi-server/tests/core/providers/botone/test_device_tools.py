import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from core.providers.llm.botone.device_tools import mount_device_tools
from core.providers.llm.botone.session import PeripheralSession
from core.providers.tools.device_mcp.mcp_client import MCPClient
from core.providers.tools.device_mcp.mcp_handler import handle_mcp_message


class HardwareToolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.config = {"secret": "only-for-test"}
        self.sessions = []
        for device in ("a", "b"):
            mcp = MCPClient()
            await mcp.add_tool({"name": "self.audio_speaker.set_volume", "description": "Volume",
                                "inputSchema": {"type": "object", "properties": {
                                    "volume": {"type": "integer", "maximum": 100, "minimum": 0}},
                                    "required": ["volume"]}})
            await mcp.add_tool({"name": "unlisted", "description": "", "inputSchema": {}})
            await mcp.set_ready(True)
            conn = SimpleNamespace(features={"mcp": True}, config={"botone": {}}, device_id=device, session_id=device,
                                   mcp_client=mcp, websocket=SimpleNamespace(send=AsyncMock()))
            session = PeripheralSession(conn)
            session.owner = {"bindingId": device}
            session._identity = AsyncMock()
            session.hardware_turn = device
            session.hardware_run = "run-" + device
            session.hardware_ready.set()
            self.sessions.append(session)
        self.body = {"deviceKey": self.sessions[0]._device_key(), "turnId": "a", "runId": "run-a"}
        app = web.Application()
        mount_device_tools(app, self.sessions, self.config)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def post(self, action, **extra):
        return await self.client.post("/internal/device-tools/" + action, json={**self.body, **extra},
                                      headers={"Authorization": "Bearer " + self.config["secret"]})

    async def test_hardware_acknowledgement_only_for_speaking_device(self):
        listed = await (await self.post("list")).json()
        self.assertEqual({entry["name"] for entry in listed},
                         {"self_audio_speaker_set_volume", "pod_play_music", "pod_end_conversation"})
        args = {"tool": "self_audio_speaker_set_volume", "args": {"volume": 30}, "executionId": "once"}
        self.assertEqual((await self.post("call", **args, turnId="b")).status, 409)
        self.assertEqual((await self.post("list", runId="another")).status, 409)
        self.assertEqual((await self.post("call", **{**args, "args": {"volume": 130}})).status, 400)
        self.assertEqual((await self.client.post("/internal/device-tools/list", json=self.body)).status, 401)
        conn = self.sessions[0].conn
        async def hardware(message):
            rpc = json.loads(message)["payload"]
            self.assertEqual(rpc["params"], {"name": "self.audio_speaker.set_volume", "arguments": {"volume": 30}})
            await handle_mcp_message(conn, conn.mcp_client, {
                "id": rpc["id"], "result": {"content": [{"type": "text", "text": "volume 30"}]},
            })
        conn.websocket.send.side_effect = hardware
        replies = await asyncio.gather(self.post("call", **args), self.post("call", **args))
        for reply in replies:
            self.assertEqual(await reply.json(), {"result": "volume 30"})
        conn.websocket.send.assert_awaited_once()
        self.sessions[1].conn.websocket.send.assert_not_awaited()
        self.sessions[0].closed = True
        self.assertEqual((await self.post("call", **args)).status, 409)

    async def test_voice_action_takes_over_the_live_reply_once(self):
        session = self.sessions[0]
        session.conn.mcp_client = None
        session.conn.clear_queues = Mock()
        session.conn.client_is_speaking = False
        session.conn.features["online_standby"] = True
        session._restart_events = Mock()
        session._identity = AsyncMock(return_value={"subject": "owner"})
        session.owner["voiceSettings"] = {"chatModel": "chat", "ttsModel": "tts", "ttsVoice": "voice"}
        ready = asyncio.Event()

        async def frames(_action, payload):
            self.body["turnId"] = payload["turnId"]
            yield "session_meta", {"runId": "run-a", "threadId": "thread", "cursor": 1}
            yield "text_delta", {"text": "模型自己的告别。"}
            ready.set()
            await asyncio.Event().wait()

        session.client = SimpleNamespace(stream=frames)
        session._clip = AsyncMock()
        session._synthesize = AsyncMock()
        with patch("core.providers.llm.botone.session.send_stt_message", new_callable=AsyncMock):
            await session.submit("是吧来退下吧。")
            original = session.turn
            await asyncio.wait_for(ready.wait(), 2)
            self.assertEqual({tool["name"] for tool in await (await self.post("list")).json()},
                             {"pod_play_music", "pod_end_conversation"})
            args = {"tool": "pod_end_conversation", "executionId": "bye", "args": {}}
            self.assertEqual((await self.post("call", **{**args, "args": {"unknown": 1}})).status, 400)
            for reply in await asyncio.gather(self.post("call", **args), self.post("call", **args)):
                self.assertEqual(await reply.json(), {"result": {"status": "ending"}})
            await session.turn
        self.assertTrue(original.cancelled())
        self.assertTrue(session.standby)
        session._synthesize.assert_not_awaited()
        session._clip.assert_awaited_once_with("好，我先退下。", "config/assets/botone/standby.wav")
        session.conn.websocket.send.assert_awaited_once_with('{"type":"standby"}')
        self.assertEqual((await self.post("call", **{**args, "executionId": "again"})).status, 409)
