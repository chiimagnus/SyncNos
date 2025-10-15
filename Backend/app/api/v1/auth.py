from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import jwt
from sqlalchemy.orm import Session

from ...services.apple_oauth import exchange_code_for_tokens
from ...db.session import get_db
from ...db import models as dbm
from ...repositories import users as user_repo
from ...security.jwt import create_access_token, create_refresh_token, parse_token
from ...security.apple_jwks import verify_apple_id_token
from ...core.config import settings


router = APIRouter()


class AppleLoginRequest(BaseModel):
    authorization_code: str
    nonce: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = 30 * 60


@router.post("/login/apple", response_model=TokenResponse)
def login_with_apple(payload: AppleLoginRequest, db: Session = Depends(get_db)):
    if not payload.authorization_code:
        raise HTTPException(status_code=400, detail="authorization_code is required")

    try:
        token_resp = exchange_code_for_tokens(payload.authorization_code)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Apple verification failed: {e}")

    id_token = token_resp.get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="No id_token in Apple response")

    # 使用 Apple 公钥 (JWKS) 验签，并校验 iss/aud/exp/iat/nonce（若提供）
    try:
        verified = verify_apple_id_token(id_token, audience=settings.apple_client_id, nonce=payload.nonce)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid Apple id_token: {e}")

    apple_sub = verified.get("sub")
    email = verified.get("email")
    name = None  # Apple 可能不返回 name
    if not apple_sub:
        raise HTTPException(status_code=401, detail="Invalid id_token: missing sub")

    # 在本地DB中查找或创建用户
    user = user_repo.get_user_by_provider(db, "apple", apple_sub)
    if user is None:
        user = user_repo.create_user_with_provider(db, "apple", apple_sub, email, name)
    else:
        # 确保登录方式存在
        user_repo.ensure_login_method(db, user.id, "apple", apple_sub)

    # 创建刷新令牌记录
    refresh_token = create_refresh_token(str(user.id))
    decoded = parse_token(refresh_token)
    jti = decoded.get("jti")
    exp = decoded.get("exp")
    if not jti or not exp:
        raise HTTPException(status_code=500, detail="Failed to issue refresh token")
    db_token = dbm.RefreshToken(
        user_id=user.id,
        jti=jti,
        revoked=False,
        expires_at=datetime.fromtimestamp(exp, tz=timezone.utc),
    )
    db.add(db_token)
    db.commit()

    access = create_access_token(user.id)
    refresh = refresh_token
    return TokenResponse(access_token=access, refresh_token=refresh)


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/refresh", response_model=TokenResponse)
def refresh_tokens(payload: RefreshRequest, db: Session = Depends(get_db)):
    try:
        decoded = parse_token(payload.refresh_token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid refresh token: {e}")

    if decoded.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Token is not refresh type")

    user_id = int(decoded.get("sub"))
    jti = decoded.get("jti")
    exp_ts = decoded.get("exp")
    if not jti or not exp_ts:
        raise HTTPException(status_code=401, detail="Malformed refresh token")

    # 校验刷新令牌状态
    db_token = db.query(dbm.RefreshToken).filter(dbm.RefreshToken.jti == jti).first()
    if not db_token or db_token.revoked:
        raise HTTPException(status_code=401, detail="Refresh token is revoked or not found")
    if db_token.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired")

    # 作废旧刷新令牌，签发新的一对
    db_token.revoked = True
    new_refresh = create_refresh_token(str(user_id))
    decoded_new = parse_token(new_refresh)
    new_jti = decoded_new.get("jti")
    new_exp = decoded_new.get("exp")
    db.add(
        dbm.RefreshToken(
            user_id=user_id,
            jti=new_jti,
            revoked=False,
            expires_at=datetime.fromtimestamp(new_exp, tz=timezone.utc),
        )
    )
    db.commit()

    new_access = create_access_token(str(user_id))
    return TokenResponse(access_token=new_access, refresh_token=new_refresh)


class LogoutRequest(BaseModel):
    refresh_token: str


@router.post("/logout")
def logout(payload: LogoutRequest, db: Session = Depends(get_db)):
    try:
        decoded = parse_token(payload.refresh_token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid refresh token: {e}")
    if decoded.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Token is not refresh type")
    jti = decoded.get("jti")
    db_token = db.query(dbm.RefreshToken).filter(dbm.RefreshToken.jti == jti).first()
    if not db_token:
        raise HTTPException(status_code=404, detail="Refresh token not found")
    db_token.revoked = True
    db.commit()
    return {"success": True}


