from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .api.v1.auth import router as auth_router
from .api.v1.users import router as users_router
from .db.session import Base, engine


def create_app() -> FastAPI:
    app = FastAPI(title="FrameWeavers Backend - Apple Sign In MVP", version="0.1.0")

    # 初始化数据库表（开发阶段）
    Base.metadata.create_all(bind=engine)

    @app.get("/health")
    def health_check():
        return JSONResponse({"status": "ok"})

    app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
    app.include_router(users_router, prefix="/api/v1/users", tags=["users"])
    return app


app = create_app()


