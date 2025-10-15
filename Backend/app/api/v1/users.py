from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...db.session import get_db
from ...db import models as dbm
from ...security.jwt import parse_token


router = APIRouter()


class LoginMethodOut(BaseModel):
    provider_name: str
    provider_key: str
    created_at: str

    class Config:
        orm_mode = True


class UserProfileOut(BaseModel):
    id: int
    email: Optional[str]
    display_name: Optional[str]
    created_at: str
    updated_at: Optional[str]
    login_methods: List[LoginMethodOut] = []

    class Config:
        orm_mode = True


def _current_user(db: Session, authorization: Optional[str] = Header(None)) -> dbm.User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1]
    try:
        decoded = parse_token(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid access token: {e}")
    if decoded.get("type") != "access":
        raise HTTPException(status_code=401, detail="Token is not access type")
    try:
        user_id = int(decoded.get("sub"))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token subject")
    user = db.get(dbm.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/profile", response_model=UserProfileOut)
def get_profile(db: Session = Depends(get_db)):
    user = _current_user(db)
    return UserProfileOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        created_at=user.created_at.isoformat(),
        updated_at=user.updated_at.isoformat() if user.updated_at else None,
        login_methods=[
            LoginMethodOut(
                provider_name=lm.provider_name,
                provider_key=lm.provider_key,
                created_at=lm.created_at.isoformat(),
            )
            for lm in user.logins
        ],
    )


class UserStatsOut(BaseModel):
    user_id: int
    login_methods: int
    created_at: str


@router.get("/stats", response_model=UserStatsOut)
def get_stats(db: Session = Depends(get_db)):
    user = _current_user(db)
    return UserStatsOut(
        user_id=user.id,
        login_methods=len(user.logins),
        created_at=user.created_at.isoformat(),
    )


class LoginMethodsOut(BaseModel):
    data: List[LoginMethodOut]


@router.get("/login-methods", response_model=LoginMethodsOut)
def list_login_methods(db: Session = Depends(get_db)):
    user = _current_user(db)
    methods = [
        LoginMethodOut(
            provider_name=lm.provider_name,
            provider_key=lm.provider_key,
            created_at=lm.created_at.isoformat(),
        )
        for lm in user.logins
    ]
    return LoginMethodsOut(data=methods)


@router.delete("/me")
def delete_me(db: Session = Depends(get_db)):
    user = _current_user(db)
    db.delete(user)
    db.commit()
    return {"success": True}


