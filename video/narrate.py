#!/usr/bin/env python3
"""Generate the voice-over for the pitch video, one audio file per scene.

    python3 video/narrate.py

Reads `video/scenes.json`, synthesises each scene's narration to
`video/assets/audio/<scene-id>.mp3`, and writes `manifest.json` with the
measured duration of every take (ffprobe, not an estimate). The published
WebVTT caption track is written by `render.py` from the final timeline, which
is the only place the real cue offsets exist.

Why durations are measured rather than assumed: the edit places every scene on
a timeline computed from these numbers, so an estimated length would drift
against the images. Speech length varies with the voice, the rate and the
punctuation, so the only trustworthy source is the file itself.

Voice: `plan.video.voice`. The default is a neural voice from the
`edge-tts` engine, which runs against a public endpoint and needs no key.
To use a different engine — including Gemini TTS, which needs an API key this
build environment does not have — set `SAFEGUARD_TTS=gemini` and provide
`GEMINI_API_KEY`; see `video/README.md` for the exact swap. Whatever the
engine, the contract is the same: one MP3 per scene, named by scene id, and
the manifest records which voice actually produced the audio.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
AUDIO = ASSETS / "audio"


def duration(path: Path) -> float:
    """Measured duration of an audio file, in seconds."""
    out = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(out.stdout.strip())


async def synth_edge_tts(scene: dict, video: dict, out: Path) -> None:
    """Synthesise with edge-tts (no API key, public neural endpoint)."""
    import edge_tts

    communicate = edge_tts.Communicate(
        scene["narration"],
        video["voice"],
        rate=video.get("rate", "+0%"),
        pitch=video.get("pitch", "+0Hz"),
    )
    await communicate.save(str(out))


def synth_gemini(scene: dict, video: dict, out: Path) -> None:
    """Synthesise with Gemini TTS.

    Kept small and isolated on purpose: it is the preferred engine, but it
    requires a key, and this repository must be buildable without one.
    """
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise SystemExit("SAFEGUARD_TTS=gemini needs GEMINI_API_KEY in the environment")
    import base64

    import urllib.request

    model = os.environ.get("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")
    voice = os.environ.get("GEMINI_TTS_VOICE", "Charon")
    payload = json.dumps(
        {
            "contents": [{"parts": [{"text": scene["narration"]}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}
                },
            },
        }
    ).encode()
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=payload,
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        body = json.loads(response.read())
    part = body["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
    raw = Path(str(out) + ".pcm")
    raw.write_bytes(base64.b64decode(part))
    # Gemini returns headerless PCM; wrap it so the rest of the pipeline sees
    # the same container it gets from every other engine.
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "s16le", "-ar", "24000", "-ac", "1",
         "-i", str(raw), "-c:a", "libmp3lame", "-q:a", "2", str(out)],
        check=True,
    )
    raw.unlink(missing_ok=True)


def main() -> int:
    if shutil.which("ffprobe") is None:
        raise SystemExit("ffprobe is required (install ffmpeg)")
    plan = json.loads((HERE / "scenes.json").read_text())
    video = plan["video"]
    engine = os.environ.get("SAFEGUARD_TTS", "edge")
    AUDIO.mkdir(parents=True, exist_ok=True)

    takes = []
    for index, scene in enumerate(plan["scenes"]):
        out = AUDIO / f"{scene['id']}.mp3"
        if engine == "gemini":
            synth_gemini(scene, video, out)
        else:
            asyncio.run(synth_edge_tts(scene, video, out))
        take = {
            "id": scene["id"],
            "chapter": scene["chapter"],
            "file": out.name,
            "duration": round(duration(out), 3),
            "words": len(scene["narration"].split()),
            "engine": engine,
            "voice": video["voice"] if engine == "edge" else os.environ.get("GEMINI_TTS_VOICE", "Charon"),
        }
        takes.append(take)
        print(f"  {scene['id']:<18} {take['duration']:>7.2f}s  {take['words']:>4} words  {take['voice']}")

    total = sum(t["duration"] for t in takes)
    seconds = total + len(takes) * video.get("tail", 0.0)
    manifest = {
        "engine": engine,
        "totalSpeechSeconds": round(total, 3),
        "estimatedRuntimeSeconds": round(seconds, 3),
        "takes": takes,
    }
    (ASSETS / "manifest-audio.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print()
    print(f"speech: {total:.1f}s   with tails: {seconds:.1f}s   ({seconds / 60:.1f} min)")
    print(f"engine: {engine}   cues: {len(takes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
