# 本地语音组件来源

- 运行组件：sherpa-onnx-node 与 sherpa-onnx-win-x64 1.13.8，Apache-2.0；[项目](https://github.com/k2-fsa/sherpa-onnx)、[LICENSE](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE)。Windows 原生包包含 ONNX Runtime；[ONNX Runtime License](https://github.com/microsoft/onnxruntime/blob/main/LICENSE)。组件原有声明及 npm 元数据保持在 node_modules 中。
- 模型：SenseVoiceSmall 的 int8 ONNX 转换版本，来源 [csukuangfj 模型仓库](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07)，固定 revision 2365baeacb507f821a0c8120fcee3d484dba7a07。原始模型及条款见 [SenseVoiceSmall 模型卡](https://huggingface.co/FunAudioLLM/SenseVoiceSmall) 和模型卡链接的 [FunASR MODEL_LICENSE](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)。模型权重与运行代码的许可分别看待。
- 安装仅下载所需 model.int8.onnx 与 tokens.txt，不复制整个仓库、不修改权重。SHA-256 记录在 electron/voice-model.mjs，模型目录 local-models/sensevoice 可在界面删除。
- 测试音频：同一模型仓库的公开 test_wavs/zh.wav，仅用于本地验证，不是用户录音。
- 模型主站不可达时使用 https://hf-mirror.com 的同一固定版本文件；通过固定 SHA-256 校验后才启用。镜像只用于下载公开模型，录音没有上传路径。
