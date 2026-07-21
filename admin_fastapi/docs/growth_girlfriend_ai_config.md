# 小轻AI成长闺蜜 AI 配置

目标：前后端逻辑已接好，Key 写入 `.env` 后即可联调。

## 主对话

当前建议使用火山方舟/豆包作为主对话：

```env
GROWTH_AI_PROVIDER=doubao
VOLCENGINE_ARK_API_KEY=你的火山方舟 Key
VOLCENGINE_ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DOUBAO_CHAT_MODEL=你的 endpoint id，例如 ep-20260702193812-67mw5
```

如果想切到阿里千问：

```env
GROWTH_AI_PROVIDER=qwen
DASHSCOPE_API_KEY=你的阿里百炼 Key
DASHSCOPE_CHAT_MODEL=qwen3.7-plus
DASHSCOPE_COMPATIBLE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

## 语音识别 ASR

```env
ALI_ASR_API_KEY=你的阿里百炼 Key
ALI_ASR_MODEL=paraformer-v2
APP_PUBLIC_BASE_URL=https://你的后端公网域名
```

说明：阿里录音文件识别需要可公网访问的 `file_url`。本地开发如果没有公网域名，文本输入和 TTS 可以正常用，ASR 需要部署到公网环境或配置内网穿透地址。

## 语音合成 TTS

```env
ALI_TTS_API_KEY=你的阿里百炼 Key
ALI_TTS_MODEL=cosyvoice-v3.5-flash
ALI_TTS_VOICE=longxiaochun
ALI_TTS_FALLBACK_MODEL=qwen-tts
ALI_TTS_FALLBACK_VOICE=Cherry
```

实测当前账号下 `cosyvoice-v3.5-flash` 返回 418，后端会自动降级到 `qwen-tts + Cherry`，并返回 `audioUrl` 给前端播放。

## 已有接口

- `GET /app/health/growthGirlfriend/context`
- `POST /app/health/growthGirlfriend/chat`
- `POST /app/health/growthGirlfriend/asr`
- `POST /app/health/growthGirlfriend/tts`

## 降级行为

- 主对话 Key 未配置：返回本地规则回答，页面可用。
- 主对话调用失败：后端返回本地规则回答，并标记 `modelStatus=provider_error`。
- ASR 未配置或公网 URL 不可用：返回空文本，前端仍可继续文字输入。
- TTS 首选模型不可用：自动尝试 fallback 模型。
