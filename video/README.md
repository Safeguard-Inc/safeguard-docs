# Pitch video

The ~5-minute product pitch for the Safeguard stack. It is **built from this
repository**, not edited by hand: the slides, the live captures, the voice-over
and the edit are all produced by the scripts here, so the video can be
regenerated on any machine and cannot drift away from what the project
actually does.

```bash
npm run video        # captures + slides + narration + edit + verification
```

The finished file is published at
[`assets/video/safeguard-pitch.mp4`](../assets/video/safeguard-pitch.mp4),
which the Vercel deployment serves and every repository's README links to.

## What it says

Eleven scenes, in the order a reviewer, investor or technical buyer needs them:

| # | Scene | Beat |
| - | ----- | ---- |
| 1 | Safeguard | title |
| 2 | The problem | confidential transfers are private, which is what makes "prove it was allowed" hard |
| 3 | Why reports don't work | compliance must decide inside the transaction, not after it |
| 4 | What Safeguard is | DEFINE / ENFORCE / PROVE, one decision path |
| 5 | Architecture | one call, one boolean — the enforcement layer never sees the rules |
| 6 | No unknown state | typed, assign-only error codes; it refuses rather than guesses |
| 7 | Live deployment | the real engine, driven in the browser on the deployed site |
| 8 | Prove | ledger events become evidence: normalised, digest-chained, classifiable |
| 9 | Verified, not asserted | Testnet contract ids, the read-only smoke test, test counts, cost |
| 10 | Open source | the issue backlog and the CI that keeps the numbers honest |
| 11 | Conclusion | privacy and compliance are not a trade-off |

## Layout

| Path | What it is |
| ---- | ---------- |
| `scenes.json` | **the script** — narration, scene order, slide content, capture URLs, timing |
| `build.mjs` | renders the slides and photographs the live pages (Playwright) |
| `narrate.py` | synthesises one audio file per scene and measures every take |
| `render.py` | builds the edit with ffmpeg, publishes the poster and the WebVTT caption track, and verifies the result |
| `check-demo.mjs` | asserts what the live demo actually decides (used to keep the script truthful) |
| `assets/` | build products — ignored by git, regenerate with `npm run video` |

The published artefacts are `../assets/video/safeguard-pitch.mp4`, its
`-poster.jpg` thumbnail (a frame of the file it advertises, extracted by the
build so it cannot go stale) and `safeguard-pitch.vtt`. The caption track is
**WebVTT, not SRT**: `<track>` accepts only WebVTT, and an SRT file there is
not an error the browser reports — it is a caption track that silently never
appears. `render.py` writes it and then deletes any `.srt` a previous build
left behind, and CI re-checks the header and the timestamps so that failure
mode cannot ship.

## The captures are real

`build.mjs` photographs the running system — the deployed documentation hub,
the demo mid-interaction, and the real GitHub organisation. Nothing is
redrawn by hand, so **if the deployment regresses, the video regresses with
it**. Each slide additionally asserts that its own text reached the DOM before
the screenshot is taken, so a template bug fails the build instead of emitting
a blank frame.

`check-demo.mjs` drives the live demo and prints the decision it returns:

```text
compliant  decision=APPROVE   reason=no_reason
sanctions  decision=FLAG      reason=sanctions_match
frozen     decision=BLOCK     reason=account_frozen
```

This exists because the first draft of the narration claimed a sanctions
match produces BLOCK. The live engine returned FLAG with the rule attributed,
so **the script was corrected, not the claim explained away**. Run it before
recording anything future-tensed.

## Where the numbers in scene 9 come from

A pitch video that quotes figures nobody can reproduce is an advertisement.
Every number on the "Verified, not asserted" scene has a command behind it,
and this table is the check the reviewer would otherwise have to guess at.

| On screen | Source |
| --------- | ------ |
| `9 / 9` deployment checks | `safeguard-hooks verify --contract CC7UKMCY… --account <G…>` run with `SAFEGUARD_ADMIN_SK` **unset**, against the live Testnet contract |
| `849` tests | `cargo test --workspace` in each Rust repository (188 policy, 163 hooks, 454 audit) + `npm test` in the TypeScript SDK (20) and in this repository (24) |
| `92.6%` line coverage, audit layer | `safeguard-audit` `docs/coverage.md`, produced by `cargo llvm-cov` under the pinned toolchain |
| `27,210 B` enforcement wasm | `safeguard-hooks` release build of `compliance-hooks` under the pinned toolchain; recorded in `docs/performance.md` |
| `57` open issues | `org:Safeguard-Inc is:issue is:open` |
| `0.0011 XLM` per compliant deposit | `safeguard-hooks` `scripts/bench-gas.sh`, the measured enforcement overhead over the baseline operation |

If a number here changes, rebuild — `npm run video` re-renders the scene from
`scenes.json`, and the READMEs are linked to the same file.

## Voice-over

The narration is synthesised per scene, never read live, so the timing is
reproducible and the edit can be cut to measured durations.

| Engine | How | Notes |
| ------ | --- | ----- |
| `edge` (default) | `python3 video/narrate.py` | neural voice over a public endpoint; **no API key required**, which is the only reason this repository can build its own video without a credential |
| `gemini` | `SAFEGUARD_TTS=gemini GEMINI_API_KEY=… python3 video/narrate.py` | Gemini TTS; the preferred engine, but it needs a key the build environment does not have |

Gemini returns headerless PCM, so `narrate.py` wraps it into the same
container every other engine produces; the rest of the pipeline is unchanged.
Override the model or voice with `GEMINI_TTS_MODEL` / `GEMINI_TTS_VOICE`.

Whatever engine produced a take is recorded in `assets/manifest-audio.json`
under `engine` and `voice`, and the duration is **measured with `ffprobe`**
rather than estimated — the edit's timeline is computed from those numbers, so
an estimate would drift against the picture.

## How the edit is timed

Scene duration is `narration + tail`. Cross-dissolves shorten the timeline by
`(scenes - 1) × crossfade`, and the narration for scene *k* is placed at that
scene's computed start plus a `LEAD` of 0.28 s so a cut never clips a
syllable. One function (`timeline`) computes those offsets for both the edit
and the verification, so the two cannot disagree.

Two things are asserted rather than assumed:

* **Every frame clip matches its planned span.** `-loop 1` defaults to 25 fps
  and `zoompan` with `d=1` emits exactly one frame per input frame, so a
  6.000 s span once silently became 5.000 s. `-framerate` is passed explicitly
  and the scene build fails if a built scene differs from its plan by more
  than a third of a second.
* **The finished file is probed.** Duration, codec, resolution, presence of
  the audio stream, file size, and a frame extracted a second into every scene
  to confirm each one actually contributes picture.

## Rebuilding after a change

| Changed | Command |
| ------- | ------- |
| narration, slide copy, scene order | `npm run video` |
| a slide's design in `build.mjs` | `npm run video` |
| the deployed site | `npm run video:assets` then `npm run video:render` (recaptures the live pages) |

Because the assets are captured from production, **rebuild after any change to
the deployment** — the video is only as current as the site it was
photographed from.
