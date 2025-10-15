from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...db.session import get_db
from ...db import models as dbm
from ...security.deps import get_current_user


router = APIRouter()


class LoginMethodOut(BaseModel):
    provider_name: str
    provider_key: str
    created_at: str

    model_config = {"from_attributes": True}


class UserProfileOut(BaseModel):
    id: int
    email: Optional[str]
    display_name: Optional[str]
    created_at: str
    updated_at: Optional[str]
    login_methods: List[LoginMethodOut] = []

    model_config = {"from_attributes": True}


def _current_user(db: Session, user: dbm.User = Depends(get_current_user)) -> dbm.User:
    return user


@router.get("/profile", response_model=UserProfileOut)
def get_profile(db: Session = Depends(get_db), user: dbm.User = Depends(get_current_user)):
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
def get_stats(db: Session = Depends(get_db), user: dbm.User = Depends(get_current_user)):
    return UserStatsOut(
        user_id=user.id,
        login_methods=len(user.logins),
        created_at=user.created_at.isoformat(),
    )


class LoginMethodsOut(BaseModel):
    data: List[LoginMethodOut]


@router.get("/login-methods", response_model=LoginMethodsOut)
def list_login_methods(db: Session = Depends(get_db), user: dbm.User = Depends(get_current_user)):
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
def delete_me(db: Session = Depends(get_db), user: dbm.User = Depends(get_current_user)):
    db.delete(user)
    db.commit()
    return {"success": True}


