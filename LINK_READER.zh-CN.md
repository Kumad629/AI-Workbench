# 网页 / PDF 链接读取

桌面 v0.17.0 为 API 聊天增加指定链接读取。它下载当前问题中的公开文档、在本机提取文字，再将提取文字交给所选模型。不是全网搜索，也不会使用用户浏览器的登录状态。

## 使用与范围

输入区「读取链接」默认开启；发送前先读取，失败则保留草稿、不发送。可取消，或关闭开关仅发原文。资料随消息保存，默认折叠并显示部分范围提示；复制、上下文和导出保留实际发送内容。此开关不改变网页账号聊天的联网设置。

最多三个不同链接；每个下载上限 20 MiB，约 45 秒，解析约 20 秒。总正文预算最多约 85,000 字符，按来源均分，长文或 PDF 达到预算会明确标注部分读取。PDF 上限 500 页，无 OCR、无图像理解，文字行不能保证准确还原表格列。网站登录、验证码、反自动读取、JavaScript 渲染和网络故障可能导致失败；不尝试绕过。

HTTP / HTTPS 下载采用 Electron net.fetch，credentials 为 omit，重定向手动逐次验证；DNS/IP 检查拒绝内网、回环及特殊地址，禁止凭据 URL 和非标准端口。校验不是专用网络沙箱，也不保证覆盖网络重绑定等全部情形。正文解析在有资源限制和时长限制的工作线程，不执行网页或 PDF 内脚本，不获取页面子资源，不向站点提供模型密钥。

本地 PDF 可通过「添加文件」输入，单个最多 10 MiB；本地文件沿用原字符上限且超限拒绝。网页资料只扫描当前问题的 URL，代码片段、文件内链接和旧历史不会触发下载。

## 依赖依据

- [Mozilla PDF.js](https://mozilla.github.io/pdf.js/) / pdfjs-dist 6.4.299，Apache-2.0；使用本机字节及随依赖分发的字体、字符映射。API 参数依据安装包 types/src/display/api.d.ts，解析在 Node 工作线程运行。
- [Mozilla Readability](https://github.com/mozilla/readability) 0.6.0，Apache-2.0；依据安装包 README 的 parse API，用不运行脚本的 DOM 提取正文。
- [LinkeDOM](https://github.com/WebReflection/linkedom) 0.18.13，ISC；本地 HTML DOM。
- [ipaddr.js](https://github.com/whitequark/ipaddr.js) 2.4.0，MIT；地址范围识别。

版本和完整性固定在 package-lock.json。解析库留在桌面侧，PDF 库按需加载；没有添加搜索服务、语音模型或浏览器扩展权限。

## 验证

114 项核心测试、22 项相关界面测试通过。链路使用隔离工作台、生成 HTML / PDF 夹具和本机模拟模型服务，确认模型请求实际含正文而不是仅含 URL。覆盖来源、范围、取消、DNS 等待、失败保护、重启保存及 PDF 文件读取，并回归原 MD / Office 和外观功能。

实网核验使用独立临时 Electron 环境，截图中的 SEC 财报网页、51 页 Q4-26-Earnings-Deck.pdf 与 W3C 公开 dummy.pdf 均读到文本；前两者按本次三来源均分的 28,333 字符预算显示部分读取。只记录 URL、成功状态、字符数、页数和范围，没有向真实模型发送内容。结果见 artifacts/link-reader/public-probe.json；1024×740 截图见 artifacts/link-reader/compact.png。真实网页访问结果受网络和站点策略影响，不等于持续可用保证。
