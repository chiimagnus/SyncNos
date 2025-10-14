from datetime import datetime, timedelta, timezone
import uuid
import jwt
from typing import Optional

from ..core.config import settings


def _expire_at(minutes: int = 30) -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=minutes)


def _expire_days(days: int = 7) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)


def create_access_token(user_id: str) -> str:
    payload = {
        "sub": str(user_id),
        "type": "access",
        "exp": _expire_at(settings.access_token_minutes),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.app_jwt_secret, algorithm="HS256")


def create_refresh_token(user_id: str, jti: Optional[str] = None) -> str:
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "exp": _expire_days(settings.refresh_token_days),
        "iat": datetime.now(timezone.utc),
        "jti": jti or uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.app_jwt_secret, algorithm="HS256")


def parse_token(token: str) -> dict:
    return jwt.decode(token, settings.app_jwt_secret, algorithms=["HS256"])  # 验签本地HS256


