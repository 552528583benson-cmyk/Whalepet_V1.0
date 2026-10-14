# WhalePet 运行素材说明

当前发布使用本项目用户确认的 ChatGPT 图像生成辅助原创角色与高清姿势。其他桌宠仅用于工程思路参考，不包含它们的角色图片。

- `assets/whalepet-hd/*.png`：12 个高清工作姿势。
- `assets/whalepet-hd/idle-life/blink-source.png`：局部眨眼素材。
- `assets/generated-transitions/tail-hang/pose.png`：拎短尾倒挂姿势。
- `assets/generated-transitions/ahoge-pull/open.png`、`smile.png`：2026-10-06 本地新增的拎呆毛拉出姿势，采用用户确认并提供的睁眼 / 安心闭眼透明 PNG；两张图保持同一画布与抓握点，持续拖动 3 秒后切换表情，代码驱动绕呆毛的惯性摆动。不覆盖 12 个工作姿势，也不改动原来的拎尾倒挂。源码中的候选草稿和生成提示词不属于运行素材，分享包只带最终两张图与资产定位代码。
- `assets/whalepet-music/dancing-v1.png`：粉色双荧光棒音乐姿势；代码驱动整体摇摆，并非逐帧生成或独立手臂骨骼动画。
- `assets/whalepet-buddy/typing-v1.png`、`gaming-v1.png`：2026-10-03 本地新增的键盘 / 手柄陪伴姿势；以内置图像生成编辑工具参考本项目原作制作，真实透明像素。代码只对手部做局部变形，头部和腿保持固定；生成提示词在同目录 `PROMPTS.md`。不是第三方桌宠素材，也不是完整骨骼绑定动画。
- `assets/whalepet-v015/WhalePet.ico`：桌面图标（安装包置于根目录）。

源码另保留第一版 `listening-v1.png` 用于素材回归测试，不是当前默认音乐姿势。安装包不需要这张旧图。

歌曲、用户导入的图片和个人运行数据不随发布分发。音乐功能默认关闭，用户需自行导入有权使用的本地音频。

保留 `LICENSES/` 的既有第三方许可；它们仅适用于对应第三方内容，不自动为原创角色或整个项目授予统一开源许可。
