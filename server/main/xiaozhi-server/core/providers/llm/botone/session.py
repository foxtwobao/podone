"""A Pod's voice turn, pending card and Botone event subscription."""
import asyncio
import hashlib
import json
import re
import time
import uuid
from collections import deque
from contextlib import aclosing
from datetime import datetime
from websockets.exceptions import ConnectionClosed
from websockets.protocol import State

import httpx

from config.manage_api_client import get_peripheral_owner
from core.handle.abortHandle import handleAbortMessage
from core.handle.sendAudioHandle import (
    sendAudioMessage,
    send_display_message,
    send_stt_message,
    send_tts_message,
)
from core.providers.tts.dto.dto import SentenceType
from core.utils import p3, textUtils
from core.utils.util import audio_to_data
from plugins_func.functions.play_music import select_local_music

from .client import BotoneClient, BotoneError
from .tts import synthesize


ERROR_PROMPTS = {
    "account_required": "请先用同一个账号登录 Botone。",
    "authorization_required": "请到 Botone 完成模型授权。",
    "model_connection_required": "请检查模型配置和个人模型连接。",
    "quota_exhausted": "模型账户的额度用完了。",
    "device_enrollment_required": "请在设备管理中解绑后，通过设备重新绑定。",
    "unbound": "设备尚未绑定，请重启设备，按屏幕提示完成绑定。",
    "voice_model_configuration_required": "请在 Podone 智控台配置对话模型。",
    "tts_configuration_required": "请在管理页面配置语音合成模型和音色。",
    "decision_conflict": "这项操作已处理或已过期。",
    "invalid_answer": "回答的内容有误，请再说一次。",
    "unavailable": "服务暂时不可用，请稍后再试。",
}
ACTION_LABELS = {
    "approve": "已批准。", "deny": "已拒绝。", "answer": "已回答。",
    "resume": "已交回电脑。", "skip": "已跳过。", "stop": "已停止任务。",
    "decline_question": "已拒绝回答。", "decline_call": "已拒接。",
    "always_allow_site": "以后会允许访问这个网站。",
}
BREAK_AT = re.compile(r"[。！？!?；;\n]|(?<=\.)\s")
STANDBY_COMMAND = re.compile(
    r"(?:好)?(?:请你?|你)?(?:退下|睡一下|休息一下|结束对话|再见)(?:吧|了)?"
)
_WAKE_AUDIO_CACHE = {}
_WAKE_AUDIO_CACHE_MAX = 32
_PROMPT_AUDIO_CACHE = {}
_PROMPT_AUDIO_CACHE_MAX = 128


def sentences(buffer, flush=False):
    """Keep short replies together and bound the length of each synthesis request."""
    while buffer:
        if flush and len(buffer) <= 120:
            yield buffer, ""
            return
        edge = BREAK_AT.search(buffer, 44, 120)
        if not edge and len(buffer) < 120:
            return
        cut = edge.end() if edge else 120
        yield buffer[:cut], buffer[cut:]
        buffer = buffer[cut:]


class PeripheralSession:
    def __init__(self, conn):
        self.conn = conn
        self.config = conn.config["botone"]
        self.client = None
        self.owner = None
        self.hello = False
        self.closed = False
        self.turn = None
        self.event_task = None
        self.notice_task = None
        self.activity = 0
        self.target = None
        self.call_id = None
        self.call_started = None
        self.incoming = None
        self.card = None
        self.choices = []
        self.cursors = {}
        self.standby = False
        self.ring_from_standby = False
        self.keepalive_at = 0
        self.wake_audio = None
        self.hardware_turn = None
        self.hardware_run = None
        self.hardware_ready = asyncio.Event()
        self.hardware_calls = {}
        self.audio_tool_turn = None
        self.targets = set()
        self.groups = set()
        self.seen = deque(maxlen=128)
        self.notices = asyncio.Queue(maxsize=16)

    @property
    def bridge(self):
        if self.client is None:
            self.client = BotoneClient(self.config)
        return self.client

    async def initialize(self):
        try:
            owner = await get_peripheral_owner(self.conn.device_id, self.conn.headers.get("client-id", ""))
        except Exception:
            # The next utterance rechecks ownership and can give a local availability prompt.
            return
        if not owner or self.closed:
            return
        if owner["status"] == "unbound":
            self.conn.bind_code = owner.get("bindCode")
            self.conn.need_bind = bool(self.conn.bind_code)
        elif owner["status"] == "bound":
            self.owner = owner
            self._register()
            if self.hello:
                self._restart_events()

    def _register(self):
        if self.conn.server is not None:
            self.conn.server.peripheral_sessions.add(self)

    async def _identity(self):
        try:
            current = await get_peripheral_owner(self.conn.device_id, self.conn.headers.get("client-id", ""))
        except Exception as exc:
            raise BotoneError("unavailable") from exc
        binding_fields = ("status", "bindingId", "issuer", "subject")
        if self.owner and any(
            self.owner.get(field) != (current or {}).get(field) for field in binding_fields
        ):
            self.conn.clear_queues()
            await self.conn.websocket.close()
            raise BotoneError("device_unbound")
        status = current.get("status") if current else None
        if status != "bound":
            raise BotoneError(status if status in ERROR_PROMPTS else "unavailable")
        first_lookup = self.owner is None
        self.owner = current
        if first_lookup:
            self._register()
            if self.hello:
                self._restart_events()
        return {
            "issuer": current["issuer"], "subject": current["subject"],
            "deviceId": self.conn.device_id, "deviceKey": self._device_key(),
        }

    def _device_key(self):
        return hashlib.sha256(
            f"{self.conn.device_id}\0{self.owner['bindingId']}".encode()
        ).hexdigest()

    def _preferred_device(self, same_device=False, origin=None):
        sessions = getattr(self.conn.server, "peripheral_sessions", {self})
        candidates = [
            session for session in sessions
            if not session.closed and session.hello and session.owner
            and (session.owner["issuer"], session.owner["subject"]) ==
                (self.owner["issuer"], self.owner["subject"])
            and (not same_device or session.conn.device_id == self.conn.device_id)
        ]
        if origin:
            candidates = [session for session in candidates if session._device_key() == origin] or candidates
        return not candidates or max(candidates, key=lambda s: (s.activity, s.conn.session_id)) is self

    def listen_for_events(self):
        self.hello = True
        if self.owner and not self.event_task:
            self._restart_events()

    def _restart_events(self):
        if self.closed:
            return
        if self.event_task and self.event_task is not asyncio.current_task():
            self.event_task.cancel()
        self.event_task = asyncio.create_task(self._events())
        if self.notice_task is None:
            self.notice_task = asyncio.create_task(self._play_notices())

    def interrupt(self):
        if self.turn and self.turn is not asyncio.current_task():
            self.turn.cancel()

    async def submit(self, text):
        # SenseVoice may wrap recognized text in a speaker envelope.
        if text.startswith("{"):
            try:
                text = json.loads(text).get("content", text)
            except (ValueError, AttributeError):
                pass
        if not isinstance(text, str) or not text.strip():
            return
        if (self.turn and not self.turn.done()) or self.conn.client_is_speaking:
            await handleAbortMessage(self.conn)
        if self.audio_tool_turn is not None:
            self._release_hardware()
        self.activity = time.monotonic()
        self.turn = self._start_task(self._run_turn(text.strip()))

    def _start_task(self, coroutine):
        task = asyncio.create_task(coroutine)
        task.add_done_callback(self._task_finished)
        return task

    def _task_finished(self, task):
        if task.cancelled():
            return
        error = task.exception()
        if error and not isinstance(error, (ConnectionClosed, ConnectionError)):
            self.conn.logger.bind(tag=__name__).error("Peripheral audio task failed ({})", type(error).__name__)

    def _release_hardware(self):
        self.hardware_turn = self.hardware_run = self.audio_tool_turn = None
        self.hardware_ready.set()
        for task in self.hardware_calls.values():
            if not task.done():
                task.cancel()
        self.hardware_calls.clear()

    @property
    def connected(self):
        return not self.closed and getattr(self.conn.websocket, "state", State.OPEN) == State.OPEN

    @property
    def online_standby(self):
        return bool((getattr(self.conn, "features", None) or {}).get("online_standby"))

    async def _finish_audio(self):
        after = "standby" if self.standby and not self.ring_from_standby else "listen"
        if self.conn.client_is_speaking:
            await send_tts_message(self.conn, "stop", after=after if self.online_standby else None)
        elif self.standby and self.online_standby and not self.ring_from_standby:
            await self.conn.websocket.send('{"type":"standby"}')
        if self.standby and not self.online_standby:
            await self.conn.websocket.close()

    async def check_idle(self):
        now = time.time()
        if self.online_standby and now - self.keepalive_at >= 45:
            await self.conn.websocket.send('{"type":"keepalive"}')
            self.keepalive_at = now
        if self.turn and not self.turn.done():
            return
        if self.incoming:
            expiry = datetime.fromisoformat(self.incoming["expiresAt"].replace("Z", "+00:00"))
            if now >= expiry.timestamp():
                self.incoming = None
                self.ring_from_standby = False
                if self.standby:
                    await self._finish_audio()
        if self.standby or self.incoming or self.conn.client_is_speaking:
            return
        idle_seconds = self.conn.config.get("close_connection_no_voice_time", 120)
        if self.conn.last_activity_time and now - self.conn.last_activity_time / 1000 >= int(idle_seconds):
            self._release_hardware()
            self.standby = True
            if self.call_started:
                try:
                    await self._end_call(await self._identity())
                except BotoneError as error:
                    self.conn.logger.bind(tag=__name__).warning("Idle call could not be closed ({})", error.code)
                    self.target, self.call_id, self.call_started = None, None, None
            if self.connected:
                await self._finish_audio()

    async def close(self):
        if self.closed:
            return
        self.closed = True
        hardware_tasks = list(self.hardware_calls.values())
        self._release_hardware()
        self.conn.clear_queues()
        getattr(self.conn.server, "peripheral_sessions", set()).discard(self)
        tasks = [task for task in (self.turn, self.event_task, self.notice_task)
                 if task and task is not asyncio.current_task()]
        tasks.extend(hardware_tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self.client:
            await self.client.close()

    async def _run_turn(self, text):
        self._start_audio()
        clean = self._normalized(text)
        standby = (
            clean in self.conn.config.get("exit_commands", [])
            or STANDBY_COMMAND.fullmatch(clean) is not None
        )
        online = True
        cancelled = False
        try:
            await send_stt_message(self.conn, text, start_tts=False)
            if standby:
                self._release_hardware()
                await self._standby_farewell()
                return
            if clean in self.conn.config.get("wakeup_words", []):
                self.standby = self.ring_from_standby = False
                await self._wake_greeting(await self._identity())
                return
            identity = await self._identity()
            if not self.ring_from_standby:
                self.standby = False
            if not await self._command(text, identity):
                await self._chat(text, identity)
        except asyncio.CancelledError:
            cancelled = True
            raise
        except (ConnectionClosed, BrokenPipeError, ConnectionResetError):
            online = False
        except BotoneError as error:
            online = error.code != "device_unbound"
            if online and self.connected:
                await self._error_prompt(error.code)
        except Exception as error:
            self.conn.logger.bind(tag=__name__).warning(
                "Botone turn failed ({})", type(error).__name__)
            if self.connected:
                await self._error_prompt("unavailable")
        finally:
            if online and not cancelled and self.connected:
                await self._finish_audio()

    def _start_audio(self):
        self.conn.sentence_id = uuid.uuid4().hex
        self.conn.client_abort = False

    async def _begin_playback(self):
        if not self.conn.client_is_speaking:
            self.conn.client_is_speaking = True
            await send_tts_message(self.conn, "start")
            # The device switches to speaking in its main loop (including LVGL status update
            # and audio_service_.ResetDecoder()) before it can safely buffer incoming Opus frames.
            await asyncio.sleep(0.18)

    @staticmethod
    def _normalized(text):
        return re.sub(r"[\s，。！？、,.!?：:]", "", text).casefold()

    async def _standby_farewell(self):
        self.incoming = None
        self.standby = True
        self.ring_from_standby = False
        if self.target and self.call_id and self.call_started:
            await self._end_call(await self._identity())
        await self._clip("好，我先退下。", "config/assets/botone/standby.wav")

    async def play_voice_tool(self, turn_id, name, args):
        if self.hardware_turn != turn_id or self.audio_tool_turn is not None or not self.connected:
            raise RuntimeError("Pod voice turn unavailable")
        # This action owns the speaker through the end of playback, including after
        # an approval resumes a run whose original response stream has closed.
        self.audio_tool_turn = turn_id
        previous = self.turn
        self.turn = asyncio.current_task()
        if previous and not previous.done():
            previous.cancel()
            await asyncio.gather(previous, return_exceptions=True)
        self.conn.clear_queues()
        self._start_audio()
        cancelled = False
        try:
            if name == "pod_end_conversation":
                await self._standby_farewell()
                return {"status": "ending"}
            track = select_local_music(self.conn, args.get("song"))
            if track is None:
                await self._clip("曲库里暂无匹配的歌曲。", "config/assets/botone/music_unavailable.wav")
                return {"status": "not_found"}
            await self._clip(track.stem, str(track))
            return {"status": "playing", "song": track.stem}
        except asyncio.CancelledError:
            cancelled = True
            raise
        finally:
            # A long track drains at device speed after the worker gets its receipt.
            if self.turn is asyncio.current_task() and self.connected and not cancelled:
                self.turn = self._start_task(self._finish_audio())

    async def _command(self, text, identity):
        clean = self._normalized(text)
        if clean in {"退出连线", "切回波波", "挂断", "挂电话", "结束通话"}:
            await self._end_call(identity)
            await self._speak("已切回波波。", identity)
            return True
        if clean in {"接听", "接电话", "拒接"} and self.incoming:
            call = self.incoming
            self.incoming = None
            self.ring_from_standby = False
            result = await self._decision(identity, {
                "action": "decline_call" if clean == "拒接" else "accept_call",
                "botId": call["botId"], "callId": call["callId"],
            })
            if result and clean != "拒接":
                self.standby = False
                self.target = {"id": call["botId"], "name": call["botName"]}
                self.call_id = call["callId"]
                self.call_started = time.monotonic()
                await self._speak(result.get("opening") or "已接通。", identity)
            return True
        group_command = re.fullmatch(r"(?:发给|让)\s*(.+?)(?:群聊|群)[，,：:\s]*(.+)", text)
        if group_command:
            fleet = await self.bridge.request("fleet", identity)
            name = self._normalized(group_command[1])
            matches = [group for group in fleet["groups"] if self._normalized(group["name"]).removesuffix("群聊").removesuffix("群") == name]
            if len(matches) == 1:
                await self._chat(group_command[2].strip(), identity, matches[0])
            else:
                await self._speak("找不到唯一匹配的群聊，请说出群聊全名。", identity)
            return True
        if clean.startswith("连线") and len(clean) > 2:
            fleet = await self.bridge.request("fleet", identity)
            name = clean[2:]
            bots = [bot for bot in fleet["bots"] if self._normalized(bot["name"]) == name]
            if len(bots) == 1:
                self.target = bots[0]
                self.call_id = uuid.uuid4().hex
                self.call_started = time.monotonic()
                await self._speak(f"已连线{bots[0]['name']}。", identity)
            else:
                await self._speak("找不到唯一匹配的机器人，请说出它的全名。", identity)
            return True
        if clean in {"看审批", "查审批", "待审批", "有什么待审批", "有什么要我处理的", "看看待处理", "待处理"}:
            await self._offer_cards(identity)
            return True
        if self.choices:
            choice = re.fullmatch(r"(?:选|选择)?第([一二三四五]|\d{1,2})(?:个|项|张)?", clean)
            index = "一二三四五".find(choice[1]) if choice else -1
            if choice and choice[1].isdigit():
                index = int(choice[1]) - 1
            selected = self.choices[index:index + 1] if index >= 0 else [
                card for card in self.choices
                if clean in {self._normalized(card["botName"]), self._normalized("选" + card["botName"])}
            ]
            if len(selected) == 1:
                await self._offer_cards(identity, selected)
                return True
            if len(selected) > 1:
                await self._speak(f"{selected[0]['botName']}有多项待处理，请说第几项。", identity)
                return True
            if clean in {"同意", "批准", "允许", "确认", "拒绝", "继续", "全部同意", "全部批准", "都同意", "全部拒绝"}:
                await self._speak("请先说要处理第几项。", identity)
                return True
        if self.card and await self._card_answer(text, clean, identity):
            return True
        stop = re.fullmatch(r"(?:请)?(?:急停|停止|停一下|终止)(.+?)(?:的)?(?:任务|运行)?", clean)
        if clean in {"急停", "停一下", "停止任务"} or stop:
            fleet = await self.bridge.request("fleet", identity)
            if clean in {"急停", "停一下", "停止任务"}:
                candidates = {run["threadId"] for run in fleet["runs"]}
            else:
                name = stop[1].removesuffix("机器人")
                candidates = {entry["threadId"] for entry in fleet["bots"] + fleet["groups"]
                              if self._normalized(entry["name"]).removesuffix("机器人") == name
                              and entry.get("threadId")}
            if len(candidates) != 1:
                await self._speak("请说要停止哪个机器人或群聊的任务。", identity)
            else:
                await self._decision(identity, {"action": "stop", "threadId": next(iter(candidates))})
            return True
        return False

    async def _end_call(self, identity):
        if self.target and self.call_id and self.call_started:
            await self._decision(identity, {
                "action": "end_call", "botId": self.target["id"], "callId": self.call_id,
                "durationSeconds": min(86400, int(time.monotonic() - self.call_started)),
            })
        self.target, self.call_id, self.call_started = None, None, None

    async def _offer_cards(self, identity, cards=None, quiet=False, credentials=None, run_id=None):
        if cards is None:
            cards = (await self.bridge.request("fleet", identity))["cards"]
        if run_id:
            matching = [card for card in cards if card.get("runId") == run_id]
            if matching:
                cards = matching[:1]
        if quiet and self.card and any(
            card["runId"] == self.card["runId"] and card.get("messageId") == self.card.get("messageId")
            for card in cards
        ):
            return
        self.card = None
        self.choices = cards if len(cards) > 1 else []
        if not cards:
            if not quiet:
                await self._speak("目前没有待处理项。", identity, credentials)
            return
        if self.choices:
            options = "，".join(f"第{i}项是{card['botName']}" for i, card in enumerate(self.choices[:5], 1))
            await self._speak(f"有多项待处理。{options}。请说要处理第几项或机器人名。", identity, credentials)
            return
        card = cards[0]
        kind = card["kind"]
        if kind == "approval":
            text = f"{card['botName']}{card['text']}。请说同意或拒绝。"
            if card.get("offersSiteApproval"):
                text += "也可以说以后允许这个网站。"
        else:
            text = f"{card['botName']}：{card['text']}"
        if kind == "tool_question":
            text += "。" + "，".join(
                field["label"] + ("可选" + "、".join(option["label"] for option in field["options"])
                                  if field.get("options") else "")
                for field in card.get("fields", [])
            )
            text += "。请说回答加上内容。"
        elif kind == "question" and card.get("actions"):
            text += "。" + "，".join(item["label"] for item in card["actions"])
        await self._speak(text, identity, credentials)
        self.card = card

    async def _card_answer(self, text, clean, identity):
        card = self.card
        action, extra = None, {}
        if card["kind"] == "approval":
            if card.get("offersSiteApproval") and clean in {
                "以后允许这个网站", "以后都允许这个网站", "始终允许这个网站",
            }:
                action = "always_allow_site"
            elif clean in {"同意", "批准", "允许", "同意刚才的操作", "确认", "好同意", "好的同意", "行同意"}:
                action = "approve"
            elif clean in {"拒绝", "不同意", "不批准", "拒绝刚才的操作"}:
                action = "deny"
        elif card["kind"] == "takeover":
            if clean in {"继续", "完成", "已完成", "我输完验证码了继续吧"}:
                action = "resume"
            elif clean in {"跳过", "取消接管"}:
                action = "skip"
        elif card["kind"] in {"question", "tool_question"}:
            answer = re.sub(r"^回答[：:，,\s]*", "", text).strip()
            if card["kind"] == "question" and answer:
                choices = [item["id"] for item in card.get("actions", [])
                           if self._normalized(item["label"]) == clean]
                action, extra = "answer", {"answer": choices[0] if len(choices) == 1 else answer}
            elif clean in {"拒绝", "不回答"}:
                action = "decline_question"
            elif text.startswith("回答"):
                fields = card.get("fields", [])
                values = {}
                if len(fields) == 1:
                    value = self._field_value(fields[0], answer)
                    if value is not None:
                        values[fields[0]["id"]] = value
                else:
                    parts = re.split(r"[，,；;]", answer)
                    for field in fields:
                        for part in parts:
                            label, separator, value = part.strip().partition("：")
                            if not separator:
                                label, separator, value = part.strip().partition(":")
                            if separator and label.strip() == field["label"]:
                                converted = self._field_value(field, value.strip())
                                if converted is not None:
                                    values[field["id"]] = converted
                action, extra = "answer", {"values": values}
        if not action:
            return False
        reference = {key: card[key] for key in ("threadId", "runId", "messageId") if key in card}
        if await self._decision(identity, {"action": action, **reference, **extra}):
            self.card = None
        return True

    @staticmethod
    def _field_value(field, value):
        if field["type"] == "boolean":
            if value in {"是", "对", "同意", "true"}:
                return True
            if value in {"否", "不", "不同意", "false"}:
                return False
            return None
        if field["type"] == "number":
            try:
                number = float(value)
                return number if float("-inf") < number < float("inf") else None
            except ValueError:
                return None
        if field["type"] == "choice":
            return next((option["value"] for option in field["options"]
                         if value in {option["label"], option["value"]}), None)
        return value

    async def _decision(self, identity, body):
        # Re-read the binding at the point where a previously spoken card becomes a write.
        identity = await self._identity()
        try:
            result = await self.bridge.request("decisions", {**identity, **body})
        except BotoneError as error:
            if error.code not in {"decision_conflict", "invalid_answer"}:
                raise
            if error.code == "decision_conflict":
                self.card = None
            await self._error_prompt(error.code)
            return None
        if body["action"] in ACTION_LABELS:
            action = body["action"]
            await self._clip(ACTION_LABELS[action], f"config/assets/botone/{action}.wav")
        return result

    def _speech_settings(self):
        local = self.config.get("local_tts")
        if local:
            return local
        voice = self.owner.get("voiceSettings", {})
        model, voice_id = voice.get("ttsModel"), voice.get("ttsVoice")
        if not model or not voice_id:
            raise BotoneError("tts_configuration_required")
        return {"model": model, "voice": voice_id}

    async def _chat(self, text, identity, group=None):
        payload = {**identity, "text": text, "turnId": uuid.uuid4().hex}
        if group:
            payload["targetGroupId"] = group["id"]
        elif self.target:
            payload.update(targetBotId=self.target["id"], callId=self.call_id)
        else:
            model = self.owner.get("voiceSettings", {}).get("chatModel")
            if not model:
                raise BotoneError("voice_model_configuration_required")
            payload["chatModel"] = model
        self._release_hardware()
        self.hardware_turn = None if group else payload["turnId"]
        self.hardware_ready = asyncio.Event()
        speech = self._speech_settings()
        to_speak = asyncio.Queue(maxsize=8)
        state = {"started": False, "waiting": False, "tts": None}

        async def read():
            credentials, buffer = None, ""
            for attempt in range(2):
                try:
                    frames = self.bridge.stream("chat", payload)
                    async with aclosing(frames):
                        async for event, data in frames:
                            if event == "error":
                                raise BotoneError(data.get("error", "unavailable"))
                            if event == "session_meta":
                                state["started"] = True
                                self.hardware_run = data.get("runId")
                                self.hardware_ready.set()
                                credentials = self.config.get("local_tts")
                                if not credentials and data.get("tts"):
                                    credentials = {**data["tts"], **speech}
                                state["tts"] = credentials
                                thread_id = data["threadId"]
                                if thread_id not in self.cursors:
                                    self.cursors[thread_id] = data["cursor"]
                                    if group:
                                        self.groups.add(group["id"])
                                    elif self.target:
                                        self.targets.add(self.target["id"])
                                    self._restart_events()
                            elif event == "text_delta":
                                buffer += data["text"]
                                for sentence, buffer in sentences(buffer):
                                    await to_speak.put((sentence, credentials))
                            elif event == "tool_activity":
                                await textUtils.get_emotion(self.conn, "🤔")
                                await send_display_message(self.conn, "% " + data["label"])
                            elif event == "call_ended" and data["callId"] == self.call_id:
                                self.target, self.call_id, self.call_started = None, None, None
                                buffer += data.get("farewell", "")
                            elif event == "done":
                                if group and data["status"] == "queued":
                                    buffer += f"已派给{group['name']}。"
                                state["waiting"] = data["status"] in {"run.waiting_input", "computer.takeover.requested"}
                                for sentence, buffer in sentences(buffer, flush=True):
                                    await to_speak.put((sentence, credentials))
                                await to_speak.put(None)
                                return
                    raise httpx.RemoteProtocolError("Botone stream ended before completion")
                except httpx.TransportError:
                    if attempt or state["started"]:
                        raise

        async def play():
            first = True
            while (item := await to_speak.get()) is not None:
                sentence, credentials = item
                if first:
                    await textUtils.get_emotion(self.conn, sentence)
                    first = False
                await self._synthesize(sentence, credentials)

        tasks = [asyncio.create_task(read()), asyncio.create_task(play())]
        try:
            await asyncio.gather(*tasks)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if (self.hardware_turn == payload["turnId"] and self.audio_tool_turn != payload["turnId"]
                    and not state["waiting"]):
                self._release_hardware()
        if state["waiting"]:
            await self._offer_cards(identity, credentials=state["tts"], run_id=self.hardware_run)

    async def _wake_greeting(self, identity):
        speech = self._speech_settings()
        key = (speech.get("baseUrl"), speech["model"], speech["voice"], self.conn.sample_rate)
        packets = None
        if self.wake_audio is not None and self.wake_audio[0] == key:
            packets = self.wake_audio[1]
        elif key in _WAKE_AUDIO_CACHE:
            packets = _WAKE_AUDIO_CACHE[key]
            self.wake_audio = (key, packets)
        if packets is None:
            credentials = self.config.get("local_tts")
            if not credentials:
                grant = await self.bridge.request("speech", identity)
                credentials = {**grant["tts"], **speech}
            async with aclosing(synthesize(credentials, "在听。", self.conn.sample_rate)) as stream:
                packets = [frame async for frame in stream]
            if not packets:
                raise BotoneError("unavailable")
            if len(_WAKE_AUDIO_CACHE) >= _WAKE_AUDIO_CACHE_MAX:
                _WAKE_AUDIO_CACHE.pop(next(iter(_WAKE_AUDIO_CACHE)))
            _WAKE_AUDIO_CACHE[key] = packets
            self.wake_audio = (key, packets)
        # Keep post-wakeup VAD suppression aligned with actual playback start when synthesis took >0.8s.
        self.conn.just_woken_up = True
        await self._begin_playback()
        await sendAudioMessage(self.conn, SentenceType.FIRST, packets, "在听。", self.conn.sentence_id)

    async def _speak(self, text, identity, credentials=None):
        if not credentials:
            speech = self._speech_settings()
            credentials = self.config.get("local_tts")
            if not credentials:
                gateway = (await self.bridge.request("speech", identity))["tts"]
                credentials = {**gateway, **speech}
        for sentence, _ in sentences(text, flush=True):
            await self._synthesize(sentence, credentials)

    async def _synthesize(self, text, credentials):
        clean = textUtils.check_emoji(text).strip()
        if not clean:
            return
        if not credentials:
            raise BotoneError("unavailable")
        # Route all frames through the existing paced WebSocket path.
        frame_type = SentenceType.FIRST
        async with aclosing(synthesize(credentials, clean, self.conn.sample_rate)) as audio:
            async for frame in audio:
                if frame_type == SentenceType.FIRST:
                    await self._begin_playback()
                await sendAudioMessage(self.conn, frame_type, [frame], clean, self.conn.sentence_id)
                frame_type = SentenceType.MIDDLE

    async def _cached_voice_packets(self, text):
        try:
            if not self.config.get("local_tts") and not (
                self.owner and self.owner.get("issuer") and self.owner.get("subject") and self.owner.get("bindingId")
            ):
                return None
            speech = self._speech_settings()
        except BotoneError:
            return None
        key = (speech.get("baseUrl"), speech["model"], speech["voice"], self.conn.sample_rate, text)
        packets = _PROMPT_AUDIO_CACHE.get(key)
        if packets is not None:
            return packets
        try:
            credentials = self.config.get("local_tts")
            if not credentials:
                identity = {
                    "issuer": self.owner["issuer"],
                    "subject": self.owner["subject"],
                    "deviceId": self.conn.device_id,
                    "deviceKey": self._device_key(),
                }
                grant = await self.bridge.request("speech", identity)
                credentials = {**grant["tts"], **speech}
            async with aclosing(synthesize(credentials, text, self.conn.sample_rate)) as stream:
                packets = [frame async for frame in stream]
            if not packets:
                return None
            if len(_PROMPT_AUDIO_CACHE) >= _PROMPT_AUDIO_CACHE_MAX:
                _PROMPT_AUDIO_CACHE.pop(next(iter(_PROMPT_AUDIO_CACHE)))
            _PROMPT_AUDIO_CACHE[key] = packets
            return packets
        except Exception:
            return None

    async def _clip(self, text, path, *, use_voice=True):
        packets = None
        if use_voice and path.startswith("config/assets/botone/"):
            packets = await self._cached_voice_packets(text)
        if packets is None:
            if path.lower().endswith(".p3"):
                packets, _ = await asyncio.to_thread(p3.decode_opus_from_file, path)
            else:
                packets = await audio_to_data(path, sample_rate=self.conn.sample_rate)
        await self._begin_playback()
        await sendAudioMessage(self.conn, SentenceType.FIRST, packets, text, self.conn.sentence_id)

    async def _error_prompt(self, code):
        if code not in ERROR_PROMPTS:
            code = "unavailable"
        await textUtils.get_emotion(self.conn, "😢")
        await self._clip(ERROR_PROMPTS[code], f"config/assets/botone/{code}.wav", use_voice=False)

    async def _events(self):
        backoff = 1
        while not self.closed:
            try:
                identity = await self._identity()
                payload = {
                    **identity, "cursors": self.cursors.copy(),
                    "targetBotIds": sorted(self.targets), "targetGroupIds": sorted(self.groups),
                }
                frames = self.bridge.stream("events", payload)
                async with aclosing(frames):
                    async for event, data in frames:
                        if event == "ready":
                            self.cursors.update(data["cursors"])
                            backoff = 1
                        elif event in {"cursor", "result"}:
                            self.cursors[data["threadId"]] = data["cursor"]
                            if event == "result":
                                self._enqueue_notice(event, data)
                        elif event in {"notification", "pending_cards", "calls"}:
                            self._enqueue_notice(event, data)
                        elif event == "error":
                            break
            except BotoneError as error:
                if error.code == "device_unbound":
                    return
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                pass
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)

    def _enqueue_notice(self, event, data):
        if self.notices.full():
            self.notices.get_nowait()
        self.notices.put_nowait((event, data))

    async def _play_notices(self):
        while not self.closed:
            item = await self.notices.get()
            while self.turn and not self.turn.done():
                await asyncio.wait([self.turn])
            self.turn = self._start_task(self._notice(*item))

    async def _notice(self, event, data):
        started = False
        cancelled = False
        try:
            origin = None
            if event == "calls":
                incoming = next(iter(data.get("calls", [])), None)
                if not incoming:
                    self.incoming = None
                    if self.ring_from_standby:
                        self.ring_from_standby = False
                        await self._finish_audio()
                    return
                origin = incoming.get("deviceKey")
                data = {"id": incoming["callId"], "text": f"{incoming['botName']}来电。说接听或拒接。"}
            if not self._preferred_device(same_device=event == "result", origin=origin):
                return
            identity = await self._identity()
            event_id = data.get("id")
            if event_id:
                seen = getattr(self.conn.server, "peripheral_deliveries", self.seen)
                delivery = (identity["issuer"], identity["subject"], event, event_id)
                if delivery in seen:
                    return
                seen.append(delivery)
            self._start_audio()
            started = True
            if event == "pending_cards":
                await self._offer_cards(identity, quiet=True)
            else:
                if event == "calls":
                    self.incoming = incoming
                    self.ring_from_standby = self.standby
                    await self._clip(data["text"], "config/assets/tts_notify.mp3")
                else:
                    await self._speak(data["text"], identity)
        except asyncio.CancelledError:
            cancelled = True
            raise
        except BotoneError as error:
            if started and self.connected and error.code != "device_unbound":
                await self._error_prompt(error.code)
        except Exception as error:
            self.conn.logger.bind(tag=__name__).warning(
                "Botone notification failed ({})", type(error).__name__)
        finally:
            if started and not cancelled and self.connected and self.conn.client_is_speaking:
                await self._finish_audio()
