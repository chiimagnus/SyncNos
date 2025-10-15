from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional
import time
import requests
import jwt

from ..core.config import settings


APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"


def _read_private_key_from_path() -> Optional[str]:
    path = settings.apple_private_key_path
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return None


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
    private_key = _read_private_key_from_path() or settings.apple_private_key
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
    resp = requests.post(APPLE_TOKEN_URL, data=data, headers=headers, timeout=15)
    if resp.status_code != 200:
        raise ValueError(f"Apple token endpoint error: {resp.status_code} {resp.text}")
    return resp.json()


# --- JWKS caching and id_token verification (for production) ---
_JWKS_CACHE: Dict[str, Any] = {"keys": None, "fetched_at": 0}


def _get_jwks() -> Dict[str, Any]:
    now = int(time.time())
    if _JWKS_CACHE["keys"] and now - _JWKS_CACHE["fetched_at"] < 3600:
        return _JWKS_CACHE["keys"]
    resp = requests.get(APPLE_JWKS_URL, timeout=5)
    resp.raise_for_status()
    data = resp.json()
    _JWKS_CACHE["keys"] = data
    _JWKS_CACHE["fetched_at"] = now
    return data


def verify_id_token(id_token: str) -> Dict[str, Any]:
    """Verify Apple's id_token using JWKS.

    For MVP security uplift we still use PyJWT with provided public keys.
    In production, consider `python-jose` for ES256 + JWKS directly.
    """
    jwks = _get_jwks()
    headers = jwt.get_unverified_header(id_token)
    kid = headers.get("kid")
    if not kid:
        raise ValueError("id_token header missing kid")
    keys = jwks.get("keys", [])
    public_key = None
    for k in keys:
        if k.get("kid") == kid:
            public_key = jwt.algorithms.ECAlgorithm.from_jwk(k)
            break
    if public_key is None:
        raise ValueError("No matching JWKS key")

    # verify signature and claims
    payload = jwt.decode(
        id_token,
        key=public_key,
        algorithms=["ES256"],
        audience=settings.apple_client_id,
        issuer="https://appleid.apple.com",
    )
    return payload


