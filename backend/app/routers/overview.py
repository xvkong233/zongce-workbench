"""数据总览（中台仪表盘数据源）：按学年的导入情况与综测完成度。

返回口径：
- totals：所辖范围内全局汇总（学生/班级/成绩记录/综测已录入/完成度）；
- grade_rows：每个年级一行，附 classes 班级级完成度与未录入名单样例。
辅导员仅能看到所辖年级，totals 亦按可见范围汇总。
"""
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import counselor_grade_ids, get_current_user
from ..database import get_db
from ..models import (AcademicYear, ClassInfo, EvalRecord, Grade, Student, User)

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
        return {"years": [], "current_year_id": None, "totals": {}, "grade_rows": []}

    years = db.query(AcademicYear).order_by(AcademicYear.name.desc()).all()
    year = db.get(AcademicYear, academic_year_id) if academic_year_id else (years[0] if years else None)

    totals = {"student_count": 0, "class_count": 0, "score_records": 0,
              "eval_entered_students": 0, "eval_completion": 0.0}
    grade_rows = []
    for g in grades:
        classes = db.query(ClassInfo).filter_by(grade_id=g.id).order_by(ClassInfo.name).all()
        class_ids = [c.id for c in classes]
        students = db.query(Student).filter(Student.class_id.in_(class_ids or [0])).all()
        sids = [s.id for s in students]
        score_cnt = 0
        entered = set()
        if year and sids:
            score_cnt = db.query(ScoreRecord).filter(
                ScoreRecord.student_id.in_(sids), ScoreRecord.academic_year_id == year.id).count()
            entered = {sid for (sid,) in db.query(EvalRecord.student_id).filter(
                EvalRecord.student_id.in_(sids),
                EvalRecord.academic_year_id == year.id).all()}

        # 班级级完成度
        sids_by_class = defaultdict(list)
        for s in students:
            sids_by_class[s.class_id].append(s.id)
        class_rows = []
        for c in classes:
            c_sids = sids_by_class.get(c.id, [])
            c_entered = sum(1 for sid in c_sids if sid in entered)
            class_rows.append({
                "id": c.id, "name": c.name,
                "student_count": len(c_sids), "eval_entered": c_entered,
                "eval_completion": round(c_entered / len(c_sids) * 100, 1) if c_sids else 100.0,
            })

        unentered = [s for s in students if s.id not in entered] if year else []
        grade_rows.append({
            "grade_id": g.id, "grade_name": g.name,
            "class_count": len(classes),
            "student_count": len(students),
            "score_records": score_cnt,
            "eval_entered_students": len(entered),
            "eval_unentered": len(unentered),
            "eval_completion": round(len(entered) / len(students) * 100, 1) if students else 100.0,
            "classes": class_rows,
            "unentered_sample": [{"student_no": s.student_no, "name": s.name,
                                  "class_name": s.klass.name if s.klass else ""}
                                 for s in unentered[:50]],
        })
        totals["student_count"] += len(students)
        totals["class_count"] += len(classes)
        totals["score_records"] += score_cnt
        totals["eval_entered_students"] += len(entered)

    entered_all = totals["eval_entered_students"]
    totals["eval_completion"] = round(
        entered_all / totals["student_count"] * 100, 1) if totals["student_count"] else 100.0
    return {"years": [{"id": y.id, "name": y.name} for y in years],
            "current_year_id": year.id if year else None,
            "totals": totals,
            "grade_rows": grade_rows}
