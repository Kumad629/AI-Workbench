# YouTube 提问侧边栏适配记录

日期：2026-10-08。桌面 v0.13.0，扩展 v0.11.0。

## 需求与边界

用户需要保存视频右侧「提问 / Ask」的历史，约 30 条对话，不要求连接模型聊天。按 30 轮（60 条消息）设计验证余量。仅读取当前视频当前已打开面板；用户预览后主动保存。没有后台监听全部视频，不调用 YouTube 私有接口，也不触发发送、点赞或复制按钮。

YouTube 官方说明该体验使用 Gemini 模型但独立于 Gemini 应用：https://support.google.com/youtube/answer/14110396?hl=en 。工作台将其单独归为「YouTube 提问」。视频标题和规范化 watch?v= 链接作为来源保存，不假设 Gemini 历史会同步保存，也不能找回网页已不再提供的历史。

## 结构证据

browser-skill 连接检查未发现已连接浏览器，因此未读取用户账号 DOM。使用用户提供的视频 https://www.youtube.com/watch?v=subu-xHrp1w ，通过本机既有代理获取公开、未登录页面及官方前端脚本。完整脚本 URL、SHA-256、组件名称记录在 tests/fixtures/youtube-component-evidence.json；大型临时下载已删除，不增加产品依赖或安装体积。

官方脚本明确包含：

- 面板 ytd-engagement-panel-section-list-renderer；标识 engagement-panel-youchat / PAyouchat。
- 用户消息 yt-chat-user-turn-view-model，其正文在 .ytChatUserTurnViewModelTextContainer；这是已发出的提问，而非输入框。
- 回答 you-chat-item-view-model / yt-chat-item-view-model；正文 markdown-div / .ytwMarkdownDivHost；组件也可能包含操作、推荐卡片，因此仅取正文。
- 消息标识 data-target-id；输入区 yt-chat-input-view-model；加载状态 yt-chat-loading-view-model。

## 实现

browser-extension/youtube.js 在用户点击读取后注入，只依据可见面板 DOM 提取。找到唯一目标面板才读取；排除隐藏面板。保留正文的段落、标题、列表、代码及普通网页链接，剔除发送区、反馈按钮、建议问题和卡片外围内容。选中文字必须完全位于目标面板内。未识别结构时返回不含正文的诊断，不回退抓整页。

复用 history.js 的上扫、下扫核对和有重叠窗口合并。YouTube 的滚动容器限定在提问面板内，即使内容较短也不回退滚动整个视频页。保留重复消息，检查切换视频 / 关闭面板，保留停止后的部分预览；自动扫描最多约 3 分钟。网页没有提供历史总量，完成仍要求核对首尾。

来源校验仅接受 HTTPS 的 youtube.com / www.youtube.com /watch 加唯一 11 位视频 ID；剔除列表、时间及其他跟踪参数，拒绝伪装域名、凭据、端口、重复视频参数及非视频页面。正文中的时间链接另行保留。桌面根据 URL 判定来源，不信任扩展提交的产品标签。增加 youtubeAskCaptureV1 能力标记，旧工作台会明确提示重启新版。

存档仍走既有分批传输、校验、幂等保存与 SQLite 流程，不与其他会话自动合并。YouTube 发言标签加入存档显示解析，呈现用户 / 助手左右排版。没有接入网页聊天提供商。

## 使用与验收

重新加载浏览器扩展并重启工作台即可；提取脚本按需注入，用户已聊完的 YouTube 页面不需要刷新。保持侧边栏和视频标签页打开，点击「加载并读取历史对话」，核对预览，点击「保存到 AI Workbench」，成功后再关闭。

自动测试基于官方组件定义重建页面，覆盖 30 轮已加载问答、虚拟窗口、延迟加载、重复消息、隐藏/多面板拒绝、侧栏滚动隔离、局部选择、Markdown、取消和视频切换、短会话，以及扩展预览→实际本机桥接→工作台存档。公开脚本与测试不等同于用户账号实页验收；若账户页面变体未命中，应使用扩展「读取诊断」继续定位。

验证完成：构建成功，87 项核心测试、8 项 YouTube 专项、27 项既有 Gemini/Grok 提取界面回归通过。界面截图 artifacts/youtube-archive-preview.png 已检查，存档显示左右问答和独立来源。测试中无真实账号发问或用户数据库修改。
