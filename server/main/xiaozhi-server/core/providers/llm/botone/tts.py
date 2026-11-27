"""Decode the speech gateway's audio as it arrives and emit 60 ms Opus frames."""
import asyncio
from contextlib import aclosing, suppress

import httpx
import opuslib_next

from .client import BotoneError, trusted_url


async def _decode(response, sample_rate):
    process = await asyncio.create_subprocess_exec(
        "ffmpeg", "-nostdin", "-loglevel", "error", "-i", "pipe:0",
        "-f", "s16le", "-ac", "1", "-ar", str(sample_rate), "pipe:1",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )

    async def feed():
        try:
            async for chunk in response.aiter_bytes():
                process.stdin.write(chunk)
                await process.stdin.drain()
        finally:
            process.stdin.close()
            with suppress(BrokenPipeError, ConnectionResetError):
                await process.stdin.wait_closed()

    feeding = asyncio.create_task(feed())
    encoder = opuslib_next.Encoder(sample_rate, 1, opuslib_next.APPLICATION_AUDIO)
    samples = sample_rate * 60 // 1000
    frame_bytes = samples * 2
    try:
        while True:
            try:
                pcm = await process.stdout.readexactly(frame_bytes)
            except asyncio.IncompleteReadError as end:
                if end.partial:
                    yield encoder.encode(end.partial.ljust(frame_bytes, b"\0"), samples)
                break
            yield encoder.encode(pcm, samples)
        await feeding
        if await process.wait():
            raise BotoneError("unavailable")
    finally:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        feeding.cancel()
        await asyncio.gather(feeding, process.stdout.read(), return_exceptions=True)
        await process.wait()


async def synthesize(credentials, text, sample_rate):
    base_url = credentials["baseUrl"]
    if not trusted_url(base_url):
        raise BotoneError("unavailable")
    async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
        async with client.stream(
            "POST", base_url.rstrip("/") + "/audio/speech",
            headers={"Authorization": "Bearer " + credentials["apiKey"]}
            if credentials.get("apiKey") else {},
            json={"model": credentials["model"], "voice": credentials["voice"], "input": text,
                  "speed": 1},
        ) as response:
            if response.is_redirect:
                target = response.headers.get("location", "")
                # A gateway can return a signed audio URL. It gets no model credentials.
                if not target.startswith("https://") or not httpx.URL(target).host or httpx.URL(target).userinfo:
                    raise BotoneError("unavailable")
                async with client.stream("GET", target) as audio:
                    if not audio.is_success:
                        raise BotoneError("unavailable")
                    async with aclosing(_decode(audio, sample_rate)) as decoded:
                        async for packet in decoded:
                            yield packet
                return
            if not response.is_success:
                body = {}
                try:
                    await response.aread()
                    error = response.json().get("error", {})
                    if isinstance(error, dict):
                        body = error
                except (ValueError, AttributeError):
                    pass
                exhausted = response.status_code == 402 or body.get("code") in {
                    "insufficient_quota", "token_quota_exceeded", "user_quota_exceeded",
                }
                raise BotoneError("quota_exhausted" if exhausted else "unavailable")
            async with aclosing(_decode(response, sample_rate)) as decoded:
                async for packet in decoded:
                    yield packet
