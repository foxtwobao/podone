"""Server-to-server Botone transport. Audio and credentials never reach the device JSON."""
import json
from urllib.parse import urlsplit

import httpx


class BotoneError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def trusted_url(value):
    url = urlsplit(value)
    return (
        not (url.username or url.password or url.query or url.fragment)
        and bool(url.hostname)
        and (url.scheme == "https" or (url.scheme == "http" and url.hostname in {"127.0.0.1", "::1", "localhost"}))
    )


def validate_config(config):
    if not trusted_url(config["url"]) or len(config.get("secret", "")) < 32:
        raise ValueError("Botone requires an HTTPS or loopback URL and the shared bridge secret")
    local = config.get("local_tts")
    if local and (not trusted_url(local.get("baseUrl", "")) or not local.get("voice") or not local.get("model")):
        raise ValueError("Botone local_tts requires a trusted baseUrl, voice and model")


async def sse_frames(lines):
    """SSE framing is line based; one event can carry more than one data line."""
    event, data = "", []
    async for line in lines:
        if not line:
            if data:
                body = json.loads("\n".join(data))
                if not isinstance(body, dict):
                    raise BotoneError("unavailable")
                yield event, body
            event, data = "", []
        elif line.startswith("event:"):
            event = line[6:].lstrip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip(" "))


async def check_response(response):
    if response.is_success:
        return
    try:
        await response.aread()
        payload = response.json()
        code = payload.get("error") if isinstance(payload, dict) else None
    except ValueError:
        code = None
    raise BotoneError(code if isinstance(code, str) else "unavailable")


class BotoneClient:
    def __init__(self, config):
        validate_config(config)
        self.http = httpx.AsyncClient(
            base_url=config["url"].rstrip("/") + "/api/peripheral/v1/",
            headers={"Authorization": "Bearer " + config["secret"]},
            timeout=httpx.Timeout(45, connect=5),
            trust_env=False,
        )

    async def request(self, route, body):
        response = await self.http.post(route, json=body)
        await check_response(response)
        return response.json()

    async def stream(self, route, body):
        async with self.http.stream("POST", route, json=body) as response:
            await check_response(response)
            async for frame in sse_frames(response.aiter_lines()):
                yield frame

    async def close(self):
        await self.http.aclose()
