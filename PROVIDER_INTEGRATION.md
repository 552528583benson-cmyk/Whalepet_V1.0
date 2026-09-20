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

监听目录默认是 `%USERPROFILE%\.codex\sessions`，尊重 `CODEX_HOME`；只增量读取，并限制每次读取量，避免载入巨大历史记录。多个任务并行时优先显示最近有活动的未结束任务，不等同于当前聚焦的窗口。新任务发现可能延迟约 10 秒；持续无事件 15 分钟后状态过期。

此适配器依赖本地任务记录的事件结构，是尽力兼容的适配，不是稳定的官方事件接口。它不读取认证文件，不保存或上传提示词、回复或工具输出。可随时关闭自动跟随，继续使用手动状态桥。DeepSeek Harness 固定版不启用此监听。

**范围限制：此功能跟随 Codex 本地任务，不包含浏览器 ChatGPT 或普通 ChatGPT 桌面客户端。** 后两者需要另外的状态接入。不能从本地 Codex 记录推断这些客户端的内部工作状态。

诊断：本机 UDP 桥接受 `whalepet-status` 查询，返回后台状态 `state`、渲染回执 `renderedState` 和监听器状态 `follower`。收到手动桥 ACK 只代表接收成功，不代表已经显示；自动跟随回归测试 `npm run test:follow-renderer` 直接验证事件到页面姿势的完整链路。

## DeepSeek Harness 版

Harness 插件继续只代表 DeepSeek，不加入 ChatGPT 切换。若以独立窗口模拟 Harness 固定模式，可运行：

```powershell
npm run start:deepseek-harness
```

这个启动方式锁定 DeepSeek 来源，右键菜单只显示“DeepSeek（固定）”。
