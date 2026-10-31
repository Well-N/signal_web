# 默认模型核对清单

核对日期：2026-10-29。以下型号来自官方 API 文档，未使用用户密钥逐家发起付费调用。采用公开可用通用型号或原系列的最新代。

| 服务商 | 默认模型 | 官方依据 |
| --- | --- | --- |
| OpenAI | `gpt-6.1-sol` | [型号及接口](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| DeepSeek | `deepseek-flash` | [官方调用说明](https://api-docs.deepseek.com/quick_start/pricing)：当前指向 DeepSeek-V4.1-Flash-1017 |
| Kimi | `kimi-k3.1-pro` | [模型列表](https://platform.kimi.ai/docs/models)、[请求要求](https://platform.kimi.ai/docs/guide/kimi-k3-1-pro-quickstart) |
| 智谱 | `glm-5.3` | [文本旗舰 API](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3) |
| 百炼 | `qwen3.8-max` | [版本映射](https://www.alibabacloud.com/en/notice/model_studio_update_notice_for_qwen38max_models_863)、[兼容接口](https://help.aliyun.com/en/model-studio/compatibility-of-openai-with-dashscope) |
| 硅基流动 | `deepseek-ai/DeepSeek-V4.1-Flash` | [服务更新](https://docs.siliconflow.cn/docs/release-notes/overview) |
| OpenCode Go | `deepseek-v4.1-flash` | [Go 模型与地址](https://opencode.ai/v2/docs/console/go/) |
| Anthropic（CLI） | `claude-sonnet-5-5` | [模型列表](https://platform.claude.com/docs/en/models/overview)、[公告](https://www.anthropic.com/claude-sonnet-5-5) |
| Gemini（CLI） | `gemini-4-argon` | [公开稳定 API](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon) |
| 豆包（CLI） | `doubao-seed-2-1-pro-260915` | [普通 API 型号](https://console.volcengine.com/ark/region%3Acn-beijing/docs/model-list) |
| MiniMax（CLI） | `MiniMax-M3.1-Flash` | [API 型号](https://platform.minimax.io/docs/api-reference/text-openai-api)；原值已是此型号 |
| Ollama（CLI） | `lfm3:1.7b` | [官方标签](https://ollama.com/library/lfm3)、[发布说明](https://www.liquid.ai/blog/lfm3)；需要本机已经安装 |

Azure 必须使用用户实际部署名，因此移除通用 `gpt-4` 部署名默认值。ChatGPT 登录模式继续从账户模型目录选择。

OpenCode 新预设地址为 `https://opencode.ai/inference/go/openai/v1`，Kimi 为 `https://api.moonshot.ai/v1`。百炼保留可用的北京通用域名；有专属域名的用户可自行填写。[百炼官方域名说明](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen-api-via-dashscope)明确旧域名继续可用。

选择服务商会填入该服务商地址及默认模型。启动不会强制改写已保存的用户配置，用户可重新选择服务商并保存。自定义服务仍由用户填写模型名。

请求兼容性：GPT-6 直接使用 `max_completion_tokens`，GPT 推理系列与 Kimi K3.1 不发送自定义 temperature；连接测试同样按模型选择 token 参数，不发送采样参数。没有加入模型切换或备用数据源。

64 项相关测试通过。安装包还检查独立 Python/Node、采集导入、分词、词云、设置及静态资源。
