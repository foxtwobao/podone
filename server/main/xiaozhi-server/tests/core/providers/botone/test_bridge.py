import asyncio
import json
import unittest
import wave
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx
import opuslib_next

from config.config_loader import get_config_from_api_async
from core.providers.llm.botone.client import BotoneError, sse_frames, validate_config
from core.providers.llm.botone.session import ACTION_LABELS, ERROR_PROMPTS, PeripheralSession, sentences
from core.providers.llm.botone.tts import synthesize


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_sse_and_sentence_boundaries(self):
        async def lines():
            for line in ("event: heartbeat", "data: {}", "", "event: text_delta",
                         'data: {"text":', 'data: "你好。"}', ""):
                yield line

        self.assertEqual([frame async for frame in sse_frames(lines())],
                         [("heartbeat", {}), ("text_delta", {"text": "你好。"})])
        short = "你好。再见！剩余"
        self.assertEqual(list(sentences(short)), [])
        self.assertEqual(list(sentences(short, flush=True)), [(short, "")])
        first = "甲" * 50 + "。"
        self.assertEqual(list(sentences(first + "还有")), [(first, "还有")])
        self.assertEqual(list(sentences("甲" * 121)), [("甲" * 120, "甲")])

    async def test_chat_sends_emotion_from_first_streamed_sentence(self):
        credentials = {"model": "speech", "voice": "voice-1"}
        conn = SimpleNamespace(
            config={"botone": {"local_tts": credentials}},
            session_id="pod-session",
            logger=Mock(),
            websocket=SimpleNamespace(send=AsyncMock()),
        )
        session = PeripheralSession(conn)
        session.owner = {"voiceSettings": {"chatModel": "chat"}}
        session._restart_events = Mock()
        session._synthesize = AsyncMock()
        whitespace = "\n  "
        first = "😢 " + "我知道你现在心里不好受" * 5 + "。"
        second = "😊 我会陪着你。"

        async def frames(_action, _payload):
            yield "session_meta", {"runId": "run", "threadId": "thread", "cursor": 1}
            yield "text_delta", {"text": whitespace}
            yield "text_delta", {"text": first + second}
            yield "done", {"status": "run.completed"}

        session.client = SimpleNamespace(stream=frames)

        await session._chat("你能做个难过的表情吗？", {"subject": "owner"})

        conn.websocket.send.assert_awaited_once()
        self.assertEqual(json.loads(conn.websocket.send.await_args.args[0]), {
            "type": "llm", "text": "😢", "emotion": "sad", "session_id": "pod-session",
        })
        self.assertEqual([call.args for call in session._synthesize.await_args_list],
                         [(whitespace + first, credentials), (second, credentials)])

    async def test_botone_silence_default_accepts_local_override(self):
        config = {
            "botone": {"url": "https://bot.example.test"},
            "manager-api": {"url": "http://manager", "secret": "fixture"},
        }
        loader = "config.config_loader"
        with patch(f"{loader}.init_service"), patch(
            f"{loader}.get_server_config", side_effect=lambda: {"server": {"auth": {"enabled": True}}}
        ):
            defaults = await get_config_from_api_async(config)
            local = await get_config_from_api_async({
                **config, "VAD": {"SileroVAD": {"min_silence_duration_ms": 900}},
            })
        self.assertEqual(defaults["VAD"]["SileroVAD"]["min_silence_duration_ms"], 1100)
        self.assertEqual(local["VAD"]["SileroVAD"]["min_silence_duration_ms"], 900)

    async def test_rebind_stops_an_old_connection(self):
        conn = SimpleNamespace(
            config={"botone": {}}, device_id="test-device",
            headers={"client-id": "old-client"}, websocket=SimpleNamespace(close=AsyncMock()),
            clear_queues=AsyncMock(), server=None,
        )
        session = PeripheralSession(conn)
        session.owner = {"status": "bound", "bindingId": "old", "issuer": "issuer", "subject": "old-owner"}
        current = {**session.owner, "bindingId": "new", "subject": "new-owner"}
        conn.clear_queues = lambda: None
        with patch("core.providers.llm.botone.session.get_peripheral_owner", return_value=current):
            with self.assertRaisesRegex(BotoneError, "device_unbound"):
                await session._identity()
        conn.websocket.close.assert_awaited_once()

    async def test_unbound_device_without_an_activation_code_can_play_the_binding_prompt(self):
        conn = SimpleNamespace(
            config={"botone": {}}, device_id="test-device", headers={"client-id": "uuid"},
        )
        session = PeripheralSession(conn)
        with patch("core.providers.llm.botone.session.get_peripheral_owner",
                   return_value={"status": "unbound"}):
            await session.initialize()
            self.assertFalse(conn.need_bind)
            with self.assertRaisesRegex(BotoneError, "^unbound$"):
                await session._identity()

    async def test_voice_settings_change_without_rebinding(self):
        conn = SimpleNamespace(
            config={"botone": {}}, device_id="test-device",
            headers={"client-id": "uuid"}, websocket=SimpleNamespace(close=AsyncMock()),
        )
        session = PeripheralSession(conn)
        session.owner = {
            "status": "bound", "bindingId": "same", "issuer": "issuer", "subject": "owner",
            "voiceSettings": {"chatModel": "chat-first", "ttsModel": "speech-first", "ttsVoice": "voice-1"},
        }
        current = {**session.owner, "voiceSettings": {
            "chatModel": "chat-next", "ttsModel": "speech-next", "ttsVoice": "voice-2",
        }}

        async def done(*_args):
            yield "done", {"status": "run.completed"}

        stream = Mock(side_effect=done)
        session.client = SimpleNamespace(stream=stream)
        await session._chat("你好", {"subject": "owner"})
        self.assertEqual(stream.call_args.args[1]["chatModel"], "chat-first")
        with patch("core.providers.llm.botone.session.get_peripheral_owner", return_value=current):
            identity = await session._identity()
        await session._chat("再见", identity)
        self.assertEqual(stream.call_args.args[1]["chatModel"], "chat-next")

        conn.websocket.close.assert_not_awaited()
        self.assertNotIn("voiceSettings", identity)
        self.assertEqual(session._speech_settings(), {"model": "speech-next", "voice": "voice-2"})

    async def test_approval_uses_the_card_that_was_spoken(self):
        session = PeripheralSession(SimpleNamespace(config={"botone": {}}))
        session._decision = AsyncMock(return_value={"ok": True})
        session.card = {"kind": "approval", "threadId": "thread", "runId": "run", "messageId": "card"}
        identity = {"subject": "device-owner"}
        self.assertTrue(await session._card_answer("同意", "同意", identity))
        session._decision.assert_awaited_once_with(identity, {
            "action": "approve", "threadId": "thread", "runId": "run", "messageId": "card",
        })
        self.assertIsNone(session.card)

    async def test_site_approval_is_spoken_and_can_be_remembered(self):
        session = PeripheralSession(SimpleNamespace(config={"botone": {}}))
        session._speak = AsyncMock()
        session._decision = AsyncMock(return_value={"ok": True})
        identity = {"subject": "device-owner"}
        ref = {"threadId": "thread", "runId": "run", "messageId": "card"}
        await session._offer_cards(identity, [{
            **ref, "kind": "approval", "botName": "波波", "text": "想访问 example.test 上的网页",
            "offersSiteApproval": True,
        }])
        session._speak.assert_awaited_once_with(
            "波波想访问 example.test 上的网页。请说同意或拒绝。也可以说以后允许这个网站。",
            identity, None,
        )
        phrase = "以后允许这个网站"
        self.assertTrue(await session._card_answer(phrase, phrase, identity))
        session._decision.assert_awaited_once_with(identity, {"action": "always_allow_site", **ref})

    async def test_reply_plays_and_returns_to_listening_on_the_same_connection(self):
        websocket = SimpleNamespace(send=AsyncMock(), close=AsyncMock())
        conn = SimpleNamespace(
            config={"botone": {}}, websocket=websocket, session_id="device-session",
            client_is_speaking=False, logger=Mock(), tts=SimpleNamespace(tts_audio_first_sentence=True),
            calling=False, conn_from_mqtt_gateway=False, sample_rate=24000,
        )
        conn.clearSpeakStatus = lambda: setattr(conn, "client_is_speaking", False)
        session = PeripheralSession(conn)
        session._identity = AsyncMock(return_value={"subject": "owner"})
        session._command = AsyncMock(return_value=False)

        async def speech(*_args):
            yield b"first"
            yield b"last"

        async def chat(_text, _identity):
            await session._synthesize("答复。", {"model": "speech"})

        session._chat = chat
        with patch("core.providers.llm.botone.session.synthesize", side_effect=speech):
            for prompt in ("现在几点了", "今天星期几"):
                websocket.send.reset_mock()
                await session.submit(prompt)
                await session.turn
                sent = [call.args[0] for call in websocket.send.await_args_list]
                self.assertEqual([
                    item if isinstance(item, bytes) else json.loads(item).get("state", "stt")
                    for item in sent
                ], ["stt", "start", "sentence_start", b"first", b"last", "stop"])
                self.assertFalse(conn.client_is_speaking)
        websocket.close.assert_not_awaited()

    async def test_singing_plays_a_local_track(self):
        with TemporaryDirectory() as library:
            track = Path(library) / "中秋月.mp3"
            track.touch()
            conn = SimpleNamespace(config={
                "botone": {}, "plugins": {"play_music": {"music_dir": library}},
            })
            session = PeripheralSession(conn)
            session._clip = AsyncMock()
            with patch("plugins_func.functions.play_music.MUSIC_CACHE", {}):
                session.conn.websocket = SimpleNamespace(send=AsyncMock())
                session.conn.clear_queues = Mock()
                session.conn.client_is_speaking = False
                for args, status in (({}, "playing"), ({"song": "中秋月"}, "playing"),
                                     ({"song": "没有收录的歌"}, "not_found")):
                    session._release_hardware()
                    session.hardware_turn = "voice"
                    # The connector invokes the device action on its own task.
                    result = await asyncio.create_task(session.play_voice_tool("voice", "pod_play_music", args))
                    await session.turn
                    self.assertEqual(result["status"], status)
                    if status == "playing":
                        session._clip.assert_awaited_once_with("中秋月", str(track))
                    else:
                        session._clip.assert_awaited_once_with(
                            "曲库里暂无匹配的歌曲。", "config/assets/botone/music_unavailable.wav",
                        )
                    session._clip.reset_mock()

    async def test_standby_plays_farewell_and_closes_the_device_connection(self):
        events = []

        async def send(message):
            if isinstance(message, bytes):
                events.append("audio")
            else:
                frame = json.loads(message)
                events.append(frame.get("after", frame.get("state", "stt")))

        async def close():
            events.append("close")

        conn = SimpleNamespace(
            config={"botone": {}}, websocket=SimpleNamespace(send=send, close=close),
            session_id="device-session", client_is_speaking=False, logger=Mock(),
            tts=SimpleNamespace(tts_audio_first_sentence=True), calling=False,
            conn_from_mqtt_gateway=False, sample_rate=24000,
        )
        conn.clearSpeakStatus = lambda: setattr(conn, "client_is_speaking", False)
        session = PeripheralSession(conn)
        session._identity = AsyncMock()
        session._chat = AsyncMock()
        with patch("core.providers.llm.botone.session.audio_to_data", return_value=[b"frame"]):
            await session._run_turn("好，退下吧。")
        self.assertEqual(events, ["stt", "start", "sentence_start", "audio", "stop", "close"])
        events.clear()
        conn.features = {"online_standby": True}
        with patch("core.providers.llm.botone.session.audio_to_data", return_value=[b"frame"]):
            await session._run_turn("退下吧")
        self.assertEqual(events, ["stt", "start", "sentence_start", "audio", "standby"])
        session._identity.assert_not_awaited()
        session._chat.assert_not_awaited()

    async def test_general_requests_go_to_the_same_bot(self):
        conn = SimpleNamespace(config={"botone": {}}, client_is_speaking=False,
                               websocket=SimpleNamespace(send=AsyncMock()), logger=Mock())
        session = PeripheralSession(conn)
        session._identity = AsyncMock(return_value={"subject": "owner"})
        session._chat = AsyncMock()
        with patch("core.providers.llm.botone.session.send_stt_message", new_callable=AsyncMock):
            for text in ("明天上海下雨吗", "一周国际新闻", "运行我刚加的技能", "有点安静，来首歌呗",
                         "播放中秋月", "是吧来退下吧。", "别退下", "播放音乐是什么意思"):
                await session._run_turn(text)
                session._chat.assert_awaited_with(text, {"subject": "owner"})

    async def test_disconnected_turn_does_not_retry_playback(self):
        from websockets.protocol import State
        conn = SimpleNamespace(config={"botone": {}}, client_is_speaking=False, logger=Mock(),
                               websocket=SimpleNamespace(send=AsyncMock(), state=State.CLOSED))
        session = PeripheralSession(conn)
        session._error_prompt = AsyncMock()
        session._finish_audio = AsyncMock()
        with patch("core.providers.llm.botone.session.send_stt_message", side_effect=BrokenPipeError):
            await session._run_turn("几点了")
        session._error_prompt.assert_not_awaited()
        session._finish_audio.assert_not_awaited()

    async def test_passive_connection_is_idle_before_call_subscription(self):
        from core.handle.helloHandle import handleHelloMessage
        for state in ("standby", None):
            conn = SimpleNamespace(config={"botone": {}}, logger=Mock(), welcome_msg={"type": "hello"},
                                   websocket=SimpleNamespace(send=AsyncMock()))
            session = conn.peripheral = PeripheralSession(conn)
            idle = []
            session.listen_for_events = lambda: idle.append(session.standby)
            await handleHelloMessage(conn, {"type": "hello", "features": {"online_standby": True},
                                            "state": state})
            self.assertEqual(idle, [state == "standby"])

    async def test_online_standby_ring_decline_timeout_and_accept(self):
        conn = SimpleNamespace(config={"botone": {}}, session_id="pod", server=None,
                               websocket=SimpleNamespace(send=AsyncMock(), close=AsyncMock()),
                               features={"online_standby": True}, client_is_speaking=False,
                               last_activity_time=1)
        session = PeripheralSession(conn)
        identity = {"issuer": "issuer", "subject": "owner"}
        session.owner = identity
        session._identity = AsyncMock(return_value=identity)
        session._preferred_device = Mock(return_value=True)
        session._speak = AsyncMock()
        session._decision = AsyncMock(return_value={"opening": "你好"})
        async def play(*args):
            conn.client_is_speaking = True
        session._clip = play
        states = []
        async def stop(conn, state, *, after):
            states.append(after)
            conn.client_is_speaking = False
        with patch("core.providers.llm.botone.session.send_tts_message", side_effect=stop):
            await session.check_idle()
            self.assertTrue(session.standby)
            self.assertIn('{"type":"standby"}', [call.args[0] for call in conn.websocket.send.await_args_list])
            call = {"callId": "first", "botId": "bot", "botName": "波波", "expiresAt": "2020-01-01T00:00:00Z"}
            await session._notice("calls", {"calls": [call]})
            self.assertEqual(states[-1], "listen")
            await session.check_idle()
            self.assertIsNone(session.incoming)
            self.assertFalse(session.ring_from_standby)
            await session._notice("calls", {"calls": [{**call, "callId": "second"}]})
            await session._command("拒接", identity)
            await session._finish_audio()
            self.assertTrue(session.standby)
            await session._notice("calls", {"calls": [{**call, "callId": "third"}]})
            await session._command("接听", identity)
            self.assertFalse(session.standby)
            self.assertEqual(session.call_id, "third")
            conn.websocket.close.assert_not_awaited()

    async def test_cached_greeting_tracks_voice_and_has_no_key(self):
        settings = {"model": "test", "voice": "a", "baseUrl": "http://localhost", "apiKey": "key"}
        conn = SimpleNamespace(config={"botone": {"local_tts": settings}}, sample_rate=24000, sentence_id="turn")
        session = PeripheralSession(conn)
        session._begin_playback = AsyncMock()
        async def speech(credentials, text, rate):
            yield credentials["voice"].encode()
        with patch("core.providers.llm.botone.session.sendAudioMessage", new_callable=AsyncMock) as send, patch(
            "core.providers.llm.botone.session.synthesize", side_effect=speech,
        ) as synth:
            await session._wake_greeting({})
            await session._wake_greeting({})
            settings["voice"] = "b"
            await session._wake_greeting({})
            self.assertEqual(synth.call_count, 2)
            self.assertEqual([c.args[2] for c in send.await_args_list], [[b"a"], [b"a"], [b"b"]])
            self.assertNotIn("key", session.wake_audio[0])

    async def test_speech_uses_the_gateway_format_and_returns_60ms_opus(self):
        path = Path("config/assets/botone/quota_exhausted.wav")

        def speech(request):
            self.assertEqual(request.url.path, "/v1/audio/speech")
            self.assertEqual(json.loads(request.content), {
                "model": "speech-test", "voice": "voice-test", "input": "测试", "speed": 1,
            })
            return httpx.Response(200, content=path.read_bytes())

        client = httpx.AsyncClient(transport=httpx.MockTransport(speech))
        settings = {"baseUrl": "https://models.example.test/v1", "model": "speech-test", "voice": "voice-test"}
        with patch("core.providers.llm.botone.tts.httpx.AsyncClient", return_value=client):
            packets = [packet async for packet in synthesize(settings, "测试", 24000)]
        self.assertGreater(len(packets), 1)
        decoder = opuslib_next.Decoder(24000, 1)
        self.assertEqual(len(decoder.decode(packets[0], 1440)), 2880)

    async def test_abort_cancels_the_current_playback_and_leaves_connection_live(self):
        session = PeripheralSession(SimpleNamespace(config={"botone": {}}))
        started = asyncio.Event()

        async def playback():
            started.set()
            await asyncio.Event().wait()

        session.turn = asyncio.create_task(playback())
        await started.wait()
        session.interrupt()
        with self.assertRaises(asyncio.CancelledError):
            await session.turn
        self.assertFalse(session.closed)

    def test_offline_prompts_are_local_wav_assets(self):
        for code in ERROR_PROMPTS.keys() | ACTION_LABELS.keys() | {"standby", "music_unavailable"}:
            with wave.open(f"config/assets/botone/{code}.wav") as speech:
                self.assertEqual(speech.getframerate(), 16000)
                self.assertGreater(speech.getnframes(), 0)

    def test_credentials_require_a_trusted_destination(self):
        with self.assertRaises(ValueError):
            validate_config({"url": "http://another-host.example.test", "secret": "x" * 32})
        validate_config({"url": "https://bot.example.test", "secret": "x" * 32})

    async def test_offer_cards_focuses_current_run_and_choices_do_not_leak_to_chat(self):
        session = PeripheralSession(SimpleNamespace(config={"botone": {}}))
        session._speak = AsyncMock()
        identity = {"subject": "device-owner"}
        cards = [
            {"runId": "run-old", "threadId": "t1", "messageId": "m1", "botName": "Chief", "kind": "approval", "text": "旧审批"},
            {"runId": "run-now", "threadId": "t2", "messageId": "m2", "botName": "波波", "kind": "approval", "text": "调音量"},
        ]
        await session._offer_cards(identity, cards, run_id="run-now")
        self.assertEqual(session.card["runId"], "run-now")
        self.assertEqual(session.choices, [])

        # Duplicate botName and bulk-approval phrases must be handled as commands, never sent to chat.
        session.card = None
        session.choices = [
            {"runId": "r1", "threadId": "t2", "messageId": "m1", "botName": "波波", "kind": "approval", "text": "一"},
            {"runId": "r2", "threadId": "t2", "messageId": "m2", "botName": "波波", "kind": "approval", "text": "二"},
        ]
        self.assertTrue(await session._command("波波。", identity))
        self.assertTrue(await session._command("全部同意。", identity))

    async def test_action_clip_uses_device_voice_with_cache_and_wav_fallback(self):
        settings = {"model": "test-tts", "voice": "v-custom", "baseUrl": "http://localhost"}
        conn = SimpleNamespace(config={"botone": {"local_tts": settings}}, sample_rate=24000, sentence_id="turn")
        session = PeripheralSession(conn)
        session._begin_playback = AsyncMock()

        async def speech(credentials, text, rate):
            yield f"{credentials['voice']}:{text}".encode()

        with patch("core.providers.llm.botone.session._PROMPT_AUDIO_CACHE", {}), patch(
            "core.providers.llm.botone.session.sendAudioMessage", new_callable=AsyncMock
        ) as send, patch("core.providers.llm.botone.session.synthesize", side_effect=speech) as synth:
            await session._clip("已批准。", "config/assets/botone/approve.wav")
            await session._clip("已批准。", "config/assets/botone/approve.wav")
            self.assertEqual(synth.call_count, 1)
            self.assertEqual(send.await_args_list[0].args[2], [b"v-custom:\xe5\xb7\xb2\xe6\x89\xb9\xe5\x87\x86\xe3\x80\x82"])
