# 阶段：review — 成片质检

**产物**：`plan/review.json`、`out/qc/frames/` · **需审批**

## 自动检查（`onevideo qc`）

| 检查 | 失败条件 |
|---|---|
| video-codec / resolution / fps | 与时间轴不符 |
| duration | 偏差 > 0.5s |
| loudness | 偏离 -16 LUFS 超过 ±2（warn）/ ±4（fail） |
| true-peak | > -1 dBTP（warn） |
| silence-in-narration | 旁白区间内出现 > 1.2s 静音（丢句） |
| dead-air | 旁白区间外的长静音（warn） |
| black-frames | 中段出现 > 0.6s 黑场 |
| frozen-segments | > 8s 画面无变化（warn） |
| static-ratio | 近静止采样占比超过上限（warn） |

阈值可在 `onevideo.json` → `qc` 覆盖，见 `references/qc-thresholds.md`。

## 人工检查（必须做）

逐张查看 `out/qc/frames/`（每场景 60% 处一帧）：

- 文字是否溢出、被字幕遮挡、与图形重叠
- 数字与旁白是否一致、格式是否统一
- 字幕是否与画面数字冲突
- 片尾来源是否完整

再完整播放一遍成片，听：读音、停顿、音乐压低是否自然。

## 看节奏（`onevideo sheet` / `onevideo look`）

- `onevideo sheet`：把成片按每秒一格（长片自动放宽）铺成联系表 `out/qc/sheet-NN.jpg`，并输出每个场景从第几格开始。一眼就能看出哪里画面停住了、哪里文字撞在一起、哪里构图或转场重复。
- `onevideo look`：请视觉模型按剪辑标准逐张联系表审片，意见写进 `out/qc/look.json`，每条带时间点、场景、严重度和改法。`--focus` 可以指定重点（例如 `"字幕可读性"`），`--models` 可以换模型。
- look 的意见是第二意见：先在联系表上或用 `onevideo stills --scene <id>` 确认问题存在，再改分镜；确认不是问题的意见可以忽略。
- “画面静止/无变化”和“出现太晚/没出现”两类意见会自动对照时间线：那段时间里其实每 3 秒内就有 cue/机位/叠层变化，或者对应元素就在之后 3 秒内按词出现，这条意见标 `?` 并写出时间线上的事件（`look.json` 里 `check.doubtful`）。带 `?` 的多半是联系表抽帧没抓到，先看 stills 再决定。“太暗/太亮/明暗反差突兀”在实际帧上量：太暗、太亮跟全片亮度中位数比，反差跟上一场景结尾那帧比，量出来不成立的同样标 `?`。
- 每张联系表默认由两个模型各看一遍（`--passes 2`，第二遍从模型表的下一个开始）：分数取中位数，意见合并，前面标 `[2/2]` 的是两个模型都提到的，`[1/2]` 的只有一个提到，分量更轻。`--passes 1` 省一半调用。

## 版本和对比（`onevideo versions` / `sheet --vs`）

- 每次 `render` 都存成 `out/versions/v<N>.mp4`（draft、part 带后缀），记在 `out/renders.json`：时间、范围、时间轴哈希、`--note`。`out/<name>.mp4` 等常用文件名总是指向最新一版。默认保留最近 8 版的文件（`render.keepVersions`），更早的只留记录。
- `onevideo versions` 列出所有版本；`sheet` / `look` / `qc` 都可以用 `--video v3`、`--video prev` 指定看哪一版。
- `onevideo sheet --vs prev`：联系表每格上面是旧版、下面是新版，同一时刻对齐（局部渲染按它在时间轴上的起点对齐），改了什么、改好没有一眼可见。
- 不确定新版是不是更好时，用对比表说话，不要凭记忆判断。

## 结论

verdict 为 fail 时修复后重新渲染；warn 需逐条说明是否接受。全部确认后：`onevideo approve review`。
