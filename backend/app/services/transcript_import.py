"""成绩单 PDF 补录：PyMuPDF 坐标级解析东北大学教务成绩单，按「学号+学年+学期+课程名」匹配已有记录实现补录/更正。

成绩单没有课程代码，课程名是唯一可依据的业务键——归一化（去空白、全角括号转半角）后
与学生同学年学期的已有 ScoreRecord 按课程名匹配：命中则覆盖（保留教师/绩点），未命中则新增
（course_code 以课程名代替）。全部入库走批次快照，可整批回滚。

解析采用锚点法而非表头对齐：每行明细必含「学年学期」（2024-2025-1 式）锚点词，
锚点左侧最左数字为序号、其余为课程名；右侧按表头词间距导出的列界分为学分/成绩/课程类别，
分列结果不合理时回退到「数字-数字-类别词」模式识别。"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import pymupdf
from sqlalchemy.orm import Session

from ..models import (AcademicYear, ClassInfo, College, Grade, ImportBatch,
                      OperationLog, ScoreRecord, Student)
from .convert import convert_level, parse_number
from .score_import import (SEMESTER_ALIASES, infer_enrollment_year,
                           infer_grade_name, normalize_class_name)

# 表头键值对标签（第 1 页网格 + 第 2 页「学号：xxx」两种版式）
LABELS = ("姓名", "学院", "入学时间", "性别", "专业", "预计毕业时间", "学号", "班级", "学制")
# 表格终止标志：页脚署名/打印时间/电子签章、页尾 GPA、记载说明、毕业设计题目行
STOP_MARKS = ("总平均学分绩点", "成绩记载方法说明", "契约锁", "毕业设计",
              "东北大学教务处", "打印日期")

TERM_RE = re.compile(r"^(\d{4})-(\d{4})[-—](\d+)$")
SEQ_RE = re.compile(r"^\d{1,3}$")
NUM_RE = re.compile(r"^\d+(?:\.\d+)?$")
CATEGORY_WORDS = {"必修", "选修", "限选", "任选", "公必", "公选", "专必", "专选",
                  "实践环节", "其他"}
CONT_GAP = 5.0  # 续行判定：词右缘须落在学期锚左侧留白之内
_WS_RE = re.compile(r"[\s\u3000]+")


def normalize_course_name(name: str) -> str:
    s = _WS_RE.sub("", str(name or ""))
    return s.replace("（", "(").replace("）", ")").lower()


@dataclass
class TranscriptRow:
    seq: int
    course_name: str
    year: str
    semester: str
    credit: float | None
    score_raw: str
    score_num: float | None
    course_category: str = ""
    is_elective: str = ""
    retake_type: str = ""
    # 以下由 match/confirm 阶段填充
    status: str = "new"            # new | overwrite | error
    existing_id: int | None = None
    existing_score_raw: str = ""
    exception: str = ""


@dataclass
class TranscriptFile:
    filename: str
    student_no: str = ""
    name: str = ""
    class_name: str = ""
    college: str = ""
    major: str = ""
    enrollment_year: int | None = None   # 成绩单「入学时间」，年级推断兜底
    gpa_total: float | None = None
    create_student: bool = False         # 学号不在系统：确认入库时自动建档
    rows: list[TranscriptRow] = field(default_factory=list)
    exceptions: list[dict] = field(default_factory=list)
    error: str = ""                # 文件级错误（无法解析 / 学生不存在等），非空则整份跳过

    @property
    def student_label(self) -> str:
        return f"{self.name or '未知姓名'}（{self.student_no or '未知学号'}）"

    def inferred_grade_name(self) -> str | None:
        """年级名：班级名数字推断优先，「入学时间」年份兜底。"""
        return infer_grade_name(self.class_name) or \
            (f"{self.enrollment_year % 100}级" if self.enrollment_year else None)


def _visual_lines(page) -> list[tuple[float, list[tuple[float, float, str]]]]:
    """页面 → 视觉行列表 [(行首 y, [(x0, x1, 文本)])]，按 y 聚类、行内按 x 排序。"""
    words = sorted(page.get_text("words"), key=lambda w: (w[1], w[0]))
    lines: list[list] = []
    cur: list = []
    cur_y: float | None = None
    for w in words:
        if cur_y is None or abs(w[1] - cur_y) <= 3.5:
            cur.append(w)
            cur_y = w[1] if cur_y is None else min(cur_y, w[1])
        else:
            lines.append(cur)
            cur, cur_y = [w], w[1]
    if cur:
        lines.append(cur)
    out = []
    for ln in lines:
        ln.sort(key=lambda w: w[0])
        out.append((ln[0][1], [(w[0], w[2], w[4]) for w in ln]))
    return out


def _parse_header_line(text: str, info: dict) -> None:
    """一行表头文本 → 提取「标签 值」与「标签：值」两种版式，已有值不覆盖。"""
    for label in LABELS:
        if label in info:
            continue
        m = re.search(rf"{label}[:：]\s*(\S+)", text)
        if not m:
            m = re.search(rf"{label}\s+([^\s:：]+)", text)
        if m:
            info[label] = m.group(1)


def _column_bounds(header_ln: list[tuple[float, float, str]]) -> tuple[float, float, float] | None:
    """由表头词位置导出锚点右侧的列界（学期|学分、学分|成绩、成绩|类别）。"""
    pos = {t: (x0, x1) for x0, x1, t in header_ln}
    try:
        b1 = (pos["学年学期"][1] + pos["学分"][0]) / 2
        b2 = (pos["学分"][1] + pos["成绩"][0]) / 2
        if "课程类别" in pos:
            b3 = (pos["成绩"][1] + pos["课程类别"][0]) / 2
        else:
            b3 = b2 + (b2 - b1)
        return b1, b2, b3
    except KeyError:
        return None


def _split_right(tokens: list[tuple[float, float, str]],
                 bounds: tuple[float, float, float] | None) -> tuple[str, str, str]:
    """锚点右侧词 → (学分文本, 成绩文本, 类别文本)。列数据在列宽内居中，
    按表头词间距导出的「学分|成绩」「成绩|类别」界线分箱；形态不合理时回退模式识别。"""
    if bounds is not None:
        _, b2, b3 = bounds
        credit = [t for x0, x1, t in tokens if x0 < b2]
        score = [t for x0, x1, t in tokens if b2 <= x0 < b3]
        cat = [t for x0, x1, t in tokens if x0 >= b3]
        # 学分须全为数字、类别列不得混入数字；成绩列允许任意文本（未知等级走异常）
        ok = (all(NUM_RE.match(t) for t in credit)
              and not any(NUM_RE.match(t) for t in cat)
              and (bool(score) or bool(credit)))
        if ok:
            return "".join(credit), "".join(score), "".join(cat)
    # 模式识别兜底：数字（≤2 个，按 x 序为学分、成绩）、等级词、类别词、其余文本归成绩
    credit, score, cat = [], [], []
    for x0, x1, t in tokens:
        if NUM_RE.match(t):
            (credit if not credit or not score else score).append(t)
        elif t in CATEGORY_WORDS:
            cat.append(t)
        else:
            score.append(t)
    return "".join(credit), "".join(score), "".join(cat)


def parse_transcript_pdf(filename: str, data: bytes,
                         conversion: dict[str, float]) -> TranscriptFile:
    tf = TranscriptFile(filename=filename)
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        tf.error = "无法打开 PDF 文件"
        return tf
    try:
        info: dict[str, str] = {}
        seen_table = False
        for page in doc:
            lines = _visual_lines(page)
            header_idx, bounds = None, None
            for i, (y, ln) in enumerate(lines):
                texts = [t for _, _, t in ln]
                if "序号" in texts and "课程名称" in texts and "学年学期" in texts:
                    header_idx = i
                    bounds = _column_bounds(ln)
                    break
            for y, ln in (lines[:header_idx] if header_idx is not None else lines):
                _parse_header_line(" ".join(t for _, _, t in ln), info)
            if header_idx is None:
                continue
            seen_table = True

            cur: TranscriptRow | None = None
            term_x0: float | None = None
            ri = header_idx + 1
            while ri < len(lines):
                y, ln = lines[ri]
                ri += 1
                joined = " ".join(t for _, _, t in ln)
                term = next(((x0, x1, t) for x0, x1, t in ln if TERM_RE.match(t)), None)
                if term is None and any(m in joined for m in STOP_MARKS):
                    # 「毕业设计（论文）题目：」行可能先于 GPA 行出现：跳过本行继续找
                    if "总平均学分绩点" in joined:
                        m2 = re.search(r"\d+\.\d+", joined)
                        if not m2 and ri < len(lines):  # 版式二：数值在下一行
                            m2 = re.search(r"\d+\.\d+", " ".join(t for _, _, t in lines[ri][1]))
                        if m2:
                            tf.gpa_total = float(m2.group(0))
                        break
                    if "毕业设计" not in joined:
                        break
                    continue
                if term is None:
                    # 无锚点的行：课程名过长换行 → 并入上一行；其余（页码等）忽略
                    if cur is not None and term_x0 is not None and \
                        ln and all(x1 <= term_x0 - CONT_GAP for _, x1, _ in ln):
                        cur.course_name += "".join(t for _, _, t in ln)
                    continue
                term_x0 = term[0] if term_x0 is None else min(term_x0, term[0])
                left = [w for w in ln if w[2] is not term[2] and w[0] < term[0]]
                seq_text = left[0][2] if left else ""
                if SEQ_RE.match(seq_text):
                    cur = _build_row(int(seq_text),
                                     "".join(t for _, _, t in left[1:]),
                                     term[2], _split_right(ln[ln.index(term) + 1:], bounds),
                                     conversion, tf)
                    tf.rows.append(cur)
                elif cur is not None and left and \
                        all(x1 <= term_x0 - CONT_GAP for _, x1, _ in left):
                    cur.course_name += "".join(t for _, _, t in left)

        if not seen_table:
            tf.error = "未识别出成绩单表格（表头需含 序号/课程名称/学年学期/学分/成绩）"
            return tf
        if not tf.rows:
            tf.error = "成绩单中未解析出课程明细"
            return tf

        tf.student_no = info.get("学号", "")
        tf.name = info.get("姓名", "")
        tf.class_name = normalize_class_name(info.get("班级", ""))
        tf.college = info.get("学院", "")
        tf.major = info.get("专业", "")
        m_enroll = re.match(r"(\d{4})", info.get("入学时间", ""))
        if m_enroll:
            tf.enrollment_year = int(m_enroll.group(1))
        if not tf.student_no:
            tf.error = "未识别到学号，请确认上传的是正式成绩单"
            return tf
        # 文件内同（学年+学期+课程名）以靠后记录为准（与长表导入口径一致）
        dedup: dict[tuple, TranscriptRow] = {}
        for r in tf.rows:
            dedup[(r.year, r.semester, normalize_course_name(r.course_name))] = r
        tf.rows = list(dedup.values())
    finally:
        doc.close()
    return tf


def _build_row(seq: int, name: str, term: str,
               right: tuple[str, str, str], conversion: dict[str, float],
               tf: TranscriptFile) -> TranscriptRow:
    credit_text, score_text, category = right
    m = TERM_RE.match(term)
    year = f"{m.group(1)}-{m.group(2)}" if m else term
    semester = SEMESTER_ALIASES.get(m.group(3), "") if m else \
        SEMESTER_ALIASES.get(term, SEMESTER_ALIASES.get(term[:1], ""))
    if not semester:
        tf.exceptions.append({"type": "未知学期", "detail": f"第{seq}行 {name} 学年学期「{term}」"})
        semester = "秋季"

    credit = parse_number(credit_text)
    if credit is None:
        tf.exceptions.append({"type": "缺学分",
                              "detail": f"第{seq}行 {name}（不计入加权统计）"})

    score_raw = score_text.strip()
    retake = ""
    if "△" in score_raw:
        retake = "重修重考"
        score_raw = score_raw.replace("△", "").strip()
    score_num = parse_number(score_raw)
    exception = ""
    if score_num is None and score_raw:
        score_num = convert_level(score_raw, conversion)
        if score_num is None:
            exception = f"未知等级「{score_raw}」，保留入库不计入统计"

    return TranscriptRow(
        seq=seq, course_name=name, year=year, semester=semester,
        credit=credit, score_raw=score_raw, score_num=score_num,
        course_category=category, is_elective="是" if category == "选修" else "",
        retake_type=retake, exception=exception)


def match_transcripts(db: Session, files: list[TranscriptFile], allowed_grade_ids=None) -> None:
    """对照数据库标记每行 new/overwrite/error；allowed_grade_ids=None 表示管理员（不限制）。

    学号不在系统时不再整份跳过：按成绩单班级/学院/专业标记「确认后自动建档」；
    但班级缺失或推断年级已存在且越权时仍拦截。"""
    years = {y.name: y.id for y in db.query(AcademicYear).all()}
    students = {s.student_no: s for s in db.query(Student).all()}
    grade_ids = {g.id for g in db.query(Grade).all()}
    for tf in files:
        student = students.get(tf.student_no) if tf.student_no else None
        if student is None:
            if not tf.class_name:
                tf.error = tf.error or "成绩单缺少班级信息，无法自动创建学生"
            elif tf.inferred_grade_name() is None:
                tf.error = tf.error or "无法从班级名/入学时间推断年级，无法自动创建学生"
            elif allowed_grade_ids is not None:
                grade = db.query(Grade).filter_by(name=tf.inferred_grade_name()).first()
                if grade is not None and grade.id not in allowed_grade_ids:
                    tf.error = (f"成绩单班级 {tf.class_name} 属于 {grade.name}，"
                                f"不在所辖年级，无权导入")
            if tf.error:
                for r in tf.rows:
                    r.status, r.exception = "error", r.exception or "学生不存在"
                continue
            tf.create_student = True   # 行保持 new，照常参与勾选与补录
            continue
        grade_id = student.klass.grade_id if student.klass else None
        if allowed_grade_ids is not None and grade_id not in allowed_grade_ids:
            tf.error = f"学生 {tf.student_label} 不在所辖年级，无权导入"
            for r in tf.rows:
                r.status, r.exception = "error", "无权导入"
            continue
        if tf.class_name and student.klass and student.klass.name != tf.class_name:
            tf.exceptions.append({"type": "班级不一致",
                                  "detail": f"系统「{student.klass.name}」/ 成绩单「{tf.class_name}」，按系统班级入库"})
        if tf.name and student.name != tf.name:
            tf.exceptions.append({"type": "姓名不一致",
                                  "detail": f"系统「{student.name}」/ 成绩单「{tf.name}」，按系统姓名入库"})
        needed = sorted({(years.get(r.year), r.semester) for r in tf.rows if years.get(r.year)})
        existing: dict[tuple[str, str], list] = {}
        for year_id, sem in needed:
            for rec in db.query(ScoreRecord).filter_by(
                    student_id=student.id, academic_year_id=year_id, semester=sem).all():
                keys = {(normalize_course_name(rec.course_name), sem)} if rec.course_name else set()
                if rec.course_code:
                    keys.add((rec.course_code, sem))
                for k in keys:
                    existing.setdefault(k, []).append(rec)
        for r in tf.rows:
            cands: list[ScoreRecord] = []
            for key in ((normalize_course_name(r.course_name), r.semester), (r.course_name, r.semester)):
                for rec in existing.get(key, []):
                    if rec not in cands:
                        cands.append(rec)
            if not cands:
                r.status = "new"
                continue
            # 主匹配：带真实教务课程代码的记录优先（长表记录权威），其次库内 id 小者
            primary = min(cands, key=lambda c: (c.course_code == c.course_name, c.id))
            r.status, r.existing_id, r.existing_score_raw = "overwrite", primary.id, primary.score_raw
            if len(cands) > 1:
                r.exception = (f"{r.exception}；" if r.exception else "") + \
                    "系统中该课程已有多条记录，覆盖后仍可能有重复计分，建议核对"


def _create_student_chain(db: Session, tf: TranscriptFile, user,
                          grades: dict, classes: dict, colleges: dict,
                          stats: dict, batch: ImportBatch) -> Student:
    """学号不在系统：按成绩单信息自动创建 年级→学院→班级→学生。
    辅导员新建的年级自动与其绑定（§4.1.3，与长表导入口径一致）。"""
    gname = tf.inferred_grade_name()
    grade = grades.get(gname)
    if grade is None:
        grade = Grade(name=gname, enrollment_year=infer_enrollment_year(gname))
        if user is not None and user.role == "counselor":
            user.grades.append(grade)
        db.add(grade)
        db.flush()
        grades[gname] = grade
        stats["grades_created"] = stats.get("grades_created", 0) + 1
    klass = classes.get(tf.class_name)
    if klass is None:
        college = colleges.get(tf.college) if tf.college else None
        if college is None and tf.college:
            college = College(name=tf.college)
            db.add(college)
            db.flush()
            colleges[tf.college] = college
            stats["colleges_created"] = stats.get("colleges_created", 0) + 1
        klass = ClassInfo(name=tf.class_name, grade_id=grade.id,
                          college_id=college.id if college else None,
                          major=tf.major or None)
        db.add(klass)
        db.flush()
        classes[tf.class_name] = klass
        stats["classes_created"] = stats.get("classes_created", 0) + 1
    student = Student(student_no=tf.student_no, name=tf.name or tf.student_no,
                      class_id=klass.id)
    db.add(student)
    db.flush()
    stats["students_created"] = stats.get("students_created", 0) + 1
    return student


def confirm_transcript_import(db: Session, files: list[TranscriptFile],
                              include: dict[int, list[int]] | None,
                              user, filename_label: str) -> ImportBatch:
    """include: {文件下标: [行序号]}，None = 全部。仅导入 status != error 且被选中的行。"""
    batch = ImportBatch(kind="score", filename=filename_label,
                        operator_id=user.id if user is not None else None)
    db.add(batch)
    db.flush()

    years = {y.name: y.id for y in db.query(AcademicYear).all()}
    students = {s.student_no: s for s in db.query(Student).all()}
    grades = {g.name: g for g in db.query(Grade).all()}
    classes = {c.name: c for c in db.query(ClassInfo).all()}
    colleges = {c.name: c for c in db.query(College).all()}
    stats: dict[str, int] = {}
    for idx, tf in enumerate(files):
        if tf.error:
            continue
        student = students.get(tf.student_no)
        if student is None and tf.create_student:
            student = _create_student_chain(db, tf, user, grades, classes, colleges, stats, batch)
            students[tf.student_no] = student
        if student is None:
            stats["skipped"] = stats.get("skipped", 0) + len(tf.rows)
            continue
        allowed = set(include.get(idx, [r.seq for r in tf.rows])) if include is not None \
            else {r.seq for r in tf.rows}
        for r in tf.rows:
            if r.seq not in allowed or r.status == "error" or not r.course_name:
                stats["skipped"] = stats.get("skipped", 0) + 1
                continue
            year_id = years.get(r.year)
            if year_id is None:
                year = AcademicYear(name=r.year)
                db.add(year)
                db.flush()
                years[r.year] = year_id = year.id
                stats["years_created"] = stats.get("years_created", 0) + 1
            rec = db.get(ScoreRecord, r.existing_id) if r.existing_id else None
            if rec is not None:
                batch.snapshot.append({"model": "ScoreRecord", "id": rec.id, "old": {
                    k: getattr(rec, k) for k in
                    ["course_name", "teacher", "credit", "score_raw", "score_num", "gpa",
                     "is_elective", "course_category", "retake_type", "batch_id"]}})
                rec.course_name = r.course_name
                rec.credit = r.credit if r.credit is not None else rec.credit
                rec.score_raw, rec.score_num = r.score_raw, r.score_num
                rec.is_elective = r.is_elective or rec.is_elective
                rec.course_category = r.course_category or rec.course_category
                rec.retake_type = r.retake_type or rec.retake_type
                rec.batch_id = batch.id
                stats["records_overwritten"] = stats.get("records_overwritten", 0) + 1
            else:
                db.add(ScoreRecord(
                    student_id=student.id, academic_year_id=year_id, semester=r.semester,
                    course_code=r.course_name[:64], course_name=r.course_name,
                    credit=r.credit, score_raw=r.score_raw, score_num=r.score_num,
                    is_elective=r.is_elective, course_category=r.course_category,
                    retake_type=r.retake_type, batch_id=batch.id))
                stats["records_created"] = stats.get("records_created", 0) + 1

    batch.stats = stats
    db.add(OperationLog(operator_id=user.id if user is not None else None,
                        operator_name=getattr(user, "username", ""),
                        action="成绩单补录",
                        detail=f"{filename_label}：新建{stats.get('records_created', 0)} "
                               f"覆盖{stats.get('records_overwritten', 0)} "
                               f"学生新建{stats.get('students_created', 0)} "
                               f"班级新建{stats.get('classes_created', 0)}"))
    db.commit()
    db.refresh(batch)
    return batch
