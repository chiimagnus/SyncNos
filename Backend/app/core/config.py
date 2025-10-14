from pydantic_settings import BaseSettings
from pydantic import Field
from dotenv import load_dotenv

# 加载项目根目录下的 .env（若存在）
load_dotenv()


class Settings(BaseSettings):
    # Apple OAuth
    apple_team_id: str = Field(..., alias="APPLE_TEAM_ID")
    apple_key_id: str = Field(..., alias="APPLE_KEY_ID")
    apple_client_id: str = Field(..., alias="APPLE_CLIENT_ID")  # Services ID
    apple_private_key: str = Field(..., alias="APPLE_PRIVATE_KEY")  # 内容或多行字符串

    # App JWT
    app_jwt_secret: str = Field(..., alias="APP_JWT_SECRET")
    access_token_minutes: int = Field(30, alias="APP_ACCESS_TOKEN_MINUTES")
    refresh_token_days: int = Field(7, alias="APP_REFRESH_TOKEN_DAYS")

    # Database
    database_url: str = Field("sqlite:///./app.db", alias="DATABASE_URL")

    class Config:
        case_sensitive = True
        env_file = None


settings = Settings()


