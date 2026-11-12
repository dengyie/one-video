# 阶段：script — 旁白脚本

**产物**：`plan/script.json`（schema：`schemas/script.schema.json`） · **需审批**

脚本是整条视频的时间轴来源：TTS 逐句合成，每句的实测时长决定字幕和场景长度。

## 结构

```json
{ "title": "…", "summary": "…", "lexicon": { "SPCX": "S P C X" },
  "scenes": [ { "id": "hook", "beat": "hook", "question": "凭什么值一万多亿？", "chapter": "可选章节名", "narration": "…", "claims": ["fact-id"] } ] }
```

- `id`：小写短横线，和 storyboard 一一对应。
- `narration`：整段旁白；按句号/逗号自动切成字幕行（16:9 每行 ≤22 字宽，9:16 ≤13）。需要精确控制时改用 `lines: [{ "text": "…", "speak": "读法", "pause": "sentence|clause" }]`。
- `question`：这个场景回答的观众问题，用观众自己的话写（来自 proposal 的结构）。旁白第一句就要接住它；缺 `question` 的旁白场景 validate 会警告。
- `claims`：本场景引用的 fact id，方便审稿时核对。
- `search`（可选）：这个场景找素材用的英文检索词，如 `["Jensen Huang GTC keynote", "NVIDIA Santa Clara headquarters"]`。`onevideo assets suggest` 优先用它，没写的场景由模型补。
- `chapter`：出现即生成一个章节标记（publish 阶段写入简介时间戳）。
- 没有旁白的场景（片尾来源）只写 `id` + `beat`。

## 写作要点（详见 `references/writing-zh.md`）

- 口语短句，一句一个信息点；数字前加“约”时，research 里也要是约数。
- 写给耳朵听：念出来不顺的句子要重写。少用书面连接词（“与此同时”“综上所述”），能说“因为”就不说“鉴于”。
- 旁白负责解释，不负责念画面上的字：画面上会出现的标题、数字标签，旁白换个说法讲它的意思（见 storyboard 的“三条线”）。
- 数字写法与 research 的 claim 保持一致（`857亿美元`），门控按字面匹配。
- 英文缩写放 `lexicon` 定读法（`IPO → I P O`）；`%` 自动读作“百分之”。
- 每个场景 8–20 秒为宜；超过 25 秒且没有 cue 会被 pacing 门警告。

## 门控

`onevideo validate` 会检查：numbers（旁白数字有出处）、captions（行宽）、budget（估算时长 vs targetSeconds，±12% 警告 / ±25% 报错）、question（旁白场景缺观众问题时警告）。

审批：`onevideo approve script`。
