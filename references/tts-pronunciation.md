# TTS 读音与发音修正

字幕显示 `text`，TTS 念 `speak`。默认 `speak = speakable(text, lexicon)`；需要时可以逐行覆盖。

## 自动规则（`cli/lib/core/text.mjs`）

| 写法 | 读作 |
|---|---|
| `19%` | 百分之19 |
| `×3`、`x3` | 3倍 |
| `3~5`、`3–5`、`3-5` | 3到5 |
| `——`、`—` | ，（停顿） |
| `vs`、`vs.` | 对比 |

## lexicon

`onevideo.json` 或 `script.json` 的 `lexicon` 做字面替换，长词优先：

```json
"lexicon": { "SPCX": "S P C X", "IPO": "I P O", "xAI": "x A I", "Starlink": "星链" }
```

- 字母缩写用空格隔开逐个字母念：`"IPO": "I P O"`。
- 品牌名有固定中文读法的直接替换。
- 多音字用同音字替换：`"行长": "航长"`（只改读音，字幕不变）。

## 逐行覆盖

```json
"lines": [ { "text": "2026年2月合并xAI", "speak": "二零二六年二月，合并 x A I", "pause": "clause" } ]
```

`pause` 为 `sentence`（默认 0.32s）或 `clause`（0.16s），可在 `tts.pause` 调整。

## 流程

克隆或设计音色遇到 HTTP 503 时，CLI 会退避重试；仍不可用时默认报错，不会更换音色。若允许整片改用内置音色，可在 `tts` 中显式设置 `"fallbackVoice": "白桦"`。此设置不适用于 `--only`；整片重跑可避免混用两种音色。备用音色与克隆音色分别缓存，启用备用时 TTS 和成片 QC 都会警告，`plan/timings.json` 也会记录实际音色和原请求。

1. `onevideo tts --dry`：打印每一行的 `text → speak`，不调用 API。
2. `onevideo tts --sample`：只合成第一句，确认音色、语速、音量。
3. `onevideo tts`：批量合成。每句按内容哈希缓存，改一句只重合成那一句。
4. 发现读错：改 lexicon 或该行的 `speak`，重跑 `onevideo tts`。

## 响度

整段旁白统一乘一个增益，归一化到 `tts.loudness`（默认 −16 LUFS），峰值超过 −1.5 dBFS 时用软限幅压住。各场景之间的相对音量不变。结果写在 `plan/timings.json` 的 `loudness` 里。设为 `false` 保留 TTS 原始电平。

## 密钥

TTS 和图片生成使用 OpenAI 兼容接口（默认 `https://api.mangoqwq.com/v1`；环境变量 `ONEVIDEO_API_BASE` 可把它换成同一中继的其他入口，例如内网地址）。key 的读取顺序：环境变量 `tts.keyEnv`（默认 `MANGO_API_KEY`），然后是本机 provider 配置（仅当显式导出 `ONEVIDEO_ZCODE_PROVIDER=1` 时读取 `~/.zcode`）。脚本从不打印 key；`onevideo doctor` 只显示它来自哪里。
