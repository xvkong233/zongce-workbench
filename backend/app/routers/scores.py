"""成绩长表导入：预览（解析+异常清单）/ 确认入库 / 学生成绩明细查询 / 异常导出 CSV / 样例表格下载。支持教务新旧两种导出格式（自动识别）。"""
import csv
import io

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import counselor_grade_ids, get_current_user
from ..database import get_db
from ..models import (AcademicYear, ClassInfo, Grade, GradeConversion, Student,
                      User)
from ..services.score_import import (confirm_score_import, find_conflicts_with_db,
                                     infer_enrollment_year, infer_grade_name,
                                     parse_score_workbook)
from ..services.transcript_import import (TranscriptFile, confirm_transcript_import,
                                          match_transcripts, parse_transcript_pdf)
from .base_data import _class_item

router = APIRouter(prefix="/scores", tags=["scores"])


def _conversion_map(db: Session) -> dict[str, float]:
    return {c.level_text: c.score for c in db.query(GradeConversion).all()}


def _check_grade_access(user: User, class_names: list[str], db: Session):
    allowed = counselor_grade_ids(user)
    if allowed is None:
        return
    for name in class_names:
        klass = db.query(ClassInfo).filter_by(name=name).first()
        if klass and klass.grade_id not in allowed:
            raise HTTPException(403, {"message": f"文件包含所辖年级之外的班级「{name}」，无权导入"})


@router.post("/import/preview")
def import_preview(file: UploadFile = File(...), db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    try:
        parsed = parse_score_workbook(file.filename, file.file.read(), _conversion_map(db))
    except ValueError as e:
        raise HTTPException(400, {"message": str(e)})

    _check_grade_access(user, parsed.class_names, db)

    existing_years = {y.name for y in db.query(AcademicYear).all()}
    existing_grades = {g.name for g in db.query(Grade).all()}
    existing_classes = {c.name for c in db.query(ClassInfo).all()}

    create_years = [{"name": y} for y in parsed.year_names if y not in existing_years]
    class_grade: dict[str, str] = {}
    create_grades, create_classes = [], []
    for cn in parsed.class_names:
        gname = infer_grade_name(cn)
        class_grade[cn] = gname or ""
        if gname and gname not in existing_grades and gname not in {g["name"] for g in create_grades}:
            create_grades.append({"name": gname, "enrollment_year": infer_enrollment_year(gname)})
        if cn not in existing_classes:
            create_classes.append({"name": cn, "grade_name": gname or "", "college_name": None})

    conflicts = find_conflicts_with_db(db, parsed)
    return {
        "filename": file.filename,
        "years": parsed.year_names,
        "class_grade": class_grade,
        "student_count": parsed.student_count,
        "course_count": parsed.course_count,
        "record_count": len(parsed.rows),
        "create_years": create_years,
        "create_grades": create_grades,
        "create_classes": create_classes,
        "exceptions": parsed.exceptions[:500],
        "exception_count": len(parsed.exceptions),
        "conflicts": conflicts,
    }


@router.post("/import/confirm")
def import_confirm(file: UploadFile = File(...), plan: str = Form(default="{}"),
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    import json
    try:
        plan_obj = json.loads(plan)
    except json.JSONDecodeError:
        raise HTTPException(400, {"message": "plan 参数不是合法 JSON"})
    try:
        parsed = parse_score_workbook(file.filename, file.file.read(), _conversion_map(db))
    except ValueError as e:
        raise HTTPException(400, {"message": str(e)})
    _check_grade_access(user, parsed.class_names, db)
    batch = confirm_score_import(db, parsed, plan_obj, user, file.filename)
    return {"batch_id": batch.id, "stats": batch.stats}


@router.get("/records")
def student_records(student_id: int, academic_year_id: int | None = None,
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from ..models import ScoreRecord
    s = db.get(Student, student_id)
    if not s:
        raise HTTPException(404, {"message": "学生不存在"})
    allowed = counselor_grade_ids(user)
    if allowed is not None and (not s.klass or s.klass.grade_id not in allowed):
        raise HTTPException(403, {"message": "无权查看该学生"})
    q = db.query(ScoreRecord).filter_by(student_id=student_id)
    if academic_year_id:
        q = q.filter_by(academic_year_id=academic_year_id)
    years = {y.id: y.name for y in db.query(AcademicYear).all()}
    return [{"id": r.id, "year": years.get(r.academic_year_id, ""), "semester": r.semester,
             "course_code": r.course_code, "course_name": r.course_name, "teacher": r.teacher,
             "credit": r.credit, "score_raw": r.score_raw, "score_num": r.score_num,
             "gpa": r.gpa} for r in q.order_by(ScoreRecord.course_code).all()]


@router.post("/exceptions/export")
async def exceptions_export(exceptions: list[dict],
                            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["sheet", "行号", "异常类型", "详情"])
    for e in exceptions:
        writer.writerow([e.get("sheet", ""), e.get("row", ""), e.get("type", ""), e.get("detail", "")])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue().encode("utf-8-sig")]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=exceptions.csv"})


# ---------- 成绩单 PDF 补录 ----------
def _parse_transcripts(db: Session, files) -> list[TranscriptFile]:
    conversion = _conversion_map(db)
    parsed: list[TranscriptFile] = []
    for f in files:
        name = f.filename or ""
        data = f.file.read()
        lower = name.lower()
        if lower.endswith(".zip"):
            parsed.extend(_expand_zip(name, data, conversion))
        elif lower.endswith(".rar"):
            parsed.extend(_expand_rar(name, data, conversion))
        elif lower.endswith(".7z"):
            parsed.extend(_expand_7z(name, data, conversion))
        elif lower.endswith((".tar", ".gz")):
            parsed.append(TranscriptFile(
                filename=name, error="暂不支持该压缩格式，请改用 zip/rar/7z 压缩包"))
        else:
            parsed.append(parse_transcript_pdf(name, data, conversion))
    return parsed


def _archive_base(entry: str) -> str:
    """包内路径 → 文件名（兼容 / 与 \\ 分隔）。"""
    return entry.replace("\\", "/").rsplit("/", 1)[-1]


def _want_entry(entry: str) -> bool:
    """只展开普通 PDF：跳过目录、隐藏文件（. / ._ 开头）与 __MACOSX。"""
    base = _archive_base(entry)
    if base.startswith((".", "._")) or "__MACOSX" in entry:
        return False
    return base.lower().endswith(".pdf")


def _parse_archive_entries(archive_name: str, entries: list[tuple[str, bytes | None]],
                           conversion: dict[str, float]) -> list[TranscriptFile]:
    """entries: [(包内路径, PDF 字节)]，字节为 None 表示该条目解压失败（单独报错）。
    包内无 PDF 时返回单张错误卡片。"""
    out: list[TranscriptFile] = []
    for entry, blob in entries:
        if not _want_entry(entry):
            continue
        base = _archive_base(entry)
        if blob is None:
            out.append(TranscriptFile(filename=base, error="压缩包内该文件解压失败"))
            continue
        out.append(parse_transcript_pdf(base, blob, conversion))
    return out or [TranscriptFile(filename=archive_name, error="压缩包中未找到 PDF 成绩单")]


def _zip_entry_name(info) -> str:
    """压缩包内文件名解码：未打 UTF-8 标志位的条目按 Windows 常见 GBK 修复，
    避免中文文件名显示为 cp437 乱码。"""
    if info.flag_bits & 0x800:
        return info.filename
    try:
        raw = info.filename.encode("cp437")
    except UnicodeEncodeError:
        return info.filename
    for enc in ("utf-8", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return info.filename


def _expand_zip(zip_name: str, data: bytes,
                conversion: dict[str, float]) -> list[TranscriptFile]:
    import zipfile
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except Exception:
        return [TranscriptFile(filename=zip_name, error="无法打开压缩包，请确认上传的是 zip 文件")]
    entries: list[tuple[str, bytes | None]] = []
    with zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            entry = _zip_entry_name(info)
            if not _want_entry(entry):
                continue
            try:
                entries.append((entry, zf.read(info)))
            except Exception:
                entries.append((entry, None))
    return _parse_archive_entries(zip_name, entries, conversion)


def _expand_rar(zip_name: str, data: bytes,
                conversion: dict[str, float]) -> list[TranscriptFile]:
    """rar：元数据由 rarfile 纯 Python 解析，提取依赖外部 unrar/unar 工具
    （Docker 镜像已内置 unar；缺失时整包报错提示，不影响其他文件）。"""
    try:
        import rarfile
        from rarfile import PasswordRequired, RarCannotExec
    except ImportError:
        return [TranscriptFile(filename=zip_name, error="服务器未安装 rar 解压组件（rarfile）")]
    try:
        rf = rarfile.RarFile(io.BytesIO(data))
        infos = [i for i in rf.infolist() if not i.is_dir()]
    except PasswordRequired:
        return [TranscriptFile(filename=zip_name, error="rar 压缩包已加密，请解密后重新打包上传")]
    except RarCannotExec:
        return [TranscriptFile(
            filename=zip_name,
            error="服务器缺少 unrar/unar 工具，无法解压 rar，请联系管理员安装（Docker 镜像已内置）")]
    except Exception:
        return [TranscriptFile(filename=zip_name, error="无法打开 rar 压缩包，请确认文件完整")]
    entries: list[tuple[str, bytes | None]] = []
    for info in infos:
        if not _want_entry(info.filename):
            continue
        try:
            entries.append((info.filename, rf.read(info)))
        except Exception:
            entries.append((info.filename, None))
    return _parse_archive_entries(zip_name, entries, conversion)


def _expand_7z(zip_name: str, data: bytes,
               conversion: dict[str, float]) -> list[TranscriptFile]:
    import os
    import tempfile
    try:
        import py7zr
        from py7zr.exceptions import PasswordRequired
    except ImportError:
        return [TranscriptFile(filename=zip_name, error="服务器未安装 7z 解压组件（py7zr）")]
    entries: list[tuple[str, bytes | None]] = []
    try:
        with tempfile.TemporaryDirectory() as tmp, \
                py7zr.SevenZipFile(io.BytesIO(data)) as zf:
            names = [n for n in zf.getnames() if _want_entry(n)]
            if names:
                zf.extract(path=tmp, targets=names)
                for name in names:
                    fp = os.path.join(tmp, *name.replace("\\", "/").split("/"))
                    try:
                        with open(fp, "rb") as fh:
                            entries.append((name, fh.read()))
                    except OSError:
                        entries.append((name, None))
    except PasswordRequired:
        return [TranscriptFile(filename=zip_name, error="7z 压缩包已加密，请解密后重新打包上传")]
    except Exception:
        return [TranscriptFile(filename=zip_name, error="无法打开 7z 压缩包，请确认文件完整")]
    return _parse_archive_entries(zip_name, entries, conversion)


def _file_payload(idx: int, tf: TranscriptFile) -> dict:
    return {
        "file_index": idx, "filename": tf.filename,
        "student_no": tf.student_no, "name": tf.name, "class_name": tf.class_name,
        "college": tf.college, "major": tf.major, "gpa_total": tf.gpa_total,
        "error": tf.error, "create_student": tf.create_student,
        "rows": [{
            "seq": r.seq, "course_name": r.course_name, "year": r.year,
            "semester": r.semester, "credit": r.credit, "score_raw": r.score_raw,
            "score_num": r.score_num, "course_category": r.course_category,
            "retake_type": r.retake_type, "status": r.status,
            "existing_score_raw": r.existing_score_raw, "exception": r.exception,
        } for r in tf.rows],
        "exceptions": tf.exceptions,
    }


@router.post("/transcript/preview")
def transcript_preview(files: list[UploadFile] = File(...), db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    if not files:
        raise HTTPException(400, {"message": "请至少上传一份成绩单 PDF"})
    parsed = _parse_transcripts(db, files)
    match_transcripts(db, parsed, counselor_grade_ids(user))
    payloads = [_file_payload(i, tf) for i, tf in enumerate(parsed)]
    rows = [r for p in payloads for r in p["rows"] if not p["error"]]
    return {
        "files": payloads,
        "student_count": sum(1 for tf in parsed if tf.rows and not tf.error),
        "row_count": len(rows),
        "new_count": sum(1 for r in rows if r["status"] == "new"),
        "overwrite_count": sum(1 for r in rows if r["status"] == "overwrite"),
        "create_student_count": sum(1 for p in payloads if p["create_student"]),
        "exception_count": (sum(1 for r in rows if r["exception"])
                            + sum(len(p["exceptions"]) for p in payloads)
                            + sum(1 for p in payloads if p["error"])),
    }


@router.post("/transcript/confirm")
def transcript_confirm(files: list[UploadFile] = File(...), plan: str = Form(default="{}"),
                       db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    import json
    try:
        plan_obj = json.loads(plan)
    except json.JSONDecodeError:
        raise HTTPException(400, {"message": "plan 参数不是合法 JSON"})
    if not files:
        raise HTTPException(400, {"message": "请至少上传一份成绩单 PDF"})
    parsed = _parse_transcripts(db, files)
    allowed = counselor_grade_ids(user)
    match_transcripts(db, parsed, allowed)
    include = {int(k): v for k, v in (plan_obj.get("include") or {}).items()}
    # 自动建档文件可指定已有班级（前端从 /base/classes 选择）；此处校验存在性与年级权限
    class_overrides: dict[int, int] = {}
    for k, v in (plan_obj.get("class_overrides") or {}).items():
        idx = int(k)
        if not (0 <= idx < len(parsed)) or not parsed[idx].create_student:
            continue  # 该文件已存在学生或无需建档，指定无效
        klass = db.get(ClassInfo, int(v))
        if klass is None:
            raise HTTPException(400, {"message": "所选班级不存在，请刷新班级列表后重试"})
        if allowed is not None and klass.grade_id not in allowed:
            raise HTTPException(403, {"message": f"班级「{klass.name}」不在所辖年级，无权导入到该班级"})
        class_overrides[idx] = klass.id
    names = [f.filename for f in files]
    label = names[0] if len(names) == 1 else f"{names[0]} 等 {len(names)} 份成绩单"
    batch = confirm_transcript_import(db, parsed, include or None, user, label,
                                      class_overrides or None)
    return {"batch_id": batch.id, "stats": batch.stats}


@router.get("/template")
def score_template(_: User = Depends(get_current_user)):
    """下载成绩长表样例（与教务最新导出格式一致）。"""
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "学生成绩"
    headers = ["学号", "姓名", "学生标签", "课程名", "课程号", "学分", "总成绩",
               "平时成绩", "期中成绩", "期末成绩", "其他成绩1", "加分", "绩点",
               "等级成绩", "成绩获得学年学期", "是否参与绩点计算", "显示总成绩", "重修重考"]
    ws.append(headers)
    ws.append(["20246601", "张三", "建筑类2401", "高等数学①㈠", "A1501000015", "5.0",
               89, "88.0", "", "90", "", "", 3.9, "", "2025-2026学年秋", "是", 89, "初修"])
    ws.append(["20246601", "张三", "建筑类2401", "在线公共选修课示例", "A3201001010", "1.0",
               "合格", "", "", "", "", "", 4.0, "合格", "2025-2026学年秋", "否", "合格", "初修"])
    from openpyxl.styles import Alignment, Font, PatternFill
    for c in range(1, len(headers) + 1):
        cell = ws.cell(1, c)
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="F2F2F2")
        cell.alignment = Alignment(horizontal="center")
        ws.column_dimensions[cell.column_letter].width = 14
    buf = io.BytesIO()
    wb.save(buf)
    from urllib.parse import quote
    from fastapi.responses import Response
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote('成绩长表样例.xlsx')}"},
    )
