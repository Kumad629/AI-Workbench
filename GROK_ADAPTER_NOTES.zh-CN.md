# X 内 Grok 适配说明

日期：2026-09-22，版本：0.4.0。

## 范围与验证边界
- 面向用户主要使用的 X／推特内 Grok，支持 x.com/i/grok 及相同路径的 twitter.com；独立 grok.com 暂不支持。
- 浏览器工具报告无已连接浏览器，未检查用户真实 X 页面。模拟 DOM 测试验证算法和保存链路，不证明当前线上 DOM 必然匹配。
- 适配器仅提取页面 DOM；没有复制或执行第三方脚本，没有读取凭据或调用私有 API。

## 公开参考
- [Enhanced Grok Export 源码](https://github.com/iikoshteruu/enhanced-grok-export/blob/main/Enhanced%20Grok%20Export%20v2.4-2.4.1.user.js) 使用 message-bubble 和 response-content-markdown 等选择器；它的宽泛 DOM 兜底及按内容猜测角色不直接采用。这里只作为结构线索，不作为真实 X 当前版本的证明。
- [grok-smuggler 的格式与入口说明](https://github.com/501Not-Implemented/grok-smuggler) 展示 X Grok 的 conversation 网址参数。本项目保存时保留该标识；未采用该项目的会话 API 抓取方式。

## 本项目处理
- 限定当前页面主体，剔除导航、侧栏、独立推荐推文节点和操作按钮。嵌套正文只算一条消息。
- 使用明确角色标记和正文结构；不按字符长度、语言风格或问答奇偶顺序分配角色。无法判定的发言保留原文并标记。
- 正文链接转换为可保存的文字与网址，排除 javascript 等非 HTTP(S) 链接。图片只保留文字提示。
- 自动滚动复用 Gemini 的去重、补读、超时和局部结果提示；没有可靠消息结构时拒绝宣称完整，提供手动选中文字 / 页面正文预览作为备用。
- 桌面根据校验后的来源网址推导产品名，客户端不能通过传入 product 字段把 Grok 伪装成 Gemini。
- 首次真实页面验收应检查：角色、条数、首尾、引用推文链接，以及存档来源能否返回同一条 X 对话。

## 2026-09-23：真实结构适配（v0.4.5）

用户的 conversationOutline 显示网格 div.r-6413gk.r-uef6q5 第一列的第二个子元素为会话列表。直接消息行具有居中的 r-1awozwy.r-13qz1uu 包装层：
- 提问 frame：r-obd0qt.r-qn3fzs.r-11niif6，flex column / align-items:flex-end。首条引用卡片和末尾普通文字提问共用此结构。
- 回答 frame：r-1awozwy.r-16lk18l.r-13qz1uu，flex column / align-items:center。第一列 r-1wbh5a2.r-11niif6.r-bnwqim 内的直接 r-3pj75a 子元素包含 css-146c3p1.r-bcqeeo 正文；其兄弟节点为其他面板，frame 后续子节点是操作区。
- 按作用域、直接层级、类组合和实际布局共同验证，不使用奇偶顺序、回答长度或表格有无判定身份。
- tests/fixtures/grok-x-layout.json 只保留诊断中的无正文结构，用虚构内容重建引用卡片、提问、两种回答形态。自动化验证不能代替用户真实网页的最终核对。
