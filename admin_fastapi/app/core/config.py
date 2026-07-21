from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "QKeer Admin FastAPI"
    env: str = "development"
    database_url: str = "sqlite:///./qkeer_admin.db"
    redis_url: str = "redis://127.0.0.1:6379/0"
    other_api_base_url: str = ""
    wx_miniapp_appid: str = ""
    wx_miniapp_secret: str = ""

    growth_ai_provider: str = "qwen"
    dashscope_api_key: str = ""
    dashscope_chat_model: str = "qwen3.7-plus"
    dashscope_compatible_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    volcengine_ark_api_key: str = ""
    volcengine_ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    doubao_chat_model: str = ""
    ali_asr_api_key: str = ""
    ali_asr_model: str = "qwen3-asr-flash"
    ali_asr_endpoint: str = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription"
    ali_tts_api_key: str = ""
    ali_tts_model: str = "cosyvoice-v3.5-flash"
    ali_tts_voice: str = "longxiaochun"
    ali_tts_fallback_model: str = "qwen-tts"
    ali_tts_fallback_voice: str = "Cherry"
    ali_tts_endpoint: str = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/speech-synthesis"
    app_public_base_url: str = ""
    sleepfm_service_token: str = ""
    sleepfm_hash_secret: str = ""
    sleepfm_consented_user_ids: str = ""

    token_header: str = "Authorization"
    token_prefix: str = "Bearer "
    token_secret: str = "change-me"
    admin_token_expire_minutes: int = 30
    app_token_expire_minutes: int = 43200

    cors_origins: str = Field(default="*")
    upload_dir: str = "upload"

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def upload_path(self) -> Path:
        return Path(self.upload_dir).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
