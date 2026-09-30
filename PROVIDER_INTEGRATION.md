# WhalePet 状态来源

## 桌面版

桌面 WhalePet 有三个完全独立的状态通道：

- `runtime/state-chatgpt.json`
- `runtime/state-deepseek.json`
- `runtime/state-custom.json`（可在控制室中设置显示名称）

右键 WhalePet，在“状态来源”中选择 ChatGPT 或 DeepSeek；也可以按 `Ctrl+Alt+P` 切换。当前选择保存在 `runtime/settings.json`，重启后保持不变。

2026-09-19：右键「小鲸的控制室 → AI 接入」新增自定义 AI 来源，提供可复制的 Python / JSON 本机 UDP 示例。外部 AI 的适配器可用 `node set-whalepet-state.js --provider custom thinking "正在思考"`，并在完成时发送 `ready`。AI 必须实际发出事件；重命名标签不会建立连接，普通网页聊天也不会因此被自动监听。界面会显示最近一次桥接消息时间与实际渲染状态。

写入 ChatGPT 状态：

```powershell
node set-whalepet-state.js --provider chatgpt connecting "正在连接网络"
node set-whalepet-state.js --provider chatgpt thinking "正在认真思考"
node set-whalepet-state.js --provider chatgpt tool_use "正在调用工具"
node set-whalepet-state.js --provider chatgpt testing "正在检查结果"
node set-whalepet-state.js --provider chatgpt generating "正在生成内容"
node set-whalepet-state.js --provider chatgpt working "正在认真回答你"
node set-whalepet-state.js --provider chatgpt ready "回答完成啦！"
```

状态命令会同时写入项目状态文件，并通过只监听 `127.0.0.1` 的本机实时桥发送给已经安装的桌面 WhalePet。命令显示“桌面小鲸已收到”时，代表安装版已经确认接收，不再依赖两个目录里互不相通的状态文件。

写入 DeepSeek 状态：

```powershell
node set-whalepet-state.js --provider deepseek searching "DeepSeek 正在搜索"
node set-whalepet-state.js --provider deepseek needs_input "DeepSeek 需要你的回答"
```

## 自动跟随本机 Codex

独立桌面版默认开启右键菜单中的“自动跟随本机 Codex 任务”。选择 ChatGPT 来源后，小鲸会只读监听本机 Codex 新增的任务事件，不再只依赖代理主动执行状态命令。思考、读文件、调用工具、修改文件、测试、生成图片、需要回答和完成会映射到已有姿势；无法区分的工具显示通用工具状态。不会把普通工具调用误称为连接 Wi-Fi。

监听目录默认是 `%USERPROFILE%\.codex\sessions`，尊重 `CODEX_HOME`；只增量读取，并限制每次读取量，避免载入巨大历史记录。新任务发现可能延迟约 10 秒；已发现会话通常每 500 毫秒检查一次，不等同于当前聚焦的窗口。

### 多会话与双泡泡（2026-09-30）

卡住时可右键小鲸 → **重新读取 Codex 状态**，或控制室 → **AI 接入** → 同名按钮。它重新扫描最近本地日志、重建监听缓存，并立即同步姿势（退出本地预览），不重启小鲸或修改对话 / 外观。只在 ChatGPT / Codex 来源且自动跟随开启时可用；重复点击合并处理，读取失败保留原状态。仍受下述 24 小时 / 256 KiB 日志范围限制，未解除的真实求助会继续显示；它不是强制清空等待提醒。“更新显示”仅更新控制室读数。

- 姿势优先级：需要回答 / 权限确认 → 任务遇到问题 → 短暂完成庆祝 → 有新事件的工作 → 状态待确认的普通任务 → 待机。同等级保留当前会话，避免每次日志更新都抢姿势；该会话降级或结束时重新选择。
- 只显示正在进行（含等待回答、遇到问题）的会话，最多两个泡泡。每个泡泡绑定具体会话，状态变化时保持原位置；实心圆标记当前主姿势来源，不以左右位置表示优先级。黄色表示需要你回答，红色表示遇到问题。标题来自只读本地 `session_index.jsonl`，不可用时显示稳定的会话短编号，不读取正文当标题。关闭“显示气泡”会同时隐藏它们；切换其他 AI 或关闭自动跟随时清空。
- 已观察到的进行中会话完成时，它的泡泡原地变绿约 3 秒后消失；小鲸同期做完成姿势，然后回到仍进行的会话。最终回复和任务完成事件不会重复延长庆祝。所有任务结束后不保留待机泡泡；取消不是完成，不显示绿色庆祝。历史完成记录不会在启动时冒出旧泡泡。
- 求助或错误始终优先于庆祝；有紧急情况时，完成的会话仍可短暂显示绿色泡泡，但不会抢占小鲸姿势，之后也不补播过期庆祝。任务重新开始会立即撤销该会话的完成提示。
- 异步提问的工具确认回执不等于用户已回答。后台继续思考、工具调用或输出最终文本不会盖掉未答提醒；同会话的新用户消息、明确答复 / 取消或新的任务开始会解除。同步问题按对应调用 ID 的结果解除，其他工具结果不影响它。
- 普通活动 15 分钟无事件后标记“状态待确认”（虚线边框），不把沉默当作完成；保留最后已知姿势，新工作可优先显示。求助和错误超过 24 小时也会标记待确认，但仍保留紧急优先级。新事件自动恢复可信状态；明确完成 / 取消才解除未结束记录，只有终止记录会自动清理。因此废弃且没有终止事件的会话可能持续待确认，不能据此断言它仍在运行。
- 以上保留仅适用于本次监听已观察到的记录，不跨重启持久化。重启时仍只检查最近 24 小时有修改的日志尾部（每份最多 256 KiB），不能保证恢复尾部之外或更早的历史任务；关闭跟随、日志删除 / 替换也会重置相应监听状态。
- 两张紧凑卡片总宽从 300 缩至 248 逻辑像素，单卡约 36 像素高；标题过长时省略。泡泡与小鲸共用窗口缩放，75% / 100% / 150% 按相同比例变化，不额外二次缩放。超出两个的未结束任务显示“另有 N 个进行中”；其中有待确认任务时改为“另有 N 项 · X 待确认”，不将未知状态冒充正在工作。短暂完成不计入隐藏的进行中数量。
- 普通状态桥的“工作 / 完成”不能覆盖另一个 Codex 会话的求助或错误；AI 待机唱歌模式额外检查所有已观察到的未结束任务（含未展示及待确认任务），有任何一个存在就不启动待机倒计时。该保护不改变用户主动试听或另选系统 / 桌宠静置模式的含义。
- 这不是连接现有桌面 App Server 的事件订阅；本地日志可能不记录某些弹窗或只用普通文字提出的问题，这些不能保证识别。实现核对了[官方 App Server 的按会话审批 / 问题解除语义](https://learn.chatgpt.com/docs/app-server#approvals)，没有创建新 Codex 会话或接管已有会话。

回归验证：`npm run test:multi-chat` 覆盖并行状态、紧急抢占、异步问题、答复、错误恢复、状态桥冲突、标题、两泡泡更新、75% / 100% / 150% 布局、绿色完成退场、庆祝后恢复另一任务、全部结束无泡泡、重复完成、取消以及关闭 / 重启监听。`npm run test:music-dance` 覆盖连续小尺寸位移和静音播放生命周期。

此适配器依赖本地任务记录的事件结构，是尽力兼容的适配，不是稳定的官方事件接口。它不读取认证文件，不保存或上传提示词、回复或工具输出。可随时关闭自动跟随，继续使用手动状态桥。DeepSeek Harness 固定版不启用此监听。

**范围限制：此功能跟随 Codex 本地任务，不包含浏览器 ChatGPT 或普通 ChatGPT 桌面客户端。** 后两者需要另外的状态接入。不能从本地 Codex 记录推断这些客户端的内部工作状态。

诊断：本机 UDP 桥接受 `whalepet-status` 查询，返回后台状态 `state`、渲染回执 `renderedState` 和监听器状态 `follower`。收到手动桥 ACK 只代表接收成功，不代表已经显示；自动跟随回归测试 `npm run test:follow-renderer` 直接验证事件到页面姿势的完整链路。

## DeepSeek Harness 版

Harness 插件继续只代表 DeepSeek，不加入 ChatGPT 切换。若以独立窗口模拟 Harness 固定模式，可运行：

```powershell
npm run start:deepseek-harness
```

这个启动方式锁定 DeepSeek 来源，右键菜单只显示“DeepSeek（固定）”。
