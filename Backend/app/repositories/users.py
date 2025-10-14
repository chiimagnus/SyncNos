from typing import Optional
from sqlalchemy.orm import Session

from ..db import models as dbm


def get_user_by_id(db: Session, user_id: int) -> Optional[dbm.User]:
    return db.get(dbm.User, user_id)


def get_user_by_provider(db: Session, provider_name: str, provider_key: str) -> Optional[dbm.User]:
    return (
        db.query(dbm.User)
        .join(dbm.LoginMethod, dbm.LoginMethod.user_id == dbm.User.id)
        .filter(dbm.LoginMethod.provider_name == provider_name, dbm.LoginMethod.provider_key == provider_key)
        .first()
    )


def create_user_with_provider(
    db: Session,
    provider_name: str,
    provider_key: str,
    email: Optional[str],
    display_name: Optional[str],
) -> dbm.User:
    user = dbm.User(email=email, display_name=display_name)
    db.add(user)
    db.flush()  # 让 user.id 可用
    login = dbm.LoginMethod(user_id=user.id, provider_name=provider_name, provider_key=provider_key)
    db.add(login)
    db.commit()
    db.refresh(user)
    return user


def ensure_login_method(db: Session, user_id: int, provider_name: str, provider_key: str) -> None:
    exists = (
        db.query(dbm.LoginMethod)
        .filter(
            dbm.LoginMethod.user_id == user_id,
            dbm.LoginMethod.provider_name == provider_name,
            dbm.LoginMethod.provider_key == provider_key,
        )
        .first()
    )
    if not exists:
        db.add(dbm.LoginMethod(user_id=user_id, provider_name=provider_name, provider_key=provider_key))
        db.commit()


def delete_user(db: Session, user: dbm.User) -> None:
    db.delete(user)
    db.commit()


