# 聊天文件读取说明

桌面 v0.17.0 在本机将常用文件提取为文字，再随问题发送。原始 Office 二进制不会通过此功能上传或存入聊天；提取文字会随用户选择的发送操作交给相应模型并保存到本地消息。

## 范围与限制

- TXT、CSV、TSV：UTF-8、带 BOM 的 UTF-16；UTF-8 解码失败后尝试 GB18030，并在预览旁提示。MD / Markdown / MDown 使用 UTF-8。
- DOCX：正文、普通表格及页眉页脚、脚注、尾注、批注；排除删除修订与域指令。DOC：传统 OLE 文档正文及可用附属文字，表格主要表现为文字。
- XLS / XLSX：工作表、隐藏表标记、格式化单元格、合并范围；公式显示已有缓存或缺失提示，不重新计算、不运行宏。
- PPTX：按 presentation 关系顺序读取幻灯片正文、表格与备注，排除备注的页码等占位符。PPT：按当前持久化引用读取幻灯片及备注，避免过期物理记录混入。
- PDF（v0.17.0 新增）：本机提取文字层和页码，不含 OCR；超出文件或字符上限拒绝而不截断，来源见 LINK_READER.zh-CN.md。
- 最多五个文件，文字单个 1 MiB、Office 10 MiB；API 和网页合计均为 100,000 字符（桌面 v0.18.5 起，包含问题、文件、链接资料和引用）。不截断，无可读文字会报错。
- 不提供图片、图表、扫描文字 OCR 或原始版式还原。复杂表格和特殊对象可能丢失结构，请核对预览。加密和损坏文件不保证可读。

桌面工作线程限制并发、时长与内存；ZIP / XML、工作表规模另有上限。线程并非独立安全沙箱。读取不执行文档脚本、宏或公式，不获取文档外部资源，也不按文档内容操作本机文件。

## 依赖来源

| 组件 | 固定版本 | 来源与用途 |
| --- | --- | --- |
| fflate | 0.8.3 | [作者仓库](https://github.com/101arrowz/fflate)，MIT；OOXML ZIP 读取 |
| @xmldom/xmldom | 0.9.12 | [作者仓库](https://github.com/xmldom/xmldom)，MIT；XML 读取 |
| word-extractor | 1.0.4 | [作者仓库](https://github.com/morungos/node-word-extractor)，MIT；传统 DOC |
| SheetJS CE | 0.20.3 | [官方安装文档](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)，Apache-2.0；XLS / XLSX |
| ppt-codec | 2.2.23 | [作者仓库](https://github.com/ExaDev/documents.js/tree/main/packages/ppt-codec)，许可随依赖分发；传统 PPT 当前记录读取 |

SheetJS 使用 [官方 0.20.3 分发包](https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz)，版本及完整性写入 package-lock。新增依赖安装文件合计约 19 MB；这不是最终安装包体积测量。解析留在桌面侧，较大的库按需加载，未引入 Office、Python、OCR 或识别模型。未采用按物理记录顺序收集文字的旧 PPT 方案，以免重复提取已被新版持久化引用替代的内容。

## 验证与样例

构建通过；103 项核心测试、17 项文件/外观界面测试通过。隔离测试验证实际本地读取、预览、发送请求、保存、Excel JSON 导出和重启，以及混合文件、失败保护、容量/编码/ZIP/XML 拒绝。测试服务在本机模拟，不调用用户真实模型账号。混合附件截图位于 artifacts/chat-files/mixed-minimal.png，已核对 1024×740 窗口的发送入口和滚动区域。

DOCX / XLS / XLSX / PPT / PPTX 主要使用测试代码生成的夹具。传统 Word 样例 tests/fixtures/word-legacy.doc 来自 [word-extractor 公开测试数据](https://raw.githubusercontent.com/morungos/node-word-extractor/main/__tests__/data/test01.doc)，Git blob 为 7a07fcbfec25f670aa5aa03c340d1627d563d3f5，SHA-256 为 3aefb1a8370ede7cc3aef1280fe216e9597e2a458a3125bd55dd735109407f33；其 MIT 许可保存在 tests/fixtures/word-legacy.LICENSE。该样例覆盖传统 Word 的 Unicode 与修订文字读取，不代表任意复杂 Office 文件均能完整还原。
