import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from core.providers.llm.botone.status_api import mount_status_api


def _fake_session(mac, standby=False, speaking=False, call_started=False, closed=False):
    return SimpleNamespace(
        closed=closed,
        connected=not closed,
        standby=standby,
        online_standby=True,
        call_started=call_started,
        incoming=None,
        turn=None,
        target="bot_1" if call_started else None,
        conn=SimpleNamespace(
            device_id=mac,
            client_is_speaking=speaking,
            last_activity_time=1732678000000,
        ),
    )


class TestPodStatusApi(AioHTTPTestCase):
    async def get_application(self):
        app = web.Application()
        self.sessions = [
            _fake_session("C4:9E:7E:0B:D8:7C", standby=True),
            _fake_session("C4:9E:7E:0B:E1:14", speaking=True),
            _fake_session("C4:9E:7E:0B:99:99", closed=True),
        ]
        self.config = {
            "manager-api": {"secret": "test-server-secret"},
            "botone": {
                "url": "https://bot.example.test",
                "secret": "a" * 40,
            },
        }
        mount_status_api(app, self.sessions, self.config)
        return app

    async def test_sessions_requires_server_secret_and_reports_live_states(self):
        unauth = await self.client.get("/internal/pod/sessions")
        self.assertEqual(unauth.status, 401)

        resp = await self.client.get(
            "/internal/pod/sessions",
            headers={"Authorization": "Bearer test-server-secret"},
        )
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertTrue(data["botoneConfigured"])
        self.assertEqual(data["summary"]["connected"], 2)
        self.assertEqual(data["summary"]["standby"], 1)
        self.assertEqual(data["summary"]["active"], 1)
        self.assertEqual(data["sessions"]["c4:9e:7e:0b:d8:7c"]["state"], "standby")
        self.assertEqual(data["sessions"]["c4:9e:7e:0b:e1:14"]["state"], "speaking")
        self.assertNotIn("c4:9e:7e:0b:99:99", data["sessions"])

    async def test_botone_status_forwards_read_only_check(self):
        fake_client = SimpleNamespace(
            request=AsyncMock(return_value={
                "accountReady": True,
                "boboReady": True,
                "boboBotId": "bot_bobo",
                "authStatus": "ready",
                "modelReady": True,
            }),
            close=AsyncMock(),
        )
        with patch("core.providers.llm.botone.status_api.BotoneClient", return_value=fake_client):
            resp = await self.client.post(
                "/internal/pod/botone-status",
                headers={"Authorization": "Bearer test-server-secret"},
                json={"issuer": "https://id.example.test", "subject": "sub-1", "chatModel": "gpt-4.1-mini"},
            )
            self.assertEqual(resp.status, 200)
            data = await resp.json()
            self.assertTrue(data["bridgeOk"])
            self.assertEqual(data["authStatus"], "ready")
            self.assertEqual(data["boboBotId"], "bot_bobo")
            fake_client.request.assert_awaited_once_with(
                "status",
                {"issuer": "https://id.example.test", "subject": "sub-1", "chatModel": "gpt-4.1-mini"},
            )
            fake_client.close.assert_awaited_once()
