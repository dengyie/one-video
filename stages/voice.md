# 阶段：voice — 配音

**产物**：`plan/timings.json`、`public/audio/*.wav`

## 步骤

1. `onevideo tts --dry`：打印每行的切分、停顿类型和实际读法（lexicon 替换后）。检查英文缩写、数字读法。
2. `onevideo tts --sample`：只合成第一句，给用户试听，确认音色和语速。声音只有用户能判断：拿不准时用几个 `design` 描述各出一段，让用户挑。
3. `onevideo tts`：逐句合成。按内容哈希缓存，只改一句就只重合成那一句。
4. `onevideo validate`：rate 门检查每场景语速（3.5–6.2 音节/秒）。偏慢先设 `tts.tempo: "auto"`，仍慢再换说话人（`tts --audition`，报告里有每个候选的实测语速）。

## 配置（`onevideo.json` → `tts`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `model` | `mimo-v2.5-tts` | OpenAI 兼容 `/audio/speech` |
| `voice` | `mimo_default` | 预置音色；默认音色播音腔重，讲故事、纪录片优先用下面的 `design` |
| `design` | — | 描述说话人（年龄、嗓音、说话方式，写明“不是播音腔”），voicedesign 模型据此生成一段参考音（按描述缓存在 `public/audio/lines/voice-*.wav`），之后每个场景由 voiceclone 模型用这个声音朗读；改描述即全片重合成 |
| `ref` | — | 项目内一段 5–30 秒的 WAV 录音，直接克隆这个声音（与 `design` 二选一；换录音时改文件名） |
| `style` | — | 语气指示（chat 协议的 user 轮），如“讲故事，自然口语，紧张处压低” |
| `tempo` | — | 合成后变速（保音高，WSOLA）：`"auto"` 逐场景实测语速，把最慢的场景拉进 rate 区间、且不让最快的超上限，全片用同一个倍率（×0.85–1.35）；数字如 `1.2` 直接按倍率。design / ref 声音的语速跟着被模仿的说话人走，`style` 里写“语速偏快”几乎拉不动，慢就用它。只改时间轴哈希、不重合成 |
| `baseUrl` | `https://api.mangoqwq.com/v1` | |
| `keyEnv` | `MANGO_API_KEY` | key 只从环境变量读取、不打印；`~/.zcode` 的 provider 配置仅在显式 `ONEVIDEO_ZCODE_PROVIDER=1` 时读取 |
| `speed` / `instructions` | — | 透传给模型 |
| `pause` | `{sentence: 0.32, clause: 0.16}` | 句间/逗号停顿秒数 |
| `syllablesPerSecond` | 4.8 | budget 门的估算语速 |

## 读音问题

见 `references/tts-pronunciation.md`。单行修正用 `lines[].speak`，全局修正用 `lexicon`。修改后 `onevideo tts` 只会重合成受影响的行。
