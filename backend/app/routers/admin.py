"""账号管理 / 操作日志 / 导入批次 / 数据清理。"""
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user, hash_password, require_admin
from ..database import get_db
from ..models import (AcademicYear, ClassInfo, EvalRecord, Grade, ImportBatch,
                      OperationLog, ScoreRecord, Student, User)
from ..schemas import ClearDataIn, UserIn

router = APIRouter(tags=["admin"])


# ---------- 辅导员账号 ----------
def _user_out(u: User):
    return {"id": u.id, "username": u.username, "real_name": u.real_name,
            "enabled": u.enabled, "must_change_password": u.must_change_password,
            "grade_ids": [g.id for g in u.grades],
            "grade_names": [g.name for g in u.grades]}


@router.get("/users")
def list_users(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    return [_user_out(u) for u in db.query(User).order_by(User.username).all()]


@router.post("/users")
def create_user(body: UserIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    if db.query(User).filter_by(username=body.username).first():
        raise HTTPException(400, {"message": "用户名已存在"})
    if not body.password:
        raise HTTPException(400, {"message": "必须设置初始密码"})
    u = User(username=body.username, real_name=body.real_name, role="counselor",
             enabled=body.enabled, must_change_password=True)
    u.password_hash, u.salt = hash_password(body.password)
    u.grades = db.query(Grade).filter(Grade.id.in_(body.grade_ids)).all() if body.grade_ids else []
    db.add(u)
    db.add(OperationLog(operator_id=user.id, operator_name=user.username,
                        action="新建辅导员", detail=f"{u.username}（{u.real_name}）绑定年级 "
                                                   f"{[g.name for g in u.grades]}"))
    db.commit()
    db.refresh(u)
    return _user_out(u)


@router.put("/users/{user_id}")
def update_user(user_id: int, body: UserIn, db: Session = Depends(get_db),
                user: User = Depends(require_admin)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, {"message": "账号不存在"})
    if u.role == "admin":
        # 本页只管理辅导员账号：避免误禁用/清空管理员导致系统失去管理员
        raise HTTPException(400, {"message": "管理员账号不支持在此编辑（请在右上角修改密码）"})
    u.real_name = body.real_name
    u.enabled = body.enabled
    u.grades = db.query(Grade).filter(Grade.id.in_(body.grade_ids)).all() if body.grade_ids else []
    if body.password:  # 重置密码：旧凭证立即失效 + 首登强制改密
        u.password_hash, u.salt = hash_password(body.password)
        u.token_version += 1
        u.must_change_password = True
        u.failed_attempts, u.locked_until = 0, None
        db.add(OperationLog(operator_id=user.id, operator_name=user.username,
                            action="重置密码", detail=f"用户 {u.username} 密码被重置"))
    db.add(OperationLog(operator_id=user.id, operator_name=user.username, action="修改辅导员",
                        detail=f"{u.username} 启用={u.enabled} 年级={[g.name for g in u.grades]}"))
    db.commit()
    return _user_out(u)


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, {"message": "账号不存在"})
    if u.id == user.id:
        raise HTTPException(400, {"message": "不能删除当前登录账号"})
    if u.role == "admin":
        raise HTTPException(400, {"message": "管理员账号不支持删除"})
    db.delete(u)
    db.add(OperationLog(operator_id=user.id, operator_name=user.username,
                        action="删除辅导员", detail=u.username))
    db.commit()
    return {"ok": True}


# ---------- 操作日志 ----------
@router.get("/logs")
def list_logs(operator: str = "", action: str = "", start: str = "", end: str = "",
              page: int = 1, page_size: int = 20, db: Session = Depends(get_db),
              user: User = Depends(require_admin)):
    q = db.query(OperationLog)
    if operator:
        q = q.filter(OperationLog.operator_name.like(f"%{operator}%"))
    if action:
        q = q.filter(OperationLog.action.like(f"%{action}%"))
    try:
        if start:
            q = q.filter(OperationLog.created_at >= datetime.fromisoformat(start))
        if end:
            q = q.filter(OperationLog.created_at <= datetime.fromisoformat(end) + timedelta(days=1))
    except ValueError:
        raise HTTPException(400, {"message": "时间筛选格式应为 YYYY-MM-DD"})
    total = q.count()
    rows = q.order_by(OperationLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"total": total, "items": [{
        "id": r.id, "operator_name": r.operator_name, "action": r.action,
        "detail": r.detail, "created_at": r.created_at.isoformat(sep=" ", timespec="seconds")}
        for r in rows]}


# ---------- 导入批次 ----------
@router.get("/batches")
def list_batches(kind: str = "", page: int = 1, page_size: int = 20,
                 db: Session = Depends(get_db), user: User = Depends(require_admin)):
    q = db.query(ImportBatch)
    if kind:
        q = q.filter_by(kind=kind)
    total = q.count()
    rows = q.order_by(ImportBatch.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    from ..models import AcademicYear
    years = {y.id: y.name for y in db.query(AcademicYear).all()}
    return {"total": total, "items": [{
        "id": r.id, "kind": r.kind, "filename": r.filename,
        "year": years.get(r.academic_year_id, ""),
        "created_at": r.created_at.isoformat(sep=" ", timespec="seconds"),
        "stats": {k: v for k, v in (r.stats or {}).items() if k != "unmatched_list"},
        "snapshot_count": len(r.snapshot or []), "reverted": r.reverted} for r in rows]}


@router.post("/batches/{batch_id}/revert")
def revert_batch(batch_id: int, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """整批撤销：恢复被覆盖的旧值；删除该批新插入的记录。"""
    batch = db.get(ImportBatch, batch_id)
    if not batch:
        raise HTTPException(404, {"message": "批次不存在"})
    if batch.reverted:
        raise HTTPException(400, {"message": "该批次已撤销过"})
    restored, deleted = 0, 0
    for snap in batch.snapshot or []:
        if snap["model"] in ("ScoreRecord", "EvalRecord"):
            model = ScoreRecord if snap["model"] == "ScoreRecord" else EvalRecord
            rec = db.get(model, snap["id"])
            if rec:
                for k, v in snap["old"].items():
                    setattr(rec, k, v)
                # 恢复被覆盖前的批次归属（旧快照无此字段则保持原值）
                if "batch_id" in snap["old"]:
                    rec.batch_id = snap["old"]["batch_id"]
                restored += 1
    db.flush()  # 先落库恢复值，使下方按批次删除只命中该批新插入的记录
    if batch.kind == "score":
        deleted = db.query(ScoreRecord).filter(ScoreRecord.batch_id == batch.id).delete()
    elif batch.kind == "eval":
        deleted = db.query(EvalRecord).filter(EvalRecord.batch_id == batch.id).delete()
    batch.reverted = True
    db.add(OperationLog(operator_id=user.id, operator_name=user.username, action="批次撤销",
                        detail=f"批次#{batch.id} {batch.filename}：恢复{restored} 删除{deleted}"))
    db.commit()
    return {"restored": restored, "deleted": deleted}


@router.post("/batches/cleanup")
def cleanup_batches(days: int = 90, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """清理指定天数之前的批次快照（不影响业务数据）。"""
    threshold = datetime.now() - timedelta(days=days)
    rows = db.query(ImportBatch).filter(ImportBatch.created_at < threshold).all()
    cleaned = 0
    for b in rows:
        if b.snapshot:
            b.snapshot = []
            cleaned += 1
    db.commit()
    return {"cleaned_snapshots": cleaned, "threshold": threshold.isoformat(sep=" ", timespec="seconds")}


# ---------- 数据清理（§10.2：按学年+年级清空成绩或综测记录） ----------
@router.post("/data/clear")
def clear_data(body: ClearDataIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    year = db.get(AcademicYear, body.academic_year_id)
    if not year:
        raise HTTPException(404, {"message": "学年不存在"})
    grade = db.get(Grade, body.grade_id)
    if not grade:
        raise HTTPException(404, {"message": "年级不存在"})
    sids = [s.id for s in db.query(Student.id).join(ClassInfo).filter(
        ClassInfo.grade_id == grade.id).all()]
    if body.kind == "score":
        deleted = db.query(ScoreRecord).filter(
            ScoreRecord.student_id.in_(sids or [0]),
            ScoreRecord.academic_year_id == year.id).delete(synchronize_session=False)
    else:
        deleted = db.query(EvalRecord).filter(
            EvalRecord.student_id.in_(sids or [0]),
            EvalRecord.academic_year_id == year.id).delete(synchronize_session=False)
    kind_label = "成绩" if body.kind == "score" else "综测"
    db.add(OperationLog(operator_id=user.id, operator_name=user.username,
                        action="清空数据",
                        detail=f"清空 {year.name} {grade.name} 的{kind_label}记录 {deleted} 条"))
    db.commit()
    return {"deleted": deleted, "year": year.name, "grade": grade.name, "kind": body.kind}
