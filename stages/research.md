# 阶段：research — 事实底稿

**产物**：`plan/research.json`（schema：`schemas/research.schema.json`） · **需审批**

视频里每一个数字、每一句断言都要能追溯到这里。脚本阶段只能引用这里已有的事实。

虚构故事（寓言、剧情短片）没有要溯源的事实：在 `onevideo.json` 写 `"fiction": true`，本阶段变为可选（status 显示 ◌ optional），numbers 门控不再提示缺 research.json。故事里引用了真实数据时，照常写 research.json，门控照常核对。

## 做什么

1. 把选题写成一个**可回答的问题**（`question`），例如「一家造火箭的公司凭什么值一万多亿美元？」。问题决定取材范围，不相关的数据一律不收。
2. 定 `asOf`（数据截止日，`YYYY-MM` 或 `YYYY-MM-DD`）。涉及“当前”“最新”的数据，以此为准。
3. 检索。优先级：一手（公司公告、监管文件、统计局、论文）> 权威媒体（Reuters/Bloomberg/新华社…）> 聚合站。同一数字至少找一个一手或权威来源；只有聚合站来源时 `confidence` 标 `reported` 或 `estimate`。
4. 每条事实写成一个 `fact`：
   - `claim`：一句完整中文陈述，**数字用与旁白一致的写法**（`857亿美元`、`19%`、`2026年6月12日`）。门控按归一化字面匹配，`85.7 billion` 匹配不到旁白里的 `857亿`。
   - `value`/`unit`：机器可读的数值（图表用），如 `85.7e9` + `USD`。
   - `quote`：需要原话时放原文。
   - `source`：`title` 必填，尽量给 `url`、`publisher`、`date`。
   - `confidence`：`confirmed`（一手/多源一致）· `reported`（单一媒体转述）· `estimate`（推算/区间）。
5. 无法证实或相互矛盾的，写进 `openQuestions`，不要写进 facts。
6. 旁白里会出现、但不是事实的数字（“36年后”这类由日期推出的算术）放 `allowNumbers`，并在提案里说明来由。

## 门控

- `onevideo validate`：schema 检查；脚本写好后，`numbers` 门会核对旁白中每个多位数字是否出现在某条 fact 的 claim/value/quote 或 `allowNumbers` 中。
- 单个数字（0–9）不检查；百分比、金额、年份都检查。

## 交审

给用户看：问题、asOf、事实表（claim + 来源 + 置信度）、openQuestions。用户确认后：`onevideo approve research`。之后再改 research.json，状态变为 `stale`，需要重新审批。

## 常见错误

- 用记忆补数字。没有来源的数字一律不进视频。
- 把不同口径混在一起（名义 vs 实际、含/不含超额配售、财年 vs 自然年）。口径写进 claim。
- 时效：市值、估值、排名这类会变的数，claim 里写清日期。
