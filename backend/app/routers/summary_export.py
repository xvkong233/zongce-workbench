"""综测汇总（在线大表）/ 导出中心（工作簿/简表/学生报告）。"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import counselor_grade_ids, get_current_user
from ..database import get_db
from ..models import AcademicYear, ClassInfo, Grade, Student, User
from ..schemas import WorkbookIn
from ..services.calc import compute_grade, major_group, resolve_scheme
from ..services.export import build_workbook, sort_students

router = APIRouter(tags=["summary"])


def _accessible_students(db: Session, user: User, year_id: int, grade_id: int,
                         class_id: int | None = None, keyword: str = "", major: str = ""):
    allowed = counselor_grade_ids(user)
    if allowed is not None and grade_id not in allowed:
        raise HTTPException(403, {"message": "无权访问该年级"})
    q = db.query(Student).join(ClassInfo).filter(ClassInfo.grade_id == grade_id)
    if class_id:
        q = q.filter(Student.class_id == class_id)
    if major:  # 按班级「有效专业」（显式优先，否则班名自动提取）筛选
        ids = [c.id for c in db.query(ClassInfo).filter(ClassInfo.grade_id == grade_id).all()
               if ((c.major or "").strip() or major_group(c.name)) == major]
        q = q.filter(Student.class_id.in_(ids or [0]))
    if keyword:
        q = q.filter((Student.student_no.like(f"%{keyword}%")) | (Student.name.like(f"%{keyword}%")))
    return q.all()


@router.get("/summary")
def summary(academic_year_id: int, grade_id: int, class_id: int | None = None,
            keyword: str = "", major: str = "",
            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    year = db.get(AcademicYear, academic_year_id)
    grade = db.get(Grade, grade_id)
    if not year or not grade:
        raise HTTPException(404, {"message": "学年或年级不存在"})
    students = _accessible_students(db, user, academic_year_id, grade_id, class_id, keyword, major)
    scheme = resolve_scheme(db, year.id, grade.id)
    results = compute_grade(db, students, year.id, scheme)
    results.sort(key=lambda r: (r.eval_rank is None, r.eval_rank if r.eval_rank else 0))
    return {
        "scheme": {"weight_academic": scheme.weight_academic, "weight_eval": scheme.weight_eval,
                   "items": scheme.items, "retake_rule": scheme.retake_rule},
        "rows": [{
            "student_id": r.student_id, "student_no": r.student_no, "name": r.name,
            "class_name": r.class_name,
            "weighted_avg": r.weighted_avg, "avg_gpa": r.avg_gpa,
            "items": [{"name": n, "score": r.item_scores.get(n), "entered": r.items_entered.get(n)}
                      for n in (i["name"] for i in scheme.items)],
            "eval_entered": r.eval_entered, "eval_total": r.eval_total,
            "final_score": r.final_score, "academic_rank": r.academic_rank,
            "eval_rank": r.eval_rank, "special_count": r.special_count,
        } for r in results]}


@router.post("/export/workbook")
def export_workbook(body: WorkbookIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    year = db.get(AcademicYear, body.academic_year_id)
    if not year:
        raise HTTPException(404, {"message": "学年不存在"})
    allowed = counselor_grade_ids(user)
    grade_q = db.query(Grade).order_by(Grade.enrollment_year)
    if body.grade_ids:
        grade_q = grade_q.filter(Grade.id.in_(body.grade_ids))
    grades = grade_q.all()
    class_filter = set(body.class_ids) if body.class_ids else None
    payload = []
    for g in grades:
        if allowed is not None and g.id not in allowed:
            continue
        q = db.query(Student).join(ClassInfo).filter(ClassInfo.grade_id == g.id)
        if class_filter:
            q = q.filter(Student.class_id.in_(class_filter))
        students = sort_students(q.all())
        if students:
            payload.append((g, students))
    if not payload:
        raise HTTPException(400, {"message": "所选范围内没有学生数据"})
    wb = build_workbook(db, year, payload, class_ids=body.class_ids, brief=body.brief)
    import io
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    scope = f"{year.name}_" + ("综测简表" if body.brief else "综测汇总")
    filename = scope + ".xlsx"
    from urllib.parse import quote
    return StreamingResponse(iter([buf.getvalue()]),
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition":
                                      f"attachment; filename*=UTF-8''{quote(filename)}"})


@router.get("/export/student-report")
def student_report(student_id: int, academic_year_id: int | None = None,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """单学生报告。带 academic_year_id 返回该学年明细；省略时返回历年总览
    （各学年学业/综测/排名维度汇总，供学生管理页等无学年上下文的入口使用）。"""
    s = db.get(Student, student_id)
    if not s:
        raise HTTPException(404, {"message": "学生不存在"})
    allowed = counselor_grade_ids(user)
    if allowed is not None and (not s.klass or s.klass.grade_id not in allowed):
        raise HTTPException(403, {"message": "无权查看该学生"})
    grade = s.klass.grade if s.klass else None
    student_info = {"student_no": s.student_no, "name": s.name,
                    "class_name": s.klass.name if s.klass else "",
                    "grade_name": grade.name if grade else ""}

    from ..models import EvalRecord, ScoreRecord
    if academic_year_id is None:
        summaries = []
        for year in db.query(AcademicYear).order_by(AcademicYear.name.desc()).all():
            scheme = resolve_scheme(db, year.id, grade.id if grade else None)
            r = compute_grade(db, [s], year.id, scheme)[0]
            score_count = db.query(ScoreRecord).filter_by(
                student_id=s.id, academic_year_id=year.id).count()
            eval_count = db.query(EvalRecord).filter_by(
                student_id=s.id, academic_year_id=year.id).count()
            summaries.append({
                "academic_year_id": year.id, "year": year.name,
                "score_count": score_count, "eval_count": eval_count,
                "has_data": score_count > 0 or eval_count > 0,
                "weighted_avg": r.weighted_avg, "avg_gpa": r.avg_gpa,
                "eval_entered": r.eval_entered, "eval_total": r.eval_total,
                "final_score": r.final_score,
                "academic_rank": r.academic_rank, "eval_rank": r.eval_rank,
                "special_count": r.special_count})
        return {"student": student_info, "summaries": summaries}

    scheme = resolve_scheme(db, academic_year_id, grade.id if grade else None)
    result = compute_grade(db, [s], academic_year_id, scheme)[0]
    year = db.get(AcademicYear, academic_year_id)
    scores = db.query(ScoreRecord).filter_by(student_id=s.id, academic_year_id=academic_year_id).all()
    evals = db.query(EvalRecord).filter_by(student_id=s.id, academic_year_id=academic_year_id).all()
    return {
        "student": student_info,
        "year": year.name if year else "",
        "summary": {"weighted_avg": result.weighted_avg, "avg_gpa": result.avg_gpa,
                    "items": result.item_scores, "entered": result.items_entered,
                    "eval_total": result.eval_total, "eval_entered": result.eval_entered,
                    "final_score": result.final_score, "academic_rank": result.academic_rank,
                    "eval_rank": result.eval_rank, "special_count": result.special_count},
        "scores": [{"semester": r.semester, "course_code": r.course_code, "course_name": r.course_name,
                    "credit": r.credit, "score_raw": r.score_raw, "score_num": r.score_num,
                    "gpa": r.gpa} for r in scores],
        "evals": [{"item_name": e.item_name, "detail_text": e.detail_text, "score": e.score} for e in evals],
    }
