from datetime import datetime, timedelta, timezone
from typing import Dict, Any
import requests
import jwt

from ..core.config import settings


APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"


def generate_client_secret() -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "iss": settings.apple_team_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
        "aud": "https://appleid.apple.com",
        "sub": settings.apple_client_id,
    }
    headers = {"kid": settings.apple_key_id, "alg": "ES256"}
    # 支持从 .env 中以单行字符串存放私钥（使用 \n 表示换行）或直接存放多行文本
    private_key = settings.apple_private_key
    if "\\n" in private_key:
        private_key = private_key.replace("\\n", "\n")

    return jwt.encode(claims, private_key, algorithm="ES256", headers=headers)


def exchange_code_for_tokens(authorization_code: str) -> Dict[str, Any]:
    client_secret = generate_client_secret()
    data = {
        "grant_type": "authorization_code",
        "code": authorization_code,
        "client_id": settings.apple_client_id,
        "client_secret": client_secret,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    last_err: Exception | None = None
    for _ in range(2):
        try:
            resp = requests.post(APPLE_TOKEN_URL, data=data, headers=headers, timeout=15)
            if resp.status_code != 200:
                last_err = ValueError(f"Apple token endpoint error: {resp.status_code} {resp.text}")
                continue
            return resp.json()
        except Exception as e:
            last_err = e
    if last_err:
        raise last_err
    raise RuntimeError("Unknown error exchanging Apple code for tokens")


