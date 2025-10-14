from dataclasses import dataclass
from typing import Dict, Optional


@dataclass
class User:
    id: str
    display_name: Optional[str] = None
    email: Optional[str] = None


@dataclass
class UserLogin:
    user_id: str
    provider_name: str
    provider_key: str


class InMemoryDB:
    def __init__(self) -> None:
        self.users: Dict[str, User] = {}
        # key: (provider_name, provider_key) -> user_id
        self.user_logins: Dict[tuple, str] = {}
        self._id_counter = 0

    def _next_id(self) -> str:
        self._id_counter += 1
        return str(self._id_counter)

    def get_or_create_user_by_provider(self, provider_name: str, provider_key: str, email: Optional[str], display_name: Optional[str]) -> User:
        key = (provider_name, provider_key)
        if key in self.user_logins:
            user_id = self.user_logins[key]
            return self.users[user_id]
        # create
        user_id = self._next_id()
        user = User(id=user_id, display_name=display_name, email=email)
        self.users[user_id] = user
        self.user_logins[key] = user_id
        return user


