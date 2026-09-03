"""FastAPI 装配：路由挂载、种子数据、前端构建产物静态托管。"""
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine
from .models import EvalScheme, GradeConversion, User
from .auth import hash_password

app = FastAPI(title="综测计算工作台", version="1.3.9")
# 前端构建产物体积较大：gzip 后约缩至 1/3，显著缩短首屏白屏时间
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.exception_handler(HTTPException)
async def http_exc_handler(request: Request, exc: HTTPException):
    """统一错误结构：422 校验错误可读化。"""
    detail = exc.detail
    if isinstance(detail, str):
        detail = {"message": detail}
    return JSONResponse(status_code=exc.status_code, content={"detail": detail})


@app.exception_handler(RequestValidationError)
async def validation_exc_handler(request: Request, exc: RequestValidationError):
    """pydantic 校验错误 → 可读中文消息（§11.10）。"""
    errors = []
    for e in exc.errors():
        loc = ".".join(str(x) for x in e.get("loc", []) if x != "body")
        errors.append(f"{loc}：{e.get('msg')}")
    return JSONResponse(
        status_code=422,
        content={"detail": {"message": "参数校验失败（" + "；".join(errors) + "）",
                            "errors": errors}})


@app.get("/api/health", include_in_schema=False)
def health():
    """存活探针：供 Docker HEALTHCHECK / 反代健康检查使用。"""
    return {"status": "ok"}


from .routers import (admin, auth, base_data, evals, overview, schemes,  # noqa: E402
                      scores, summary_export)

for r in (auth.router, base_data.router, scores.router, evals.router,
          summary_export.router, schemes.router, admin.router, overview.router):
    app.include_router(r, prefix="/api")


def seed(db: Session):
    if not db.query(User).filter_by(username="admin").first():
        u = User(username="admin", role="admin", real_name="管理员",
                 must_change_password=True)
        u.password_hash, u.salt = hash_password("admin123")
        db.add(u)
    if not db.query(EvalScheme).filter_by(academic_year_id=None, grade_id=None).first():
        db.add(EvalScheme(academic_year_id=None, grade_id=None, weight_academic=0.8,
                          weight_eval=0.2, retake_rule="latest",
                          items=[
                              {"name": "思想品德", "max_score": 25, "base_template": "基础分+23"},
                              {"name": "社会工作", "max_score": 20, "base_template": ""},
                              {"name": "科研及科技创新", "max_score": 20, "base_template": ""},
                              {"name": "文体活动", "max_score": 15, "base_template": ""},
                              {"name": "集体建设", "max_score": 20,
                               "base_template": "班级基础分+7\n寝室基础分+8"},
                          ]))
    if db.query(GradeConversion).count() == 0:
        for text, score, group in [
            ("优", 95, "五级制"), ("优秀", 95, "五级制"), ("良", 85, "五级制"), ("良好", 85, "五级制"),
            ("中", 75, "五级制"), ("中等", 75, "五级制"), ("及格", 65, "五级制"), ("不及格", 0, "五级制"),
            ("合格", 80, "两级制"), ("不合格", 0, "两级制"),
        ]:
            db.add(GradeConversion(level_text=text, score=score, level_group=group))
    db.commit()


Base.metadata.create_all(engine)


def _migrate(db: Session):
    """轻量迁移：为已存在的旧库补列（create_all 不会 ALTER 已有表）。"""
    from sqlalchemy import text
    cols = [row[1] for row in db.execute(text("PRAGMA table_info(classes)")).fetchall()]
    if "major" not in cols:
        db.execute(text("ALTER TABLE classes ADD COLUMN major VARCHAR(64)"))
        db.commit()


with SessionLocal() as _db:
    _migrate(_db)
    seed(_db)

# 前端构建产物静态托管（宝塔只跑一个 Python 进程）
DIST = Path(__file__).resolve().parents[2] / "frontend" / "app" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.api_route("/api/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
                   include_in_schema=False)
    def api_not_found(full_path: str):
        # 未匹配的 /api 路径返回 404 JSON，而不是落到 SPA 兜底路由
        raise HTTPException(404, {"message": f"接口不存在：/api/{full_path}"})

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        # 仅允许访问 dist 内的文件：resolve 后必须在 DIST 内，防止 /../ 路径穿越读取任意文件
        target = (DIST / full_path).resolve()
        if full_path and target.is_file() and target.is_relative_to(DIST.resolve()):
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
