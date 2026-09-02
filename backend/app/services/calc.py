"""计算引擎（§13.5）：取分收敛 → 加权平均 → 综测合成 → 排名（v1.3.2 起按专业组内排名）。"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from ..models import EvalRecord, EvalScheme, ScoreRecord, Student


@dataclass
class StudentResult:
    student_id: int
    student_no: str
    name: str
    class_name: str
    weighted_total: float | None = None      # 加权总分
    total_credit: float | None = None        # 总学分
    weighted_avg: float | None = None        # 学业加权平均
    avg_gpa: float | None = None             # 平均绩点
    item_scores: dict = field(default_factory=dict)   # 项目名 -> 小计(封顶后)
    items_entered: dict = field(default_factory=dict) # 项目名 -> 是否已录入
    eval_total: float | None = None          # 综合素质测评（五项小计和）
    eval_entered: bool = False               # 是否有任何综测录入
    final_score: float | None = None         # 综合测评成绩
    academic_rank: int | None = None         # 智育排名
    eval_rank: int | None = None             # 综测排名
    special_count: int = 0                   # 特殊成绩（无百分制）条数


def resolve_scheme(db: Session, academic_year_id: int, grade_id: int | None) -> EvalScheme:
    """年级专属 > 默认方案 > 内置兜底。"""
    scheme = None
    if grade_id is not None:
        scheme = db.query(EvalScheme).filter_by(academic_year_id=academic_year_id, grade_id=grade_id).first()
    if scheme is None:
        scheme = db.query(EvalScheme).filter_by(academic_year_id=academic_year_id, grade_id=None).first()
    if scheme is None:
        scheme = db.query(EvalScheme).filter_by(academic_year_id=None, grade_id=None).first()
    if scheme is None:  # 内置兜底，保证系统开箱可用
        scheme = EvalScheme(academic_year_id=None, grade_id=None, weight_academic=0.8,
                            weight_eval=0.2, retake_rule="latest",
                            items=DEFAULT_ITEMS)
    return scheme


DEFAULT_ITEMS = [
    {"name": "思想品德", "max_score": 25, "base_template": "基础分+23"},
    {"name": "社会工作", "max_score": 20, "base_template": ""},
    {"name": "科研及科技创新", "max_score": 20, "base_template": ""},
    {"name": "文体活动", "max_score": 15, "base_template": ""},
    {"name": "集体建设", "max_score": 20,
     "base_template": "班级基础分+7\n寝室基础分+8"},
]

SEMESTER_ORDER = {"秋季": 0, "春季": 1}


def collapse_retakes(records: list[ScoreRecord], rule: str) -> list[ScoreRecord]:
    """同一课程代码多条（跨学期补考/重修）按规则取一条；无百分制的记录也参与（取最新）。"""
    by_course: dict[str, list[ScoreRecord]] = {}
    for r in records:
        by_course.setdefault(r.course_code, []).append(r)
    result = []
    for code, group in by_course.items():
        if len(group) == 1:
            result.append(group[0])
            continue
        scored = [r for r in group if r.score_num is not None]
        if rule == "highest" and scored:
            best = max(scored, key=lambda r: r.score_num)
        else:  # latest：学期序大者新，同序取库内 id 大者
            best = max(group, key=lambda r: (SEMESTER_ORDER.get(r.semester, 9), r.id))
        result.append(best)
    return result


def _aggregate_metrics(kept, eval_records, scheme) -> dict:
    """纯计算（§13.5）：收敛后的成绩记录 + 综测记录 → 指标字典。"""
    w_total, c_total, g_total = 0.0, 0.0, 0.0
    has_w, has_g = False, False
    special = 0
    for r in kept:
        if r.score_num is None:
            special += 1
            continue
        credit = r.credit if r.credit is not None else 0.0
        w_total += r.score_num * credit
        c_total += credit
        has_w = True
        if r.gpa is not None:
            g_total += r.gpa * credit
            has_g = True
    weighted_avg = round(w_total / c_total, 4) if has_w and c_total > 0 else None
    avg_gpa = round(g_total / c_total, 4) if has_g and c_total > 0 else None

    evals = {e.item_name: e for e in eval_records}
    item_scores, items_entered = {}, {}
    total = 0.0
    for item in scheme.items:
        name = item["name"]
        rec = evals.pop(name, None)
        if rec is None and len(evals):  # 方案改名后的宽松匹配（前缀包含）
            for k in list(evals):
                if k and (k in name or name in k):
                    rec = evals.pop(k)
                    break
        if rec is None:
            item_scores[name] = 0.0
            items_entered[name] = False
            continue
        items_entered[name] = True
        capped = min(rec.score or 0.0, item.get("max_score", 9999))
        item_scores[name] = round(capped, 2)
        total += capped
    for k, rec in evals.items():  # 文件里有但方案中没有的项目：原样计入
        item_scores[k] = round(rec.score or 0.0, 2)
        items_entered[k] = True
        total += rec.score or 0.0
    eval_total = round(total, 2)
    eval_entered = any(items_entered.values())
    final_score = (round(weighted_avg * (scheme.weight_academic or 0)
                         + eval_total * (scheme.weight_eval or 0), 4)
                   if weighted_avg is not None else None)
    return {"weighted_total": round(w_total, 4) if has_w and c_total > 0 else None,
            "total_credit": round(c_total, 4) if has_w and c_total > 0 else None,
            "weighted_avg": weighted_avg, "avg_gpa": avg_gpa,
            "item_scores": item_scores, "items_entered": items_entered,
            "eval_total": eval_total, "eval_entered": eval_entered,
            "final_score": final_score, "special_count": special}


def compute_student(db: Session, student: Student, academic_year_id: int,
                    scheme: EvalScheme) -> StudentResult:
    res = StudentResult(student_id=student.id, student_no=student.student_no,
                        name=student.name, class_name=student.klass.name if student.klass else "")
    records = db.query(ScoreRecord).filter_by(student_id=student.id,
                                              academic_year_id=academic_year_id).all()
    kept = collapse_retakes(records, scheme.retake_rule or "latest")
    evals = db.query(EvalRecord).filter_by(student_id=student.id,
                                           academic_year_id=academic_year_id).all()
    for k, v in _aggregate_metrics(kept, evals, scheme).items():
        setattr(res, k, v)
    return res


def compute_metrics_bulk(db: Session, students: list[Student],
                         academic_year_id: int) -> dict[int, dict]:
    """列表场景批量计算学生指标（不做排名）：每个年级仅 2 次查询，按年级各自方案合成。
    返回 {student_id: _aggregate_metrics 字典}。"""
    from collections import defaultdict
    from ..models import EvalRecord as EvalRec, ScoreRecord as ScoreRec
    by_grade: dict = defaultdict(list)
    for s in students:
        by_grade[s.klass.grade_id if s.klass else 0].append(s)
    out: dict[int, dict] = {}
    for grade_id, group in by_grade.items():
        scheme = resolve_scheme(db, academic_year_id, grade_id or None)
        sids = [s.id for s in group]
        scores_by: dict[int, list] = defaultdict(list)
        evals_by: dict[int, list] = defaultdict(list)
        if sids:
            for r in db.query(ScoreRec).filter(ScoreRec.student_id.in_(sids),
                                               ScoreRec.academic_year_id == academic_year_id):
                scores_by[r.student_id].append(r)
            for e in db.query(EvalRec).filter(EvalRec.student_id.in_(sids),
                                              EvalRec.academic_year_id == academic_year_id):
                evals_by[e.student_id].append(e)
        rule = scheme.retake_rule or "latest"
        for s in group:
            kept = collapse_retakes(scores_by.get(s.id, []), rule)
            out[s.id] = _aggregate_metrics(kept, evals_by.get(s.id, []), scheme)
    return out


def compute_rankings(results: list[StudentResult]) -> None:
    """competition ranking：同分同名次（1,1,3 式）。无加权平均值者不参与智育排名。"""
    scored = [r for r in results if r.weighted_avg is not None]
    for res, rank in _competition_rank(scored, key=lambda r: r.weighted_avg):
        res.academic_rank = rank
    finals = [r for r in results if r.final_score is not None]
    for res, rank in _competition_rank(finals, key=lambda r: r.final_score):
        res.eval_rank = rank


def _competition_rank(items: list, key):
    ordered = sorted(items, key=key, reverse=True)
    ranks, out = [], []
    prev, prev_rank = None, 0
    for i, item in enumerate(ordered, start=1):
        v = key(item)
        if prev is not None and v == prev:
            ranks.append(prev_rank)
        else:
            ranks.append(i)
            prev_rank = i
        prev = v
    return list(zip(ordered, ranks))


def major_group(class_name: str | None) -> str:
    """专业分组键自动提取（v1.3.2）：班级名去掉尾部「班号数字+可选班字」（建筑类2401 →
    建筑类；计科23班 → 计科）；不含班号的班名（如 试验班）保持原样；剥离后为空则回退全名。"""
    name = (class_name or "").strip()
    base = re.sub(r"\d+班?$", "", name).strip()
    return base or name


def student_major_group(s: Student) -> str:
    """排名分组键（v1.3.3）：班级显式 major 字段优先，为空则按班级名自动提取。"""
    explicit = (s.klass.major or "").strip() if s.klass else ""
    return explicit or major_group(s.klass.name if s.klass else "")


def compute_grade(db: Session, students: list[Student], academic_year_id: int,
                  scheme: EvalScheme) -> list[StudentResult]:
    """计算学生结果并排名（scheme 参数保留兼容；实际按各年级 resolve_scheme 解析，单年级场景等价）。

    排名范围 = 专业组（同年级内、student_major_group 相同）的全体学生，与调用方传入的
    展示子集无关——汇总页班级筛选、单班级导出、单个学生报告得到的排名口径一致。
    """
    if not students:
        return []
    from ..models import ClassInfo
    grade_ids = sorted({s.klass.grade_id for s in students if s.klass})
    all_students = (db.query(Student).join(ClassInfo).filter(
        ClassInfo.grade_id.in_(grade_ids or [0])).all()
        if grade_ids else list(students))
    metrics = compute_metrics_bulk(db, all_students, academic_year_id)
    results = {}
    for s in all_students:
        res = StudentResult(student_id=s.id, student_no=s.student_no, name=s.name,
                            class_name=s.klass.name if s.klass else "")
        for k, v in metrics.get(s.id, {}).items():
            setattr(res, k, v)
        results[s.id] = res
    groups: dict[tuple, list[StudentResult]] = {}
    for s in all_students:
        groups.setdefault((s.klass.grade_id, student_major_group(s)),
                          []).append(results[s.id])
    for members in groups.values():
        compute_rankings(members)
    return [results[s.id] for s in students]
