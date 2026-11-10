<div align="center">

# OneVideo

**Staged, Gated AI Video Production Pipeline & Remotion Motion Graphics Engine**

[![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-5FA04E.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Remotion](https://img.shields.io/badge/Engine-Remotion%20v4-0B84FF.svg?style=flat-square&logo=remotion&logoColor=white)](https://www.remotion.dev/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-6.0+-007808.svg?style=flat-square&logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg?style=flat-square)]()

[English](./README.md) · [简体中文](./README.zh-CN.md) · [Features](#features) · [Installation](#installation) · [Skill Integration](#using-as-a-coding-agent-skill)

</div>

---

**OneVideo** is an industrial-grade, fully automated video production pipeline and autonomous coding agent skill designed for Claude Code and ZCode. It orchestrates the creation of narrated data explainers, mini-documentaries, vertical shorts, and product teasers through strict, mechanical quality gates.

```
research → proposal → script → storyboard → assets → voice → compose → render → review → publish
  Facts+Sources Proposal   Sentences   Layout/Charts Lic. Assets TTS+Loudness Timeline   Remotion   Auto QC   Subtitles/Stems
```

---

## Features

- **Shared Motion Engine, Data-Only Projects**: Project directories remain lightweight, containing only `onevideo.json`, `plan/*.json`, `public/`, and `out/`. All projects share the underlying Remotion motion graphics engine located under `template/`.
- **Finite-State Machine with Audit Hashes**: Critical creative transitions require human approval. Approvals lock artifact SHA-256 hashes computed on project-relative paths (remaining valid across machines). Any modification transitions the stage to `stale`, preventing unauthorized render passes.
- **Strict Mechanical Quality Gates**:
  - **Fact Provenance Gate**: Every single statistic in narration must map to an authoritative fact id declared during the research phase.
  - **Pacing & Cadence Gate**: Pacing is estimated algorithmically and enforced within 3.5–6.2 syllables per second.
  - **Compliance Gate**: Subtitle line length, minimum scene duration, and media licensing allow-lists are validated before rendering.
- **Sentence-Level TTS Synchronization**: Visual reveals and typography synchronize exactly with timestamped audio cues. Global audio is normalized according to ITU-R BS.1770 / EBU R128 standards (default −16 LUFS) with soft-limiting.
- **Cinematic Motion Graphics Engine**:
  - Independent camera tracks per scene (slow pushes, whip pans, depth zooms, dynamic motion blur).
  - Depth-aware layering, title occlusion behind foreground subjects, and seamless transitions.
  - Infinite-canvas camera transitions with automatic musical beat-matching (`music.offset: "auto"`).
- **Depth & Subject Spatial Awareness**: Generates monocular depth maps via `onevideo depth` to route camera motion and typography away from primary subjects.
- **Automated Post-Render Quality Control (QC)**:
  - Validates container encoding, resolution, frame rate, true-peak audio, silence bounds, and freeze frames.
  - Generates contact sheets and automated visual inspection reports.
  - Exports SRT/VTT subtitles, timestamped chapter markers, and `--stems` multitrack stems (voice, score, SFX).

---

## Installation

Requires Node.js ≥ 20.

```bash
git clone https://github.com/dengyie/one-video.git
cd one-video

npm run setup            # Install Remotion engine dependencies in template/
npm link                 # Register global onevideo CLI
onevideo doctor          # Inspect dependencies and environment health
```

For Linux servers (Debian/Ubuntu) running headless Chromium renders:

```bash
apt-get install -y --no-install-recommends \
  libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2 libpango-1-0-0 libcairo2 fonts-noto-cjk
```

---

## Quick Start

```bash
# Initialize project from the motion graphics example
onevideo init my-video --example spacex-motion
cd my-video

# Inspect pipeline stage status
onevideo status

# Validate schema contracts and quality gates
onevideo validate

# Test TTS sample pronunciation and pacing
onevideo tts --sample

# Build complete timeline and render
onevideo build

# Review inspection frames and approve
onevideo approve review

# Export final publishing bundle
onevideo publish
```

Output files:
- Rendered MP4: `out/<name>.mp4`
- Inspection frames: `out/qc/frames/`
- Publishing bundle: `out/publish/`

---

## Using as a Coding Agent Skill

Symlink the repository into your local agent environment:

```bash
ln -s "$PWD" ~/.claude/skills/onevideo
```

Invoke through natural language in your agent session: *"Help me create an animated data explainer on SpaceX Starship test flights."*

---

## Repository Structure

| Path | Description |
|---|---|
| `cli/` | Zero-dependency Node.js CLI: `commands/` plus domain modules in `lib/` (captions, voice, generate, prompts, assets, timeline, review, …; see `references/architecture.md`) |
| `template/` | Core Remotion motion graphics engine (scenes, styles, transitions) |
| `pipelines/` | Pipeline configurations for data-explainer, documentary, shorts, and promo |
| `stages/` | Stage director guides and procedural checklists |
| `styles/` | Visual tokens, palette assets, and animation curves |
| `schemas/` | Strict JSON Schema definitions for configurations and stage outputs |
| `references/` | Lexicons, phonetic maps, licensing rules, and QC tolerance thresholds |
| `examples/` | Showcase projects (motion graphics, data charts, product interfaces) |
| `tests/` | Automated unit and pipeline behavior tests |

---

## License

OneVideo is released under the [MIT License](LICENSE).
