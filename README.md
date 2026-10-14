# WhalePet · 小鲸鱼桌宠

2026-10-14：已保存接入 Live2D 前的源码检查点，包含最新的隐藏探头、脸部拖拽、呆毛拉出与自动唱歌开关。此提交尚未加入 Cubism 播放器，也没有更新旧 Release ZIP；备份来源和测试范围见 [检查点说明](BACKUP-20261014-PRE-LIVE2D.txt)。

当前发布 **0.15.2 / 2026-09-30**：[使用指南](docs/USER_GUIDE.md)、[本次更新](docs/RELEASE-20260930.md)、[音乐与安静模式](docs/IDLE_SONG.md)。右键新增“重新读取 Codex 状态”，可重建状态缓存并同步姿势；不是强制清除真实的未答提醒。本文件后半是历史开发记录，不是当前安装教程。

2026-10-06 本地更新：点“重新读取 Codex 状态”时，小鲸会轻轻左右确认，实际显示同步后点一下头，并短暂显示结果。仍待你回答时明确写“已同步 · 仍等你确认”；读取或显示确认失败不会冒充成功。详见使用指南；旧发布包尚未包含此更新。

同日躲猫猫优化：隐藏呆毛圈内的空白也可点击，轮廓外再放宽 6 个逻辑像素并随大小缩放；周围透明留白与任务泡泡仍不拦鼠标。图片和呆毛裁切未改变。

探头时还可以按住呆毛（包括圈内空白）拖出小鲸：呆毛拉直，她保持正着，裙子和短腿从屏幕下沿逐渐露出；刚拎起时睁眼看你，持续拎住 3 秒后安心闭眼微笑。左右甩动会绕呆毛的抓握点产生惯性，停住鼠标后逐渐回摆；不是正常的拎尾倒挂。松手后留在新位置并继续跟随真实 AI 状态。轻点仍缩回，取消拖动回到探头。拖出过程不显示 AI 信息；专用透明姿势不覆盖原工作图片与个人设置。系统“减少动态效果”关闭惯性摆动，但仍保留表情切换。旧发布包尚未包含此动作。

想制作自己的角色？阅读 [从零制作你的小鲸鱼桌宠](docs/MAKE_YOUR_OWN_WHALEPET.md)，配合 [制作与发布验收单](docs/CREATOR_CHECKLIST.md)。[制作记录索引](docs/CREATION_INDEX.md) 区分当前做法和历史实验；本文件下方保留了部分旧版本开发记录。

WhalePet is a standalone Windows desktop pet built from the supplied movement design sheet. It has a transparent always-on-top window, can be dragged around the desktop, and changes posture when a local work-state file changes.

It does not need DeepSeek Harness, a vision model, a paid API, or a network connection at runtime.

## Start

Double-click `Start-WhalePet-Desktop.cmd`, or run:

```powershell
npm start
```

Controls:

- Drag the character to move it.
- Drag only the visible character. Speech and the state badge are visual decorations and never enlarge the mouse-interaction area.
- Press `Ctrl+Alt+W` at any time to cycle the pet through bottom-right, bottom-left and top-right safe corners.
- Press `Ctrl+Alt+H` at any time to hide or show the pet.
- Single-click makes the character respond with a small hop.
- Shift + click cycles through posture previews.
- Right-click for a small, flat quick menu with at most seven actions: settings, resize, hide/show, recovery, quiet mode, eligible Codex reload, and Quit. There are no submenus.
- In the control room's “AI 接入” page, choose the standalone AI provider, or press `Ctrl+Alt+P` to cycle providers.
- The dragged window position is restored after the next launch.
- Transparent pixels let mouse input pass through to applications behind the pet.
- The visible character always accepts clicks and drags. The old full-character mouse-passthrough setting and `Ctrl+Alt+L` shortcut were removed on 2026-10-05; saved passthrough preferences are automatically cleared.
- Speech bubbles automatically fold away; important input/error messages remain longer.
- The default window is 300×342, about 17% smaller than v0.4.0.

## 小鲸的控制室（右键设置）

右键小鲸 → **小鲸的控制室**。设置只保存在本机，原作素材不会被覆盖。

- **外观与大小**：65%–150% 等比例缩放、状态标签与气泡开关；右键打开控制室后直接进入此页。
- **姿势图片**：12 个状态分别导入 PNG / WebP（≤8 MB、边长 ≤4096），自动复制到本机、留边并对齐脚底。透明背景需要图片本身提供，不自动抠图；动图按静态图片处理。每个姿势都可预览、恢复。拖动表情与现有转场保留。
- **AI 接入**：保留 Codex 自动监听和 DeepSeek，新增可命名的 `custom` 通道。提供本机 UDP 地址、Python / JSON 示例、状态文件路径与接收诊断。其他 AI 需由脚本/事件回调发送状态；选择名称不等于自动连接。DeepSeek Harness 固定模式不显示 AI 切换。
- **恢复默认外观**：先确认，再恢复原作、大小和提示显示，不重置 AI 设置、不删除导入文件。

配置为运行目录下的 `runtime/preferences.json`，导入副本在 `runtime/custom-images/`；打包为正式 Electron 应用时使用应用的用户数据目录。请勿在分享安装包时混入个人 runtime 文件。端到端测试：`npm run test:settings`。

## 状态接入

The standalone pet now automatically follows local Codex task events by default. In the control room's AI connection page, select ChatGPT as the provider and keep “自动跟随本机 Codex” checked. This read-only, incremental adapter does not follow browser ChatGPT or the ordinary ChatGPT desktop app. See `PROVIDER_INTEGRATION.md` for its scope, timing and diagnostics. Existing artwork and motion are unchanged.

2026-09-30：多会话紧急优先，最多两张紧凑泡泡随小鲸同比缩放，多余任务显示数量；长任务 15 分钟没新事件改为“状态待确认”，不再静默消失或触发 AI 待机唱歌。别的会话更新不会盖掉求助。75% 唱歌舞步取消像素取整造成的停顿，保留固定大小和不旋转策略。详见 `PROVIDER_INTEGRATION.md` 和 `assets/whalepet-music/DANCE.md`。

控制室精细调节：外观页支持 65%–150% 的 1% 步进及数字输入（回车 / 离开输入框保存）；上方任务泡泡可另调相对大小 80%–120%、上下偏移 -20–30 逻辑像素，仍叠加小鲸的全局缩放。“只还原泡泡”不更改其他外观；关闭气泡会保留微调值。窗口可缩至 560 × 480，窄窗口自动单列并在内容区滚动；所有设置仍只保存在本机。

2026-10-02 陪伴操作升级（历史记录，鼠标穿透已于 10 月 5 日移除）：控制室、隐藏、找回、鼠标穿透和关闭唱歌成为常用入口。任务栏托盘使用原作小鲸图标，右键能打开同一套菜单，双击原位显示小鲸（图标可能在系统“隐藏的图标”里）。隐藏 / 显示及再次运行桌面快捷方式不再把她挪去角落；只有主动“找回”才移动，断开显示器后会校正到可用屏幕内。当日的子菜单布局现已由下述 10 月 4 日简化版替代。

当日鼠标穿透操作说明（历史记录，已于 2026-10-05 失效）：控制室的“陪伴与操作”页曾可开启“鼠标穿透”，让角色和 AI 泡泡继续显示、点击交给后方应用；曾可通过托盘、控制室或可用的 `Ctrl+Alt+L` 恢复互动。该开关与快捷键现已删除，旧的已保存设置会自动清除，小鲸本体始终可点击、拖动和右键。透明留白仍将点击交给后方应用。暂时隐藏、显示或找回会立即停歌并重新计时，不会切换你保存的自动唱歌开关。验证：`npm run test:companion`，测试实例不会创建真实托盘图标或占用你的快捷键。

2026-10-03 本地开发版新增“陪你做点什么”：控制室 → **陪伴与操作**，可以看她试敲 3 秒小键盘、手动陪玩，也可自行开启输入陪伴与选定游戏的前台跟随。自动检测默认关闭；只在本机临时判断按键活动和指定游戏是否在前台，不保存输入文字、按键代码或活动历史。新姿势由原作参考生成，使用真正透明 PNG；动画只在手部区域轻动，头、发箍和短腿固定，保留原有 AI 泡泡与紧急提醒。完整操作、隐私边界和限制见 [桌面陪伴说明](docs/DESKTOP_BUDDY.md)。验证：`npm run test:buddy`。这些是本地新增功能，尚未包含在上方 9 月 30 日发布包中。

2026-10-04 右键减负（历史记录，菜单已由下述 10 月 5 日版本替代）：角色和托盘都使用同一层菜单，最多 7 项，无子菜单、无预览/文件路径/会话列表等不常用入口。当日保留控制室、鼠标穿透、隐藏/显示、找回、关闭唱歌、可用时的 Codex 刷新及退出。控制室直接打开大小页；图片、游戏、音乐和 AI 来源在对应页面设置。当日保留原来的偏好、快捷键和任务泡泡；鼠标穿透及其解锁快捷键已于 10 月 5 日移除，找回入口继续保留。验证：`npm run test:companion`。

2026-10-05 找回与重载修复：右键新增 **调整大小 · 当前百分比**，直接打开大小滑块；同日移除鼠标穿透后，仍无子菜单、最多 7 项。重载现在保留长日志中的已知未答问题，在图片实际加载显示后才确认成功，并暂时让 AI 姿势优先于陪伴约 3 秒；拖动中会明确提示松手后同步。内部 guardian 审查任务按明确来源排除，不再抢普通会话的姿势或泡泡；不按名称猜测，因此用户自己命名为“Guardian review”的普通会话仍能正常跟随。不会清掉真实求助或你的陪伴设置。验证：`npm run test:companion`、`npm run test:reload`。

同日新增 **躲猫猫**，替代早先的文字找回面板：隐藏后小鲸小跑到当前显示器可用区域的下沿，钻进去只露蓝色呆毛；点呆毛探出脑袋，再点脑袋缩回。右键呆毛或脑袋 → **找回小鲸**，她跳出来回到原来的位置；控制室、托盘和原有快捷键也能找回。仅露呆毛时不显示任何 AI 信息；探头时只有最多两张任务泡泡与其余任务数量，没有状态徽标。后台仍跟随真实状态，但求助不强制让她现身。其他 AI 的活跃状态用简洁来源/状态泡泡表示，待机不显示泡泡。隐藏与探头都停止陪伴检测和音乐。沿用完整原图裁切，不重画或修改像素；支持 65%–150% 大小、显示器移除及系统减少动态效果。隔离测试覆盖动画、透明像素点击、快速切换、缩放、安静模式及状态恢复：`npm run test:companion`。

躲猫猫流畅度修复：小跑和跳回改用固定、完全不可点击的透明动画画布，角色的路程和 2–3 次轻柔小跳共用一条合成动画时间线。途中不再每 16 毫秒读取 / 移动 Windows 窗口，也不旋转或反复缩放角色，减少小尺寸下的整数像素顿挫。图片提前在隐藏画布中加载；跳回的最后一帧会保留到正常角色画面接上。快速反向操作从当时的位置继续，不回到旧起点；中途改大小或移除显示器会安全收尾，不丢失小鲸。画布始终让鼠标落到后方应用，只有移动结束才交接回正常可互动角色。`npm run test:edge-travel` 验证 65% / 75% / 100% / 150% 的连续亚像素位移、途中无原生窗口移动、取消、缩放、隐私及恢复；测试帧时序是隔离渲染器测量，不代表真实显示器 FPS。

隐藏呆毛裁切修复：屏幕下沿的裁切由原图第 347 行移到第 310 行，让两端根部藏在边缘下方，避免看起来像断环或露出旁边的黑色尖角。原画、发箍和探头后的完整脑袋不变；透明孔洞仍让鼠标穿过，蓝色呆毛仍可点击。`tests/peek-renderer-runtime.js` 检查 65% / 75% / 100% / 150% 及黑、深蓝、灰、白、棋盘背景。

点击恢复：可见且非拖动时，每 120 毫秒重新确认角色窗口内的鼠标位置，补偿 Windows 转发鼠标移动事件丢失及角色在静止指针下换姿势的情况；不保存位置、不检查其他应用。角色的透明空白仍释放点击，隐藏和拖动不被此检查干扰。旧的全角色穿透设置已从偏好、界面和快捷键中移除。

同日追加：会话泡泡只在任务进行中出现；完成时原位变绿约 3 秒，小鲸庆祝后继续跟随其他任务。全部结束后泡泡消失。求助 / 错误始终优先于庆祝，泡泡位置不随优先级来回交换。

Use the small local state bridge:

```powershell
node set-whalepet-state.js idle "待机中"
node set-whalepet-state.js connecting "正在连接网络"
node set-whalepet-state.js thinking "正在认真思考"
node set-whalepet-state.js reading "正在阅读文件"
node set-whalepet-state.js searching "正在搜索文件"
node set-whalepet-state.js tool_use "正在调用工具"
node set-whalepet-state.js working "正在处理文件"
node set-whalepet-state.js testing "正在检查结果"
node set-whalepet-state.js generating "正在生成内容"
node set-whalepet-state.js needs_input "需要你的回答"
node set-whalepet-state.js ready "工作完成"
node set-whalepet-state.js blocked "遇到问题"
```

The desktop pet keeps independent files: `runtime/state-chatgpt.json`, `runtime/state-deepseek.json`, and `runtime/state-custom.json`. The running pet watches only the selected provider. DeepSeek cannot overwrite ChatGPT's status, and ChatGPT/Codex cannot overwrite DeepSeek's status. The command also sends a localhost-only live message and prints `桌面小鲸已收到` after the installed pet acknowledges it, fixing the old source-folder/installed-folder split.

```powershell
node set-whalepet-state.js --provider chatgpt working "正在认真回答你"
node set-whalepet-state.js --provider deepseek searching "DeepSeek 正在搜索"
```

Repeated copies of the same state no longer restart the animation. Reading/searching/working states remain active for 2.5 seconds across short idle gaps, and the completion celebration returns to idle after its animation finishes.

Version 0.15.1 adds operation-level following for connecting, thinking, tool use, result checking and content generation while retaining all seven approved v0.15 postures. Five unused actions from the supplied movement sheet are normalized to the same 384px canvas and shared foot baseline. Connecting receives a soft Wi-Fi pulse, thinking receives three small thought bubbles, and generation uses the authored star-eye pose. The five operation characters are cut out with the free local ISNet Anime model and verified on deep-blue, black, grey and checkerboard backgrounds; authored surprise marks and sparkles are then restored with bounded warm-colour pixel masks. This preserves the complete white headband, transparent ahoge gaps, short legs and shoes without reintroducing source-paper pixels. Lossless WebP output keeps exact transparent RGB so Chromium scaling cannot expose hidden pale fringes. A localhost UDP acknowledgement bridge lets the installed pet receive project-agent status immediately without reading or scraping the ChatGPT window.

The 2026-09-02 detail pass applies that same free offline ISNet route to all eight dragging drawings. It removes the white source-paper wedges beside the lower hair, rebuilds transparent ahoge gaps without copying paper or pink guide pixels, restores the thin blue arcs for thinking/tool/generation, and gives the blocked pose short visible legs without changing the common state height. Every changed sprite is checked on deep-blue, black, grey and checkerboard backgrounds. The Chromium regression verifies all 17 static poses, all eight drag frames and 153 source-truth headband points; the pre-change files remain recoverable in `backups/reported-bug-fixes-before-20260902`.

Repeated clicks are rate-limited to one reaction every 650ms. The reaction uses the Web Animations API and does not force synchronous page layout, which prevents click-spam stutter.

Posture frames share a measured foot baseline, so standing, reading and crouching sequences no longer jump vertically when the picture changes. Key-pose changes use a short tuck-and-spring swap instead of overlapping two characters, avoiding double tails and costume ghosting. Late image-load callbacks are discarded during rapid state changes.

Version 0.4 adds 36 genuine in-between frames at 83ms per frame (about 12 FPS): standing to taking out the folder, opening the folder to read, and reading to throwing it aside and crouching to search. These frames are shown directly without crossfading. Supported reverse transitions play the same frames backward instead of snapping to idle.

Version 0.4.1 tightens generated-frame cutouts with a protected background threshold, two-pixel edge cleanup, soft alpha reconstruction and isolated-component removal. A four-color QA contact sheet is written to `work/generated-transition-cutout-qa.png` whenever the preparation script runs.

Version 0.4.2 fixes drag degradation after repeated moves. Pointer movement is coalesced to at most one window update per rendered frame, lost pointer capture and focus changes reset drag state, and mouse interaction remains available for 900ms after a drag so the pet can be grabbed again immediately.

Saved coordinates in the top-left 12-pixel corner are treated as unsafe and reset to the bottom-right on launch, preventing an old `(0,0)` position from covering primary controls.

Version 0.4.3 moves drag coordinate tracking into Electron's main process. It reads the native Windows cursor position, so browser DPI coordinates cannot accumulate error or shrink the reachable area. `npm run test:drag` repeats 100 four-corner cycles on both 1920×1080 and 1536×864 virtual desktops and checks immediate recovery from clamped edges.

Version 0.5 adds a dedicated eight-frame dragging loop based on both supplied design sheets. While being moved, the pet raises both hands, dangles her feet, sways her hair and whale tail, and changes from a tiny surprised face to a happy smile. Releasing the mouse restores the current work posture instead of changing the agent state. Every pointer press now also sends a matching drag-end reset, even when it becomes a click, preventing invisible stale drag sessions from making later grabs difficult.

Version 0.5.1 removes drag flashing by packaging the eight pictures as one transparent animated WebP instead of swapping two image layers every 92ms. While the mouse is held, Electron's main process now samples the native cursor every 16ms and moves only when its position changes. The drag is no longer cancelled merely because the transparent window briefly loses focus, so crossing other windows does not progressively weaken later drags.

Version 0.5.2 keeps WhalePet responsive while ChatGPT or another application is focused by disabling Chromium background throttling. Drag tracking now samples at 8ms, the pet uses the `screen-saver` always-on-top level during normal display and drag, and the eight unique drawings play as a 14-frame forward/reverse loop at 58ms per frame. A compositor-driven 720ms hanging sway fills the visual gaps without generating extra window moves.

Version 0.5.3 replaces the dragging artwork with a reviewed single-tail sheet and repairs costume consistency across all eight source frames. Dragging adds gentle squash/stretch at compositor speed, followed by a 520ms landing spring when released.

Version 0.5.4 removes intermittent blue triangle remnants beside the dragged pet. Drag frames receive an additional 800-pixel detached-component filter, and every animated WebP frame is encoded as an independent keyframe so transparent pixels cannot inherit fragments from the previous frame. `work/drag-animation-decoded-qa.png` verifies all 14 decoded playback frames.

Version 0.6 restores the original white headpiece and lace pixels that v0.5.3 incorrectly eroded. Detached-component cleanup is now restricted to generated drag frames. The standalone app adds persistent ChatGPT/DeepSeek source switching through the right-click menu or `Ctrl+Alt+P`; DeepSeek Harness remains locked to DeepSeek. See `PROVIDER_INTEGRATION.md`.

Version 0.7 fixes the expanding interaction-window bug. The native window is now constrained to 300×342, self-repairs after DPI or compositor size drift, and drag boundaries always use the canonical size rather than a corrupted live size. The renderer is also fixed at 300×342, while speech and the badge no longer participate in hit testing. Only opaque character pixels start a drag. Drag tilt is smoothed and key-pose swaps use a small Q-spring without overlapping silhouettes.

Version 0.8 is based on frame-by-frame review of the user's 15.74-second screen recording. A click now remains a click until the pointer moves more than 9px, so hand jitter cannot briefly enter the drag posture. Native window tracking starts only after that threshold. Idle breathing and click/landing reactions use separate transform layers, removing the end-of-motion size jump. Only one character image layer is ever visible. Dragging changes expression deliberately—surprised once, then a stable smile with an occasional blink—while a slower 880ms compositor sway supplies continuous motion instead of replaying the eight drawings as a low-frame-rate video. The recording also exposed a DPI repair storm: ordinary 301–304×343–345 Windows rounding is now accepted with an 8px tolerance, while pathological growth such as 1100×958 is still repaired.

Version 0.9 replaces the remaining PPT-like work-result swaps with three complete motion paths: work to completion (16 frames), work to waiting for input (12 frames), and work to blocked (12 frames). Their reverse routes reconnect waiting/error poses to reading or working naturally. Every stable result state reuses the exact final transition frame, eliminating the post-animation size snap. Generated characters are normalized to the same head center and foot baseline, while a stricter detached-component pass removes effect marks without deleting the folder prop or white headpiece. Window creation, dragging and repair now share one outer-window coordinate system; a 40-toggle mouse-pass-through stress check no longer produces the former resize-repair loop.

Version 0.10 establishes one motion standard across every state: generated characters target a 172px main-head width, a 289px maximum body height and a shared 293px ground baseline. Measurement follows the largest connected character component, so a folder or small effect mark cannot accidentally rescale the whole pet. Stable reading/searching/working poses no longer replay old key-pose slideshows. A new latest-request queue lets the current action finish before starting the newest requested state instead of cutting two actions together. Drag squash/stretch is reduced below one percent around the canonical scale, keeping the pet Q-soft without visibly growing and shrinking.

Version 0.10.1 borrows the successful drag-animation model for every state transition. Illustrated key poses now use 104–108ms ease-in/ease-out timing while a separate compositor layer supplies continuous 60Hz weight shifts between them. All 42 directed state pairs have an explicit forward or reverse route, including work/search and every route leaving the completion pose. Preview and completion timers start after the illustrated action finishes, so they cannot cut it short. The window guard now accepts Windows 11's observed 9–10px transparent-border rounding instead of repeatedly resizing the pet during animation; pathological growth remains guarded.

Version 0.10.2 replaces the remaining 9–10 FPS key-pose playback with a reviewed hybrid 24 FPS pipeline. Each safe source-frame pair receives two locally generated DIS optical-flow in-betweens, producing 34 frames from a 12-frame action and 46 from a 16-frame action. Three large-motion pairs that distorted the face, headpiece or tail are explicitly excluded and use untouched endpoint art plus the 60Hz compositor bridge. Runtime keeps all approved frames predecoded in memory, eliminating first-play disk/decode stalls. The motion stress test now observes 81 distinct rendered frames instead of 27 while retaining exactly one visible character layer. Window repair is based on the stable renderer content size rather than Windows' fluctuating invisible outer frame.

Version 0.10.3 changes the animation model from timer-driven image flipping to a display-synchronised timeline. Drawings now use a calmer 58ms exposure (about 17 FPS), while every sequence is normalized from its first standing pose to a 270px character height. A hair-based visual anchor holds the head in one horizontal position, and the compositor no longer alternates left/right rotation during posture changes. Stable state images reuse the normalized final transition drawing, preventing a last-frame size snap. Detached thrown-folder fragments are removed once separated, transparent RGB is cleaned below the visible threshold, and motion QA now observes 111 distinct rendered frames with exactly one visible character layer.

Version 0.11 follows a frame-detail audit of every generated headband and tail crop. The audit proved that several in-between drawings already contained missing white ruffles and a tail that disappeared, reappeared or changed length; playback timing could not repair damaged anatomy. Runtime therefore no longer plays full-character optical-flow sequences. Each state uses one intact pose taken directly from the user's original movement sheet, and a 920ms compositor-only tuck-and-settle motion hides the single pose swap at maximum squash. This mirrors the successful drag animation: the bitmap remains structurally stable while the monitor compositor supplies continuous motion. Runtime preloading falls from hundreds of generated drawings to ten approved images, with exactly one visible character layer.

Version 0.11.1 fixes two pose-standard issues found in the user's 17.4-second recording. Working now uses the clean complete standing folder pose 12 with both legs visible instead of the low seated inspection pose; pose 13 was rejected because its source crop contains a detached yellow speck. All upright states are normalized from their measured transparent content bounds to the idle pose's 279px character height and remain pinned to the foot baseline; deliberately crouching search/error poses are not stretched. Reading, working, searching, waiting and completion also receive separate low-amplitude compositor loops, adding movement detail without changing the bitmap anatomy.

Version 0.11.2 fixes the actual cause of the repeated entry-height dip: the shared transition bridge compressed every pose vertically to 95.5% before swapping. Pose transitions now stay within 99.2–100.8% scale, matching the safe drag-animation range, and express weight mainly through vertical translation. A regression test inspects every compositor keyframe and fails if either axis leaves that range.

Version 0.11.3 makes the non-drag motion rule stricter: every posture-transition and state-idle keyframe remains at exactly 100% dynamic scale. Q-soft weight is expressed only through small vertical displacement and easing. Drag retains its established squash/stretch because that interaction was explicitly accepted. Static per-pose source-sheet calibration remains bottom-anchored and constant for the entire lifetime of each pose.

Version 0.11.4 fixes the remaining one-frame hitch identified in the user's 14.85-second recording. The previous pose bridge stopped a 360ms animation, waited for its completion promise, swapped the bitmap, and then created a second 560ms animation. It is replaced by one uninterrupted 920ms compositor animation sampled from a damped spring at 61 points. The bitmap swaps once at the spring's fast centre crossing (38% progress), monitored with `requestAnimationFrame`; it no longer sits on a turn-around frame while JavaScript constructs the second half.

Version 0.11.5 makes `needs_input` visually unmistakable. The former closed-folder pose was too similar to the reading pose, so the state now uses the original design sheet's crouching, both-hands-reaching pose. The corrupted generated alternative with large right-side colour blocks remains excluded from runtime.

Version 0.11.6 fixes a live Windows DPI repair storm discovered while capturing the new `needs_input` pose. At fractional scaling, the transparent renderer fluctuated by 2–3px; the guard used a 2px content tolerance and repeatedly forced the outer window back to its launch bounds. Runtime now uses the shared 8px tolerance, while drag-soak regression checks forbid restoring the unsafe 2px rule. Large pathological window growth remains repaired.

Version 0.11.7 repairs the white headband directly in the original runtime assets. A four-background audit exposed page-white holes in poses 01, 05, 12 and 15 that were invisible on the source sheet but obvious over games and dark windows. The local deterministic repair copies only reviewed ruffle pixels from the supplied movement sheet; it does not regenerate the character or modify her face, hair, costume or silhouette. `npm run test:headband` guards the repaired pixels after Electron decodes the WebP files, and `work/headband-repair/active-pose-background-audit.png` checks every active pose on navy, blue, pink and white.

Version 0.11.8 removes the opposite extraction defect: paper-white regions trapped inside the blue hair silhouette. All 17 poses are audited mechanically; a region is removed only when it is neutral page white, vertical between hair locks and surrounded by blue hair. Horizontal whale-ear fluff, the repaired headband, apron, eyes, socks and paper props remain opaque. The repaired contact sheet tests every pose across navy, cyan, pink and green, while `npm run test:transparency` decodes all 17 WebP files in Chromium and checks representative hair gaps. The motion QA also gains an `all-states` scenario for full state-cycle stress testing.

Version 0.11.9 fixes a second live transparent-window repair storm found during the full audit. Real Windows logs showed harmless 9–14px invisible-border rounding after repeated mouse-pass-through toggles, just beyond the former 8px tolerance. The guard now accepts up to 16px while still rejecting 20px and pathological growth. The 8ms drag loop no longer performs synchronous size inspection or repair; drag-start and the 750ms periodic guard retain recovery without burdening every pointer sample.

Version 0.12.0 replaces the faulty headband repair instead of layering another patch over it. The old source mapping was four pixels too high because it did not reproduce the extractor's 12px canvas margin. All 17 runtime poses are now reconstructed from the supplied movement sheet at the correct coordinates, with white ruffles preserved. White-page colour mixed into the side-hair antialias edge is pulled toward nearby blue hair while its original alpha and silhouette are retained; intentionally white ear fluff, apron, socks and paper props are protected. Poses with detached folder effects use a conservative no-hull path so no white triangle can be created behind the prop. The Chromium regression now checks 51 distributed interior ruffle points across all 17 poses. A clean non-drag Windows run stayed stable, but the later real drag recording proved that test did not cover repeated native movement.

Version 0.12.1 is driven by the user's 20.44-second `20260823-1341-30.9540071.mp4`. Frame measurement found the drag drawing grew from the idle silhouette's 217×306 pixels to as much as 265×359 pixels. The three active drag drawings now use separate bottom-anchored scales based on their measured transparent heights, reducing the actual rendered comparison to 222×327 idle versus 239×320 dragging; the remaining width is the deliberately extended whale tail. Native dragging now moves and reapplies the canonical window size in one 16ms compositor update instead of preserving an already-inflated Windows frame. Mouse pass-through changes receive one immediate and one debounced canonical-size stabilization. QA completed 20 real automated drags at exactly 302×346 content size and 24 production-timed pass-through toggles at exactly 304×342 for that launch, with no cumulative growth or repair loop.

Version 0.12.2 removes the remaining opaque white-page matte from the lower side-hair edges in all 17 original poses. Unlike the earlier alpha-only cleanup, this pass also detects fully opaque grey/white pixels touching both transparency and nearby blue hair: true paper crumbs become transparent, while mixed antialias pixels are recoloured toward the local hair colour without changing the silhouette. The rule is restricted to the side-hair boundary, protecting the white headband, whale-ear fluff, face, hands, apron, skirt lace, socks and folder props. `npm run test:transparency` now scans every decoded pose for both reopened hair gaps and excessive pale side-hair edge pixels.

Version 0.12.3 adds black-background inspection after a blue wallpaper proved too forgiving. A narrow per-row contour follows only the leftmost and rightmost blue-hair pixels, correcting the fully opaque grey page matte that remains visible on black without applying a rectangular edit over the character. Native-size previews now cover black, white, magenta, green and blue; crouching, paper-search and detached-folder poses are reviewed separately to protect hands and props.

Version 0.12.4 replaces the visual-threshold guess with a measured pixel model. The supplied movement sheet contains more than one million neutral page samples with a median of `RGB(253,253,252)`; the cleanup distinguishes that cluster from warm/purple character whites and protects the entire upper headband/whale-ear zone plus the central face, hands, costume and props. Side-hair gaps must be narrow vertical components with a strong blue-hair ring. The outer blue-hair contour uses standard colour-to-alpha inversion to recover transparency lost when antialias pixels were flattened onto the white page. Every pose receives a black-background render and a colour-coded classification mask before replacement.

Version 0.12.5 corrects the remaining flaw in that pass: v0.12.4 touched only a narrow extreme-hair region and therefore made almost no visible difference in the live pet. The new pass follows the complete main-character contour. For each boundary pixel it samples the nearest fully authored interior colour, solves the white-page compositing equation, restores the local blue/navy/skin hue and makes a sub-two-pixel inward matte adjustment. This removes the physical paper-backed ring while preserving every interior headband, whale-ear, apron, hand, book and paper pixel. All 17 poses are reviewed on black as a set; the completion pose is additionally rendered on black, white, magenta, green and blue before replacement.

Version 0.12.6 fixes the specifically identified paper-white island enclosed between the blue ahoge curl and the outlined white headband. Earlier passes incorrectly protected the whole upper-head region. The measured-palette pass now finds the neutral-paper component immediately below the top of the curl, removes that enclosed background plus only its disconnected antialias crumbs, and preserves the warmer lilac headband whites and their dark outline. Pose 16's source connects this island to outer paper-colour pixels, so it uses a verified local curve following the headband outline instead of widening the general classifier. Seventeen dedicated ahoge-gap coordinates are now decoded and tested in Chromium alongside the existing headband and side-hair checks.

Version 0.12.7 applies the same distinction to all eight generated dragging drawings. Their enclosed upper paper component is detected independently from the pink-shadowed headband below it, removed before the animated WebP is rebuilt, and checked over dark navy, Windows blue and magenta backgrounds. The Chromium transparency regression now covers the eight drag gaps and also confirms that a headband-outline point remains opaque in every frame. The repair is part of the transition preparation pipeline, so regenerating the drag sequence cannot silently restore the white patch.

Version 0.12.8 performs the final ahoge-edge matte pass on all 17 state poses and eight drag drawings. Instead of deleting a wider area, it estimates the nearby authored blue curl colour and reverses the original paper-white compositing equation for only the two-pixel antialias rim. Pale grey stored colours become blue foreground pixels with recovered partial alpha, while the white headband, lilac shading and dark shape line remain untouched. Dark navy and Windows-blue before/after crops cover every runtime frame. Chromium now limits both per-frame and aggregate pale ahoge-edge residue in addition to checking the transparent gap and opaque headband.

Version 0.12.9 extends that measured pixel treatment to every blue-owned outer contour in all 17 state poses and eight drag drawings. It recovers the local authored blue foreground and partial alpha only within about two pixels of transparency, leaving the existing pose, movement, headband, whale-ear fluff, face, costume, hands and props unchanged. Fully detached alpha crumbs of seven pixels or fewer are removed, while intentional folders, motion lines, smoke, exclamation marks, stars and flowers remain intact. Black and four-colour contact sheets cover every pose, and Chromium now rejects any regenerated asset that reintroduces those microscopic islands.

Version 0.13.0 rejects the v0.12.9 micro-component rule after the user's close-up proved that 2–21 supposedly disposable pixels per pose included real detached lace fragments. Runtime assets are restored from the v0.12.8 baseline, then the complete headpiece is rebuilt against the correctly mapped original movement sheet. Neutral paper connected to the outer page or to a reviewed point inside the blue curl becomes transparent; warm pink/lilac ruffle lines and enclosed neutral-white highlights below those lines are restored. The old pose-01 gap test point was itself a real ruffle pixel and is corrected to the actual paper centre. Chromium now checks 153 source-truth ruffle points, all 17 corrected curl-gap centres and all eight drag frames. The global blue-contour experiment is removed from every production regeneration path.

## Design-sheet processing

The first extraction pass used pixel thresholds, color projections, connected-background removal and grid order. After the user explicitly allowed visual inspection, a QA pass corrected crop boundaries, cross-cell fragments and transparent-edge color bleed. Version 0.4 then used the built-in image generator with both user-supplied design sheets as references to create three 12-frame transition sheets; version 0.5 adds an eight-frame dragging sheet; version 0.9 adds 40 natural result-state frames. A local reproducible script removes their checkerboard, detects all figures, separates the frames, and aligns head centers and foot baselines. Gemini and Google Vision were not used. See `DESIGN_ASSET_PIPELINE.md`, `work/prepare_generated_transition.py`, `assets/generated-transitions/natural-transition-prompts.md`, and `assets/design-whalepet/extraction-report.json`.

## Artwork note

The active posture frames are derived locally from the two design sheets supplied by the user. The older optical-flow sequences remain only as QA history and are not loaded by v0.11. Keep the project private unless the user owns or has permission to redistribute that artwork. The older openly licensed reference frames remain in `assets/licensed-whalepet` as a fallback but are no longer used by the desktop pet.

Engineering ideas compared against public MIT-licensed DeepSeek Harness pet plugins are documented in `THIRD_PARTY_REFERENCES.md`.
