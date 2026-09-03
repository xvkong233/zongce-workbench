"""数据总览（中台仪表盘数据源）：按学年的导入情况与综测完成度、综测数据有误名单。

返回口径：
- totals：所辖范围内全局汇总（学生/班级/成绩记录/综测已录入/完成度/数据有误人数）；
- grade_rows：每个年级一行，附 classes 班级级完成度、未录入名单样例、
  eval_mismatch_students（综测「±明细求和」与得分不符的学生数，封顶填写不算）与样例。
辅导员仅能看到所辖年级，totals 亦按可见范围汇总。

另提供 /overview/eval-mismatches：全量数据有误名单（含项目级明细），供导出前提醒。
"""
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import counselor_grade_ids, get_current_user
from ..database import get_db
from ..models import (AcademicYear, ClassInfo, EvalRecord, Grade, Student, User)
from ..services.calc import resolve_scheme
from ..services.convert import is_detail_mismatch, sum_detail_terms

router = APIRouter(prefix="/overview", tags=["overview"])


def _mismatch_items_by_student(db: Session, year: AcademicYear, students: list[Student],
                               grade_id: int) -> dict[int, list[dict]]:
    """学年内该年级学生的综测明细不符清单：{student_id: [{item_name, soft_sum, score, diff}]}。"""
    max_by_name = {i["name"]: i.get("max_score")
                   for i in resolve_scheme(db, year.id, grade_id).items}
    sids = [s.id for s in students]
    by_student: dict[int, list[dict]] = defaultdict(list)
    if not sids:
        return by_student
    for e in db.query(EvalRecord).filter(
            EvalRecord.student_id.in_(sids), EvalRecord.academic_year_id == year.id).all():
        soft = sum_detail_terms(e.detail_text) if e.detail_text else None
        if is_detail_mismatch(soft, e.score, max_by_name.get(e.item_name)):
            by_student[e.student_id].append({
                "item_name": e.item_name, "soft_sum": soft, "score": e.score,
                "diff": round((soft or 0) - (e.score or 0), 2)})
    return by_student


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
              "eval_entered_students": 0, "eval_mismatch_students": 0, "eval_completion": 0.0}
    grade_rows = []
    for g in grades:
        classes = db.query(ClassInfo).filter_by(grade_id=g.id).order_by(ClassInfo.name).all()
        class_ids = [c.id for c in classes]
        students = db.query(Student).filter(Student.class_id.in_(class_ids or [0])).all()
        sids = [s.id for s in students]
        score_cnt = 0
        entered: set[int] = set()
        mismatch_by_student: dict[int, list[dict]] = {}
        if year and sids:
            score_cnt = db.query(ScoreRecord).filter(
                ScoreRecord.student_id.in_(sids), ScoreRecord.academic_year_id == year.id).count()
            mismatch_by_student = _mismatch_items_by_student(db, year, students, g.id)
            entered = {e.student_id for e in db.query(EvalRecord.student_id).filter(
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

        students_by_id = {s.id: s for s in students}
        unentered = [s for s in students if s.id not in entered] if year else []
        mismatched = [s for s in students if s.id in mismatch_by_student] if year else []
        grade_rows.append({
            "grade_id": g.id, "grade_name": g.name,
            "class_count": len(classes),
            "student_count": len(students),
            "score_records": score_cnt,
            "eval_entered_students": len(entered),
            "eval_unentered": len(unentered),
            "eval_completion": round(len(entered) / len(students) * 100, 1) if students else 100.0,
            "eval_mismatch_students": len(mismatched),
            "classes": class_rows,
            "unentered_sample": [{"student_no": s.student_no, "name": s.name,
                                  "class_name": s.klass.name if s.klass else ""}
                                 for s in unentered[:50]],
            "mismatch_sample": [{"student_no": s.student_no, "name": s.name,
                                 "class_name": s.klass.name if s.klass else "",
                                 "items": mismatch_by_student.get(s.id, [])}
                                for s in mismatched[:50]],
        })
        totals["student_count"] += len(students)
        totals["class_count"] += len(classes)
        totals["score_records"] += score_cnt
        totals["eval_entered_students"] += len(entered)
        totals["eval_mismatch_students"] += len(mismatched)

    entered_all = totals["eval_entered_students"]
    totals["eval_completion"] = round(
        entered_all / totals["student_count"] * 100, 1) if totals["student_count"] else 100.0
    return {"years": [{"id": y.id, "name": y.name} for y in years],
            "current_year_id": year.id if year else None,
            "totals": totals,
            "grade_rows": grade_rows}


@router.get("/eval-mismatches")
def eval_mismatches(academic_year_id: int, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """全量综测数据有误名单（含项目级明细），供导出前提醒与核对。"""
    year = db.get(AcademicYear, academic_year_id)
    if not year:
        raise HTTPException(404, {"message": "学年不存在"})
    allowed = counselor_grade_ids(user)
    grade_q = db.query(Grade).order_by(Grade.enrollment_year.desc())
    grades = grade_q.all()
    if allowed is not None:
        grades = [g for g in grades if g.id in allowed]

    students_out = []
    for g in grades:
        class_ids = [c.id for c in db.query(ClassInfo).filter_by(grade_id=g.id).all()]
        students = db.query(Student).filter(Student.class_id.in_(class_ids or [0])).all()
        mismatch_by_student = _mismatch_items_by_student(db, year, students, g.id)
        for s in students:
            items = mismatch_by_student.get(s.id)
            if items:
                students_out.append({
                    "student_no": s.student_no, "name": s.name,
                    "grade_id": g.id, "grade_name": g.name,
                    "class_id": s.class_id,
                    "class_name": s.klass.name if s.klass else "",
                    "items": items,
                })
    return {"count": len(students_out), "students": students_out}
