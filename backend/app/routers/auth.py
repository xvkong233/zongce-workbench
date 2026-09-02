"""认证路由：登录 / 当前用户 / 改密。"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import (clear_failed_login, create_token, get_current_user,
                    hash_password, register_failed_login, verify_password)
from ..database import get_db
from ..models import OperationLog, User
from ..schemas import LoginIn, PasswordIn

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(username=body.username).first()
    if user and user.locked_until and user.locked_until > datetime.now():
        raise HTTPException(status_code=423, detail={
            "message": f"连续登录失败次数过多，账号已锁定至 {user.locked_until:%H:%M}，请稍后再试"})
    if not user or not verify_password(body.password, user.salt, user.password_hash):
        if user:
            register_failed_login(user, db)
        raise HTTPException(status_code=401, detail={"message": "用户名或密码错误"})
    if not user.enabled:
        raise HTTPException(status_code=403, detail={"message": "账号已被禁用，请联系管理员"})
    clear_failed_login(user, db)
    return {"token": create_token(user), "must_change_password": user.must_change_password,
            "role": user.role, "real_name": user.real_name, "username": user.username}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "role": user.role,
            "real_name": user.real_name, "must_change_password": user.must_change_password,
            "grade_ids": [g.id for g in user.grades]}


@router.put("/password")
def change_password(body: PasswordIn, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if not verify_password(body.old_password, user.salt, user.password_hash):
        raise HTTPException(status_code=400, detail={"message": "原密码不正确"})
    user.password_hash, user.salt = hash_password(body.new_password)
    user.token_version += 1
    user.must_change_password = False
    db.add(OperationLog(operator_id=user.id, operator_name=user.username,
                        action="修改密码", detail=f"用户 {user.username} 修改密码，旧凭证已失效"))
    db.commit()
    return {"ok": True, "token": create_token(user)}
