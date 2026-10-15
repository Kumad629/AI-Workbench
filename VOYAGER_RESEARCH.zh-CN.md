# Voyager 导出调研与 Gemini 遗漏分析

日期：2026-09-21。范围：阅读用户提供的 Voyager 官网与导出源码，结合当前 AI Workbench v0.2.1 的实现分析；本次不变更功能代码。

## 当前截图能确认的事实

- 当前收集器报告 390 条消息，同时报告“没有重叠”“容量上限”，停止原因包含容量限制。截图没有显示“读取超时”。
- browser-extension/history.js 在累计消息正文超过 480,000 个 JavaScript 字符单位后停止；组装后的正文超过 500,000 则拒绝输出。
- electron/transcripts.mjs 的本地导入上限也为 500,000；electron/browser-bridge.mjs 的单次请求上限为 2,200,000 字节。只提高读取器上限，仍可能在保存阶段失败。
- history.js 在无法找到批次重叠时直接追加整个批次；如果页面重排、正文变化或标识不稳定，可能重复累计。390 是收集器记录数，不是已确认的唯一消息总数。
- 当前读取器仅检查同一批次的重复 ID，跨批次 ID 相同会被当成同一消息，即便正文不同。这是可导致误合并的风险；尚未拿到真实问题页的逐条对照，不能断言所有遗漏都由它造成。
- 每步固定等待约 450ms，边界稳定约 4 秒即结束；慢加载也可能造成遗漏，但不能解释或解决容量截断。

## Voyager 的具体做法

审阅的主流程版本固定于 commit d9e365b8d11e85fea00989850c915579a7f7c3a8。

1. **主动触发历史加载并恢复任务。** Gemini 导出定位最早的用户消息，滚动到它并模拟点击；保存待导出状态到 sessionStorage。页面发生刷新后恢复；消息内容或数量发生变化时重复加载，尝试次数有上限。不是通过 Gemini 模型 API 获取完整历史。
   - [导出流程 executeExportSequence](https://github.com/Nagi-ovo/voyager/blob/d9e365b8d11e85fea00989850c915579a7f7c3a8/src/pages/content/export/index.ts#L1227)
   - 入口传入等待配置：单轮最多 12 秒、至少 700ms、稳定窗口 320ms、约 90ms 轮询。不能理解为每轮固定等待 12 秒，也不能据此宣称它保证全量。

2. **观察变化而非只等固定时间。** 内容指纹结合开头消息文本与节点数，配合 MutationObserver 判断变化和稳定。没有变化时也会提前返回。
   - [topNodePreload.ts](https://github.com/Nagi-ovo/voyager/blob/main/src/pages/content/export/topNodePreload.ts)

3. **防止分批加载产生的重复编号。** selectionIds.ts 明确处理分批历史反复使用 u-0 等 ID 的情况，优先使用服务器回合标识，并在冲突时分配唯一导出标识。它主要服务于当次导出选择状态，不能直接当成跨所有虚拟窗口的无损合并算法。
   - [selectionIds.ts](https://github.com/Nagi-ovo/voyager/blob/d9e365b8d11e85fea00989850c915579a7f7c3a8/src/pages/content/export/selectionIds.ts)

4. **按 Gemini 正文结构提取。** 使用多个消息选择器、限定对话根节点、排除嵌套重复节点和 Deep Research 面板；提取正文时避开展开的思考面板，分别处理提问、回答、表格、代码、公式和附件。
   - [Gemini 适配器](https://github.com/Nagi-ovo/voyager/blob/d9e365b8d11e85fea00989850c915579a7f7c3a8/src/pages/content/export/adapter/platform/gemini.ts)
   - [DOMContentExtractor.ts](https://github.com/Nagi-ovo/voyager/blob/main/src/features/export/services/DOMContentExtractor.ts)
   - 当前直接读取整个 user-query / model-response 的 innerText，可能混入工具栏、思考面板或扩展插入的文字，导致跨批次文本不稳定；这是需要真实样本验证的风险。

5. **结构化导出可用于对照。** JSON 格式标识为 gemini-voyager.chat.v1，含 title、url、exportedAt、count、items；items 中分开保存 user、assistant、starred 和可选 attachments。
   - [JSON 导出服务](https://github.com/Nagi-ovo/voyager/blob/d9e365b8d11e85fea00989850c915579a7f7c3a8/src/features/export/services/ConversationExportService.ts#L144)
   - Voyager 的 count 来自导出回合数；本扩展 count 是消息条数，不能直接比较两个数字判断遗漏。
   - 支持其 JSON 导入可作临时备用入口和验收对照，不应替代“点击一次直接保存到工作台”的主流程。

## 建议的改进顺序

1. 修复消息身份与合并：限定正文、校验跨批次 ID、区分内容更新与 ID 复用；衔接失败时保留片段并尝试补读，不再盲目追加整批。
2. 改造长对话存储链路：按消息分批传送、本地增量保存和分页显示。容量、请求大小、导入校验及导出限制要一致；目标是避免用户手动分段。
3. 借鉴按页面变化等待、主动触发更早历史和刷新后恢复的机制。对 Gemini 实际版本验证触发方式，不能直接照搬模拟点击。
4. 为同一条真实长对话做逐条对照；可用一次 Voyager JSON 导出作为参考，再核对原网页。两者都依赖页面加载，Voyager 导出本身也不能未经核对就充当绝对完整的标准。

## 验收重点

- 超过 50 万字符仍能完整保存、退出重开和导出，不只测试短文本的 60 条模拟消息。
- 多批次复用 u-0 / u-1 等编号；合法重复提问；正文展开或缩短；页面插入工具栏文字。
- 历史加载超过 4 秒、页面刷新后继续、滚动窗口间缺少重叠，均有明确状态和补读策略。
- 同一条长对话的首尾与中间消息都逐条比对；“读到了开头与结尾”不能证明中间没有缺口。
- 区分唯一消息数、回合数、已保存字符量与未确认片段数，避免重复内容耗尽容量却误显示为大量历史。

本次只作实现思路调研，未把第三方源码复制进产品。Voyager 仓库标注 GPL-3.0；若未来直接复用源码，应另行评估项目许可安排。
