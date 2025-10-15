from __future__ import annotations

import time
from typing import Any, Dict, Optional

import requests
from jose import jwt as jose_jwt
from jose.exceptions import JWTClaimsError
import hashlib

from ..core.config import settings


APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"

_jwks_cache: Optional[Dict[str, Any]] = None
_jwks_cached_at: float = 0.0


def _get_jwks() -> Dict[str, Any]:
    global _jwks_cache, _jwks_cached_at
    now = time.time()
    if _jwks_cache is None or (now - _jwks_cached_at) > settings.apple_jwks_ttl:
        resp = requests.get(APPLE_JWKS_URL, timeout=10)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_cached_at = now
    return _jwks_cache  # type: ignore[return-value]


def verify_apple_id_token(id_token: str, audience: str, nonce: Optional[str] = None) -> Dict[str, Any]:
    """Verify Apple id_token using JWKS (RS256), issuer, audience and optional nonce.

    Raises jose.exceptions.JOSEError (or subclasses) on failure.
    Returns decoded payload dict on success.
    """
    jwks = _get_jwks()
    # jose_jwt.decode supports passing JWKS directly
    payload = jose_jwt.decode(
        id_token,
        jwks,
        algorithms=["RS256"],
        audience=audience,
        issuer="https://appleid.apple.com",
        options={"verify_at_hash": False},
    )

    # If nonce provided from client, verify that token's nonce matches SHA256(rawNonce)
    if nonce is not None:
        expected = hashlib.sha256(nonce.encode("utf-8")).hexdigest()
        token_nonce = payload.get("nonce")
        if token_nonce != expected:
            raise JWTClaimsError("Invalid nonce")
    return payload


