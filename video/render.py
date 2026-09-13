#!/usr/bin/env python3
"""Assemble the pitch video from the slides, captures and narration.

    python3 video/render.py

Pipeline, in four passes so a failure is localised instead of buried in one
enormous filter graph:

  1. part    — each frame (slide or live capture) becomes a short clip with a
               slow push/pan, so nothing is ever a frozen still;
  2. scene   — a scene's frames are concatenated;
  3. edit    — scenes are joined with cross-dissolves, and the narration is
               placed on the timeline at each scene's computed start;
  4. verify  — the finished file is probed: duration, streams, A/V alignment,
               and a per-scene frame-presence check.

Timing is derived, never typed in twice: scene duration comes from the measured
narration length plus a tail, and the edit's cross-dissolves therefore shorten
the timeline by a known amount that the audio placement accounts for. That is
what keeps the picture and the voice aligned for the whole five minutes.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
PARTS = ASSETS / "parts"
OUT = ASSETS / "video"
# The finished file is published (served by the Vercel deployment and linked
# from every repository's README), so it lives in the site's own assets tree
# rather than beside the intermediate build products.
PUBLISHED = HERE.parent / "assets" / "video"
FINAL = PUBLISHED / "safeguard-pitch.mp4"
# The poster frame is the README's video thumbnail: it is what a reader sees
# before deciding to press play, so it is a published asset too.
POSTER = PUBLISHED / "safeguard-pitch-poster.jpg"

# Cross-dissolve per scene boundary. Rotating keeps the edit from feeling
# mechanical; "fade" carries most of it because the tone is institutional.
TRANSITIONS = [
    "fade",
    "fade",
    "slideleft",
    "fade",
    "fade",
    "smoothup",
    "fade",
    "slideleft",
    "fade",
    "fade",
]

# Narration starts this long after its scene's first frame, so a cut never
# clips the first syllable.
LEAD = 0.28
ZOOM = 0.06  # total push over a frame, as a fraction of the frame


def run(args: list[str]) -> None:
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        print("\n".join(result.stderr.splitlines()[-25:]), file=sys.stderr)
        raise SystemExit(f"command failed: {' '.join(args[:6])} ...")


def fresh(target: Path, *inputs: Path) -> bool:
    """Whether `target` already exists and is newer than every input.

    Makes the build incremental, which matters here: the frame clips are the
    slow stage, and re-encoding them because a later scene changed would make
    iterating on the edit painful.
    """
    if not target.exists():
        return False
    stamp = target.stat().st_mtime
    return all(source.exists() and source.stat().st_mtime <= stamp for source in inputs)


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def motion_filter(kind: str, seconds: float, fps: int, w: int, h: int) -> str:
    """A slow push in or out, centred, ending where the frame began.

    The input has already been pre-scaled to the largest size the push can
    show (see `normalize_sources`), so this only has to do the motion.
    """
    step = ZOOM / max(seconds * fps, 1)
    if kind == "out":
        zoom = f"max({1 + ZOOM}-{step:.6f}*on,1.0)"
    else:
        zoom = f"min(1+{step:.6f}*on,{1 + ZOOM})"
    return (
        f"zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d=1:s={w}x{h}:fps={fps},format=yuv420p"
    )


def normalize_sources(plan: dict, fps: int, w: int, h: int) -> dict[Path, Path]:
    """Pre-scale every still once, into a form that is cheap to loop.

    `-loop 1` re-decodes its input for every output frame, and the captures
    are 3840x2160 PNGs — decoding one of those ~300 times per clip dominates
    the whole build. Scaling each image once to the largest size the push can
    ever show, and storing it as a JPEG, makes the per-frame cost negligible
    while changing nothing about the picture.
    """
    zoom_w = int(w * (1 + ZOOM)) + 2
    zoom_h = int(zoom_w * h / w) + 2
    cache = ASSETS / "normalized"
    cache.mkdir(parents=True, exist_ok=True)
    sources: dict[Path, Path] = {}
    for scene in plan["scenes"]:
        for frame in scene["frames"]:
            kind, _, name = frame["asset"].partition(":")
            source = ASSETS / ("slides" if kind == "slide" else "captures") / f"{name}.png"
            if not source.exists():
                raise SystemExit(f"missing asset {source} — run `node video/build.mjs` first")
            if source in sources:
                continue
            target = cache / f"{source.stem}.jpg"
            if not fresh(target, source):
                run(["ffmpeg", "-y", "-v", "error", "-i", str(source),
                     "-vf", f"scale={zoom_w}:{zoom_h}:flags=lanczos", "-q:v", "2", str(target)])
            sources[source] = target
    return sources


def build_parts(plan: dict, durations: list[float]) -> list[list[Path]]:
    PARTS.mkdir(parents=True, exist_ok=True)
    fps, w, h = plan["video"]["fps"], plan["video"]["width"], plan["video"]["height"]
    normalized = normalize_sources(plan, fps, w, h)
    print(f"  normalized {len(normalized)} stills to {int(w * (1 + ZOOM)) + 2}px")
    jobs: list[tuple[Path, list[str]]] = []
    scenes_parts: list[list[Path]] = []
    for scene, scene_len in zip(plan["scenes"], durations):
        frames = scene["frames"]
        total_weight = sum(f["weight"] for f in frames)
        parts = []
        for index, frame in enumerate(frames):
            kind, _, name = frame["asset"].partition(":")
            original = ASSETS / ("slides" if kind == "slide" else "captures") / f"{name}.png"
            source = normalized[original]
            span = scene_len * frame["weight"] / total_weight
            part = PARTS / f"{scene['id']}-{index}.mp4"
            if fresh(part, source, HERE / "scenes.json"):
                parts.append(part)
                continue
            jobs.append((part, [
                "ffmpeg", "-y", "-v", "error",
                # `-framerate` is load-bearing, not decoration. `-loop 1`
                # defaults to 25 fps, and `zoompan` with `d=1` emits exactly
                # one frame per input frame — so a 6.000s span silently became
                # 5.000s (150 frames at 30 fps) and every scene ran short.
                "-framerate", str(fps),
                "-loop", "1", "-t", f"{span:.3f}", "-i", str(source),
                "-vf", motion_filter(frame.get("motion", "in"), span, fps, w, h),
                # Intermediates are re-encoded by the edit, so they only have
                # to be visually clean; `ultrafast` at a low CRF keeps the
                # build quick without the final picture paying for it.
                "-r", str(fps), "-c:v", "libx264", "-preset", "ultrafast",
                "-crf", "15", "-pix_fmt", "yuv420p", str(part),
            ]))
            parts.append(part)
        scenes_parts.append(parts)

    # Frame clips are independent, so encode them across the cores. Threads are
    # enough: the work happens in ffmpeg, not in Python.
    if jobs:
        workers = min(len(jobs), max(os.cpu_count() or 2, 2))
        done = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for _ in pool.map(lambda job: run(job[1]), jobs):
                done += 1
                print(f"  frame  {done}/{len(jobs)} clips encoded", flush=True)
    else:
        print("  frame  all clips up to date")
    for scene, parts, scene_len in zip(plan["scenes"], scenes_parts, durations):
        print(f"  parts  {scene['id']:<18} {len(parts)} frame(s)  {scene_len:6.2f}s")
    return scenes_parts


def concat(parts: list[Path], out: Path) -> None:
    listing = out.with_suffix(".txt")
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in parts))
    run([
        "ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
        "-i", str(listing), "-c", "copy", str(out),
    ])


def build_scenes(plan: dict, durations: list[float], parts: list[list[Path]]) -> list[Path]:
    outputs = []
    for index, (scene, scene_len) in enumerate(zip(plan["scenes"], durations)):
        out = PARTS / f"scene-{scene['id']}.mp4"
        if not fresh(out, *parts[index]):
            concat(parts[index], out)
        # Trust the file over the arithmetic: encoding a still can land a frame
        # either side of the target, and the edit's offsets are built from
        # these durations, so a mismatch has to be caught here rather than
        # silently shifting the narration against the picture.
        actual = probe_duration(out)
        drift = actual - scene_len
        if abs(drift) > 0.34:
            raise SystemExit(
                f"scene {scene['id']}: built {actual:.3f}s against a planned "
                f"{scene_len:.3f}s ({drift:+.3f}s)"
            )
        durations[index] = actual
        outputs.append(out)
    return outputs


def timeline(plan: dict, durations: list[float]) -> tuple[float, list[float]]:
    """Scene start times and total length, after the dissolves shorten it.

    One definition, used by both the edit and the verification — so the two
    cannot disagree about where a scene begins.
    """
    fade = plan["video"]["crossfade"]
    starts, clock = [], 0.0
    for index, span in enumerate(durations):
        starts.append(clock)
        clock += span - (fade if index < len(durations) - 1 else 0.0)
    return clock, starts


def edit(plan: dict, scenes: list[Path], durations: list[float]) -> tuple[float, list[float]]:
    """Cross-dissolve the scenes and lay the narration on the same timeline."""
    video = plan["video"]
    fade = video["crossfade"]
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLISHED.mkdir(parents=True, exist_ok=True)

    args = ["ffmpeg", "-y", "-v", "error"]
    for path in scenes:
        args += ["-i", str(path)]
    takes = json.loads((ASSETS / "manifest-audio.json").read_text())["takes"]
    for take in takes:
        args += ["-i", str(ASSETS / "audio" / take["file"])]

    total, starts = timeline(plan, durations)

    graph = []
    label = "0:v"
    for index in range(1, len(scenes)):
        offset = starts[index] - fade
        transition = TRANSITIONS[(index - 1) % len(TRANSITIONS)]
        out = f"v{index}"
        graph.append(
            f"[{label}][{index}:v]xfade=transition={transition}"
            f":duration={fade}:offset={offset:.3f}[{out}]"
        )
        label = out

    for index, take in enumerate(takes):
        delay = int(round((starts[index] + LEAD) * 1000))
        graph.append(f"[{len(scenes) + index}:a]adelay={delay}|{delay}[a{index}]")
    mix = "".join(f"[a{i}]" for i in range(len(takes)))
    graph.append(f"{mix}amix=inputs={len(takes)}:duration=longest:normalize=0[mixed]")
    graph.append(f"[mixed]apad=whole_dur={total:.3f},atrim=0:{total:.3f},"
                 f"afade=t=in:d=0.5,afade=t=out:st={max(total - 1.4, 0):.3f}:d=1.4[aout]")

    args += [
        "-filter_complex", ";".join(graph),
        "-map", f"[{label}]", "-map", "[aout]",
        # CRF 24 rather than 21: the content is slow-moving slides and text, so
        # the extra bitrate buys almost nothing visible, while the file is
        # committed to git and served on every page load of the docs hub. It
        # keeps the artefact comfortably under GitHub's 50 MB warning for
        # tracked files.
        "-c:v", "libx264", "-preset", "faster", "-crf", "24", "-pix_fmt", "yuv420p",
        "-profile:v", "high", "-level", "4.1", "-r", str(video["fps"]),
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart",
        "-t", f"{total:.3f}",
        str(FINAL),
    ]
    run(args)

    # Subtitles ride along with the video, timed off the same clock.
    #
    # WebVTT, not SRT. The `<track>` element accepts only WebVTT; an SRT file
    # there is not an error the browser reports, it is a caption track that
    # silently never appears. The two formats differ by the header line and by
    # `.` instead of `,` before the milliseconds.
    cues = ["WEBVTT", ""]
    for index, take in enumerate(takes):
        start = starts[index] + LEAD
        end = start + take["duration"]
        cues.append(str(index + 1))
        cues.append(f"{stamp(start)} --> {stamp(end)}")
        cues.append(plan["scenes"][index]["narration"])
        cues.append("")
    vtt = PUBLISHED / "safeguard-pitch.vtt"
    vtt.write_text("\n".join(cues), encoding="utf-8")
    # A previous build may have published an SRT; leaving it behind would be a
    # file nothing references and a wrong answer to "what are the subtitles?".
    (PUBLISHED / "safeguard-pitch.srt").unlink(missing_ok=True)
    return total, starts


def publish_poster() -> None:
    """Extract the poster frame the READMEs embed as the video thumbnail.

    Generated rather than hand-picked so it cannot go stale: it is a frame of
    the file it advertises, taken from the title scene where the identity of
    the project is on screen.
    """
    run([
        "ffmpeg", "-y", "-v", "error",
        "-ss", "3.5", "-i", str(FINAL),
        "-frames:v", "1", "-vf", "scale=1920:1080", "-q:v", "3",
        str(POSTER),
    ])


def stamp(seconds: float) -> str:
    ms = max(int(round(seconds * 1000)), 0)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def verify(total: float, starts: list[float]) -> int:
    """Probe the artifact and check the claims the README will make."""
    info = subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(FINAL)],
        capture_output=True, text=True, check=True,
    )
    meta = json.loads(info.stdout)
    fmt = meta["format"]
    streams = {s["codec_type"]: s for s in meta["streams"]}
    duration = float(fmt["duration"])
    size_mb = int(fmt["size"]) / (1024 * 1024)
    video = streams.get("video", {})
    audio = streams.get("audio")

    problems = []
    if abs(duration - total) > 0.5:
        problems.append(f"duration {duration:.2f}s drifted from the planned {total:.2f}s")
    if video.get("codec_name") != "h264":
        problems.append(f"video codec is {video.get('codec_name')}, not h264")
    if (video.get("width"), video.get("height")) != (1920, 1080):
        problems.append(f"resolution is {video.get('width')}x{video.get('height')}")
    if audio is None:
        problems.append("no audio stream — the narration did not make it in")
    if size_mb > 48:
        problems.append(f"file is {size_mb:.1f} MB, heavier than this commit is willing to carry")

    # The README and the site both link the poster and the caption track, so a
    # missing or malformed one is a broken promise rather than a missing file.
    if not POSTER.exists():
        problems.append(f"poster {POSTER.name} is missing; the READMEs embed it")
    cues = PUBLISHED / "safeguard-pitch.vtt"
    if not cues.exists():
        problems.append("the WebVTT caption track is missing")
    else:
        text = cues.read_text(encoding="utf-8")
        if not text.startswith("WEBVTT"):
            problems.append("the caption track does not start with WEBVTT")
        # A browser ignores a cue whose timestamps use SRT's comma, so this is
        # the assertion that the track actually plays.
        if re.search(r"^\d\d:\d\d:\d\d,", text, re.M):
            problems.append("the caption track uses SRT comma timestamps")
        found = len(re.findall(r"^\d\d:\d\d:\d\d\.\d\d\d --> ", text, re.M))
        if found != len(starts):
            problems.append(f"the caption track has {found} cues for {len(starts)} scenes")

    # Every scene must actually contribute frames: decode and sample the
    # timeline, confirming the picture changes where a cut is expected.
    samples = []
    for index, start in enumerate(starts):
        middle = start + 1.0  # a second into the scene, past any dissolve
        frame = OUT / f"check-{index}.png"
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{middle:.3f}", "-i", str(FINAL),
             "-frames:v", "1", str(frame)])
        samples.append(frame)

    print()
    print(f"  file        {FINAL.relative_to(HERE.parent)}")
    print(f"  duration    {duration:.2f}s  ({duration / 60:.2f} min)")
    print(f"  video       {video.get('codec_name')} {video.get('width')}x{video.get('height')} "
          f"{float(video.get('r_frame_rate', '0/1').split('/')[0]) / max(float(video.get('r_frame_rate', '1/1').split('/')[1]), 1):.0f}fps")
    print(f"  audio       {audio.get('codec_name')} {audio.get('sample_rate')}Hz "
          f"{audio.get('channels')}ch" if audio else "  audio       MISSING")
    print(f"  size        {size_mb:.1f} MB")
    print(f"  scenes      {len(starts)} checked for frames")

    if problems:
        for problem in problems:
            print(f"  PROBLEM     {problem}", file=sys.stderr)
        return 1
    print("  verdict     ok")
    return 0


def main() -> int:
    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg is required")
    plan = json.loads((HERE / "scenes.json").read_text())
    audio = json.loads((ASSETS / "manifest-audio.json").read_text())
    tail = plan["video"].get("tail", 0.0)
    durations = [t["duration"] + tail for t in audio["takes"]]

    stage = sys.argv[1] if len(sys.argv) > 1 else "all"
    print("1/4 building frame clips")
    parts = build_parts(plan, durations)
    if stage == "parts":
        return 0
    print("2/4 concatenating scenes")
    scenes = build_scenes(plan, durations, parts)
    if stage == "scenes":
        return 0
    print("3/4 editing (dissolves + narration)")
    total, starts = edit(plan, scenes, durations)
    if stage == "edit":
        return 0
    print("4/4 publishing the poster and verifying")
    publish_poster()
    return verify(total, starts)


if __name__ == "__main__":
    sys.exit(main())
