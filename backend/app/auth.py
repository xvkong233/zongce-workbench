"""认证：PBKDF2-SHA256 加盐 + JWT（含 token_version 失效机制）+ 角色依赖。"""
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .database import get_db
from .models import User

JWT_SECRET = os.environ.get("ZONGCE_JWT_SECRET", "zongce-workbench-secret-change-me")
JWT_EXPIRE_HOURS = 24
MAX_FAILED = 5
LOCK_MINUTES = 10

CREDENTIAL_ERROR = HTTPException(status_code=401, detail={"message": "登录状态已失效，请重新登录"})


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return digest.hex(), salt


def verify_password(password: str, salt: str, expected: str) -> bool:
    digest, _ = hash_password(password, salt)
    return secrets.compare_digest(digest, expected)


def create_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "tv": user.token_version,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise CREDENTIAL_ERROR
    try:
        payload = jwt.decode(header[7:], JWT_SECRET, algorithms=["HS256"])
        user = db.get(User, int(payload["sub"]))
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        # 签名无效 / 缺少 sub / sub 非数字：一律视为凭证失效，而非 500
        raise CREDENTIAL_ERROR
    if not user or not user.enabled or user.token_version != payload.get("tv"):
        raise CREDENTIAL_ERROR
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail={"message": "需要管理员权限"})
    return user


def counselor_grade_ids(user: User) -> list[int] | None:
    """管理员返回 None（不限制）；辅导员返回所辖年级 id 列表（可能为空）。"""
    if user.role == "admin":
        return None
    return [g.id for g in user.grades]


def ensure_grade_access(user: User, grade_id: int | None):
    allowed = counselor_grade_ids(user)
    if allowed is not None and (grade_id is None or grade_id not in allowed):
        raise HTTPException(status_code=403, detail={"message": "无权访问该年级数据"})


def register_failed_login(user: User, db: Session):
    user.failed_attempts += 1
    if user.failed_attempts >= MAX_FAILED:
        user.locked_until = datetime.now() + timedelta(minutes=LOCK_MINUTES)
        user.failed_attempts = 0
    db.commit()


def clear_failed_login(user: User, db: Session):
    if user.failed_attempts or user.locked_until:
        user.failed_attempts = 0
        user.locked_until = None
        db.commit()
