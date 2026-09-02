"""数据总览：按学年的导入情况与综测完成度，含「未录名单」下钻。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import counselor_grade_ids, get_current_user
from ..database import get_db
from ..models import (AcademicYear, ClassInfo, EvalRecord, Grade, Student, User)
from ..services.calc import resolve_scheme

router = APIRouter(prefix="/overview", tags=["overview"])


@router.get("")
def overview(academic_year_id: int | None = None, db: Session = Depends(get_db),
             user: User = Depends(get_current_user)):
    from ..models import ScoreRecord
    allowed = counselor_grade_ids(user)
    grade_q = db.query(Grade).order_by(Grade.enrollment_year.desc())
    grades = grade_q.all()
    if allowed is not None:
        grades = [g for g in grades if g.id in allowed]
    if not grades:
        return {"years": [], "grade_rows": []}

    years = db.query(AcademicYear).order_by(AcademicYear.name.desc()).all()
    year = db.get(AcademicYear, academic_year_id) if academic_year_id else (years[0] if years else None)

    grade_rows = []
    for g in grades:
        classes = db.query(ClassInfo).filter_by(grade_id=g.id).all()
        class_ids = [c.id for c in classes]
        students = db.query(Student).filter(Student.class_id.in_(class_ids or [0])).all()
        sids = [s.id for s in students]
        score_cnt = eval_cnt = entered_students = 0
        if year and sids:
            score_cnt = db.query(ScoreRecord).filter(
                ScoreRecord.student_id.in_(sids), ScoreRecord.academic_year_id == year.id).count()
            evals = db.query(EvalRecord).filter(
                EvalRecord.student_id.in_(sids), EvalRecord.academic_year_id == year.id).all()
            eval_cnt = len(evals)
            entered_students = len({e.student_id for e in evals})
        unentered = [s for s in students if s.id not in
                     {e.student_id for e in db.query(EvalRecord).filter(
                         EvalRecord.student_id.in_(sids or [0]),
                         EvalRecord.academic_year_id == (year.id if year else 0)).all()}] if year else []
        grade_rows.append({
            "grade_id": g.id, "grade_name": g.name,
            "class_count": len(classes),
            "student_count": len(students),
            "score_records": score_cnt,
            "eval_entered_students": entered_students,
            "eval_unentered": len(unentered),
            "eval_completion": round(entered_students / len(students) * 100, 1) if students else 100.0,
            "unentered_sample": [{"student_no": s.student_no, "name": s.name,
                                  "class_name": s.klass.name if s.klass else ""}
                                 for s in unentered[:50]],
        })
    return {"years": [{"id": y.id, "name": y.name} for y in years],
            "current_year_id": year.id if year else None,
            "grade_rows": grade_rows}
