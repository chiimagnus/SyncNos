from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..db.session import get_db
from ..db import models as dbm
from ..security.jwt import parse_token


def get_current_user(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None, convert_underscores=False),
) -> dbm.User:
    """Extract access token from Authorization header and return current user.

    Expects header: Authorization: Bearer <access_token>
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid Authorization header format")

    token = parts[1]
    try:
        decoded = parse_token(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid access token: {e}")
    if decoded.get("type") != "access":
        raise HTTPException(status_code=401, detail="Token is not access type")

    try:
        user_id = int(decoded.get("sub"))
    except Exception:
        raise HTTPException(status_code=401, detail="Malformed access token (sub)")

    user = db.query(dbm.User).filter(dbm.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


