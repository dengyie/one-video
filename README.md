<div align="center">

# OneVideo

**Staged, Gated AI Video Production Pipeline & Remotion Motion Graphics Engine**

[![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)
[![Node Version](https://img.shields.io/badge/Node-20%2B-339933.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Remotion](https://img.shields.io/badge/Engine-Remotion-0B84FF.svg?style=flat-square)](https://www.remotion.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg?style=flat-square)]()

[English](./README.md) • [Workflow](#特性) • [Installation](#安装) • [Skill Usage](#在-claude-code--zcode-里当-skill-用)

</div>

---

用 Claude Code / ZCode 生产带旁白视频（数据解说、纪录片、竖屏短视频）的工业级全自动流水线和 Skill。整个过程分阶段推进，每一步都有严格的机械门控（Mechanical Gates）。

```
research → proposal → script → storyboard → assets → voice → compose → render → review → publish
  事实+来源   方案      逐句脚本    分镜/图表     授权素材   TTS+响度   时间轴     Remotion   自动 QC   字幕/章节/简介
```

## 特性

- **引擎共享，项目只存数据**：项目目录里只有 `onevideo.json`、`plan/*.json`、`public/`、`out/`，所有项目共用 `template/` 下的 Remotion 引擎。
- **阶段状态机**：创作阶段要人工审批，审批时锁定产物哈希（按项目内相对路径计算，项目拷走不失效）。已审批的产物再被改动，该阶段变为 stale，需重新审批。改了 script 但没重跑 `tts`，timings 门控会直接报错，渲染被拦下。
- **机械门控**：
  - 数字门控：旁白里的每个数字都要对上 research 里有来源的 fact，`claims` 引用的 fact id 必须存在。
  - 语速门控：按音节估算，范围 3.5–6.2 音节/秒。
  - 字幕长度、场景时长、素材授权白名单。
- **逐句 TTS 计时**：字幕和画面揭示跟着真实语音时间走。整片统一做 BS.1770 响度归一化（默认 −16 LUFS），带软限幅。
- **动效引擎**：每个场景一条镜头轨（推近、硬切、动态模糊）；实拍变速、标题压在主体后面；无限画布让数字卡变形并让镜头连续飞行；through / whip 等 12 种转场；切点吸附音乐重拍，`music.offset: "auto"` 自动对齐配乐；动态字幕和运动音效。
- **画面感知**：`onevideo depth` 生成深度图和亮度网格，编译器据此让 through 冲向主体、关键词避开主体、亮背景上的字自动加底、字幕在主体占满底部时移到顶部。
- **节奏门控**：编译后检查画面超过 4.5s 没有新元素的空档和连续相同转场，避免做成翻页 PPT。
- **场景库**：标题、数据卡、柱状图竞赛、折线、对比、时间线、引用、图片/视频 Ken Burns、章节卡、片尾等；风格和动效节奏可配置。
- **素材**：NASA、Wikimedia Commons、Openverse 免 key 可用；Pexels（可选）。授权信息自动进入简介。
- **AI 生成素材**：通过 OpenAI 兼容接口生图（一次出多张，由视觉模型挑一张，备选全部保留）和生视频（文生视频，或用 `from` 把一张图做成首帧图生视频）。按模型顺序依次回退，生成失败时回落到检索素材。
- **导演工具**：`onevideo sheet` 把成片铺成联系表；`onevideo look` 请视觉模型按剪辑标准审片，每条意见对应到时间点和场景，写进 `out/qc/look.json`。
- **版本与局部渲染**：`render --scenes a,b` / `--from --to` 只渲一段做样片；每次渲染存成 `out/versions/vN` 并记录时间轴哈希和备注，`onevideo versions` 查看，`sheet --vs prev` 把新旧两版逐格上下对比。
- **生成视频自动质检**：生视频取回后由视觉模型检查人物重复、变形、跳变，自动保留最长的一段干净画面。
- **写作门控**：脚本每个场景写它回答的观众问题（question 门控）；屏幕文字逐字照抄旁白时报 echo 警告。
- **交接页**：`onevideo handoff` 生成 `plan/handoff.md`，记录阶段、已定参数、版本、看片意见和待处理问题，手写的“锁定 / 下一轮只改”跨次保留，换会话或交给子 agent 时不丢上下文。
- **程序化配乐和音效**：零依赖合成，没有版权问题。
- **渲染后 QC**：检查编码、分辨率、帧率、时长、响度、真峰值、旁白中的静音、黑帧、冻结画面、静态占比，并按场景抽帧供人工审阅。
- **发布包**：SRT/VTT 字幕、章节时间戳、带全部来源与素材署名的简介；`publish --stems` 另出旁白 / 音乐 / 音效分轨。
- **产品宣传（promo 流水线）**：`onevideo capture` 用自己起的无头 Chrome 按手机/平板/桌面视口截真实界面，并量出元素位置；`device` 场景把界面装进同一台设备，点按 → 卡片展开 → 停在结果上，镜头自动接力；`match-cut` 剪影匹配剪辑；`footage.screen` 把界面透视贴进实拍里的屏幕（`onevideo screen` 自动找角点），`footage.windows` 竖条窗口转场。

## 安装

需要 Node ≥ 20。

```bash
git clone https://github.com/dengyie/OneVideo.git && cd OneVideo
npm run setup            # 安装 template/ 的 Remotion（自带 ffmpeg）
npm link                 # 可选：全局提供 onevideo 命令
onevideo doctor
```

Linux 服务器（Debian/Ubuntu）另需 Chrome Headless Shell 的系统库和中文字体：

```bash
apt-get install -y --no-install-recommends libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 fonts-noto-cjk
```

深度图（可选，但动效引擎的主体感知都依赖它）需要 Python 3 + `numpy pillow onnxruntime` 和 Depth Anything V2 Small 的 ONNX 模型：

```bash
python3 -m venv /opt/onevideo-py && /opt/onevideo-py/bin/pip install numpy pillow onnxruntime
curl -L -o depth-anything-v2-small.onnx https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx
export ONEVIDEO_PY=/opt/onevideo-py/bin/python ONEVIDEO_DEPTH_MODEL=$PWD/depth-anything-v2-small.onnx
```

没有这两项时 `build` 跳过深度图，相关效果退回默认位置。

渲染并发默认按 CPU 核数和内存自动选（每 1.5 GB 内存一个，最多 4 个，2 GB 机器为 1）；需要时用 `--concurrency N` 或 `onevideo.json` 的 `render.concurrency` 覆盖。

TTS、生图、生视频和看片（视觉模型）都走 OpenAI 兼容接口，key 从环境变量 `MANGO_API_KEY` 读取，永远不会打印出来。接口地址、env 名和模型顺序分别在 `onevideo.json` 的 `tts` / `image` / `video` / `llm` 段配置，`onevideo doctor` 会列出当前生效的模型顺序。

## 快速开始

```bash
onevideo init my-video --example spacex-motion   # 动效示例（另有数据图表版 spacex-ipo）
cd my-video
onevideo status          # 各阶段状态 + 下一步该读的导演文档
onevideo validate        # schema + 门控
onevideo tts --sample    # 先试听一句
onevideo build           # tts → music → 素材/深度图 → timeline → render → qc
onevideo approve review  # 逐张看完 out/qc/frames/ 之后
onevideo publish         # 需要 review 已审批
```

成片位于 `out/<name>.mp4`，审阅帧在 `out/qc/frames/`，发布包在 `out/publish/`。

从零开始的项目用 `onevideo init my-video --pipeline data-explainer --style midnight-data`，再按 `onevideo status` 的提示逐个阶段推进。

## 作为 Claude Code Skill 使用

```bash
ln -s "$PWD" ~/.claude/skills/onevideo
```

之后对 Claude 说“帮我做一条关于 X 的视频”即可。`SKILL.md` 约定了工作方式：每个阶段先读 `stages/<id>.md`，交给用户审批，渲染后逐帧看图。

## 目录

| 路径 | 内容 |
|---|---|
| `cli/` | `onevideo` 命令，零 npm 依赖 |
| `template/` | Remotion 引擎（场景组件、风格、动效） |
| `pipelines/` | data-explainer / documentary / shorts / promo 的阶段定义 |
| `stages/` | 每个阶段的导演文档 |
| `styles/` | 视觉风格 token |
| `schemas/` | 项目与各 plan 产物的 JSON Schema |
| `references/` | 中文写作、TTS 读音、数据可信、授权、场景、动效、QC 阈值 |
| `examples/` | `spacex-motion`（动效引擎示范）、`spacex-ipo`（数据图表版）、`promo-demo`（产品宣传：capture + device） |
| `tests/` | `npm test`（node:test） |

## 许可

MIT。本项目的阶段化与导演文档思路参考了 [OpenMontage](https://github.com/calesthio/OpenMontage)（AGPL-3.0），但没有包含它的任何代码或文本，全部重新实现。
