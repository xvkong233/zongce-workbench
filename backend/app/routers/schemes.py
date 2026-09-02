"""综测方案（默认/年级专属）与等级换算表。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_admin
from ..database import get_db
from ..models import EvalScheme, Grade, GradeConversion, OperationLog, User
from ..schemas import ConversionIn, SchemeIn
from ..services.calc import DEFAULT_ITEMS

router = APIRouter(prefix="/schemes", tags=["schemes"])


def _scheme_out(s: EvalScheme):
    return {"id": s.id, "academic_year_id": s.academic_year_id, "grade_id": s.grade_id,
            "weight_academic": s.weight_academic, "weight_eval": s.weight_eval,
            "retake_rule": s.retake_rule, "items": s.items}


@router.get("/default")
def get_default(academic_year_id: int | None = None, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    s = db.query(EvalScheme).filter_by(academic_year_id=academic_year_id, grade_id=None).first()
    if s is None and academic_year_id is not None:
        s = db.query(EvalScheme).filter_by(academic_year_id=None, grade_id=None).first()
    if s is None:
        return {"academic_year_id": academic_year_id, "weight_academic": 0.8, "weight_eval": 0.2,
                "retake_rule": "latest", "items": DEFAULT_ITEMS, "inherited": True}
    out = _scheme_out(s)
    out["inherited"] = False
    return out


@router.put("/default")
def put_default(body: SchemeIn, academic_year_id: int | None = None,
                db: Session = Depends(get_db), user: User = Depends(require_admin)):
    s = db.query(EvalScheme).filter_by(academic_year_id=academic_year_id, grade_id=None).first()
    if s is None:
        s = EvalScheme(academic_year_id=academic_year_id, grade_id=None)
        db.add(s)
    s.weight_academic, s.weight_eval = body.weight_academic, body.weight_eval
    s.retake_rule = body.retake_rule
    s.items = [i.model_dump() for i in body.items]
    db.add(OperationLog(operator_id=user.id, operator_name=user.username, action="修改综测方案",
                        detail=f"学年 {academic_year_id or '默认'} 权重 {body.weight_academic}/{body.weight_eval}"))
    db.commit()
    db.refresh(s)
    return _scheme_out(s)


@router.get("/grade")
def list_grade_schemes(academic_year_id: int, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    rows = db.query(EvalScheme).filter_by(academic_year_id=academic_year_id).filter(
        EvalScheme.grade_id.isnot(None)).all()
    return [_scheme_out(s) for s in rows]


@router.put("/grade/{grade_id}")
def put_grade_scheme(grade_id: int, body: SchemeIn, academic_year_id: int,
                     db: Session = Depends(get_db), user: User = Depends(require_admin)):
    if not db.get(Grade, grade_id):
        raise HTTPException(404, {"message": "年级不存在"})
    s = db.query(EvalScheme).filter_by(academic_year_id=academic_year_id, grade_id=grade_id).first()
    if s is None:
        s = EvalScheme(academic_year_id=academic_year_id, grade_id=grade_id)
        db.add(s)
    s.weight_academic, s.weight_eval = body.weight_academic, body.weight_eval
    s.retake_rule = body.retake_rule
    s.items = [i.model_dump() for i in body.items]
    db.commit()
    db.refresh(s)
    return _scheme_out(s)


@router.delete("/grade/{grade_id}")
def delete_grade_scheme(grade_id: int, academic_year_id: int, db: Session = Depends(get_db),
                        user: User = Depends(require_admin)):
    s = db.query(EvalScheme).filter_by(academic_year_id=academic_year_id, grade_id=grade_id).first()
    if not s:
        raise HTTPException(404, {"message": "该年级没有专属方案"})
    db.delete(s)
    db.add(OperationLog(operator_id=user.id, operator_name=user.username, action="清除年级专属方案",
                        detail=f"grade {grade_id} 恢复跟随默认方案"))
    db.commit()
    return {"ok": True}


# ---------- 等级换算表 ----------
@router.get("/conversions")
def list_conversions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(GradeConversion).order_by(GradeConversion.level_group, GradeConversion.score.desc()).all()
    return [{"id": c.id, "level_text": c.level_text, "score": c.score,
             "level_group": c.level_group} for c in rows]


@router.post("/conversions")
def upsert_conversion(body: ConversionIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    c = db.query(GradeConversion).filter_by(level_text=body.level_text.strip()).first()
    if c:
        c.score, c.level_group = body.score, body.level_group
    else:
        c = GradeConversion(level_text=body.level_text.strip(), score=body.score,
                            level_group=body.level_group)
        db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id, "level_text": c.level_text, "score": c.score, "level_group": c.level_group}


@router.delete("/conversions/{cid}")
def delete_conversion(cid: int, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    c = db.get(GradeConversion, cid)
    if not c:
        raise HTTPException(404, {"message": "换算项不存在"})
    db.delete(c)
    db.commit()
    return {"ok": True}
