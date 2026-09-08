"""成绩单 PDF 补录回归：合成 PDF 解析（等级换算/△重修/未知等级/GPA 页脚）、
预览匹配（新增 vs 覆盖）、部分导入、批次回滚、长表成绩按课程名互认、辅导员年级越权。

运行：cd backend && python -m pytest tests/ -q
"""
import io
import os
import sys
import tempfile

# 与 test_api.py 相同的约定：导入 app 前切到临时数据目录（全模块共享同一 app 实例）
os.environ.setdefault("ZONGCE_DATA_DIR", tempfile.mkdtemp(prefix="zongce-test-"))

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pymupdf  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services.convert import convert_level  # noqa: E402
from app.services.transcript_import import parse_transcript_pdf  # noqa: E402

client = TestClient(app)

CONV = {"优": 95, "优秀": 95, "良": 85, "良好": 85, "中": 75, "中等": 75,
        "及格": 65, "不及格": 0, "合格": 80, "不合格": 0}

# 成绩单版式坐标（与真实东北大学成绩单一致的列位）
COLS = {"序号": 38, "课程名称": 64, "学年学期": 375, "学分": 450, "成绩": 488, "课程类别": 526}


def _put(page, x, y, text, size=10):
    # china-s 的 ASCII 数字是全角宽，会让「学年学期」压到学分列、被 pymupdf 并词；
    # 纯 ASCII 串用 helv 窄字体，几何与真实成绩单一致
    font = "helv" if all(ord(c) < 128 for c in str(text)) else "china-s"
    page.insert_text((x, y), str(text), fontname=font, fontsize=size)


def make_transcript_pdf(student_no, name, klass, rows, gpa="3.5000"):
    """rows: [(序号, 课程名, 学年学期, 学分, 成绩, 类别)]。数据行用与真实成绩单一致的
    紧凑字号，避免「学年学期」过宽与学分列重叠、被 pymupdf 并成一个词。"""
    doc = pymupdf.open()
    page = doc.new_page()
    _put(page, 40, 54, f"姓名 {name} 学院 江河建筑学院 入学时间 2024-08")
    _put(page, 40, 74, f"学号 {student_no} 班级 {klass} 学制 5")
    for label, x in [("序号", 38), ("课程名称", 197), ("学年学期", 375),
                     ("学分", 446), ("成绩", 488), ("课程类别", 526)]:
        _put(page, x, 94, label)
    y = 114
    for seq, cname, term, credit, score, cat in rows:
        _put(page, 44, y, seq, 7)
        _put(page, 64, y, cname, 7)
        _put(page, COLS["学年学期"], y, term, 7)
        _put(page, COLS["学分"], y, credit, 7)
        _put(page, COLS["成绩"], y, score, 7)
        _put(page, COLS["课程类别"], y, cat, 7)
        y += 16
    # 版式顺序与真实成绩单第 2 页一致：明细 → 毕业设计题目 → GPA → 页脚署名
    _put(page, 36, y + 20, "毕业设计（论文）题目：")
    _put(page, 36, y + 40, "总平均学分绩点")
    _put(page, 36, y + 60, gpa)
    _put(page, 366, y + 80, "东北大学教务处")
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _login(username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def admin_h():
    # test_api.py 若先运行会把 admin 密码改为 admin-12345，两种密码都试
    try:
        return _login("admin", "admin-12345")
    except AssertionError:
        return _login("admin", "admin123")


@pytest.fixture(scope="module")
def env(admin_h):
    """班级 建筑类2402（24级）+ 学生 陈良广；另有 25级/计科2501 与只绑定它的辅导员（越权用）。
    与 test_api.py 共库（全模块共享同一 app），基础数据一律先查后建保证幂等。"""
    def _ensure_grade(name):
        r = client.post("/api/base/grades", headers=admin_h, json={"name": name})
        if r.status_code == 200:
            return r.json()
        return next(g for g in client.get("/api/base/grades", headers=admin_h).json()
                    if g["name"] == name)

    def _ensure_class(name, grade_id):
        r = client.post("/api/base/classes", headers=admin_h,
                        json={"name": name, "grade_id": grade_id})
        if r.status_code == 200:
            return r.json()
        return next(c for c in client.get("/api/base/classes", headers=admin_h).json()
                    if c["name"] == name)

    g24 = _ensure_grade("24级")
    g25 = _ensure_grade("25级")
    _ensure_class("建筑类2402", g24["id"])
    _ensure_class("计科2501", g25["id"])
    import openpyxl
    wb = openpyxl.Workbook(); ws = wb.active
    ws.append(["学号", "姓名", "班级"])
    ws.append(["20246670", "陈良广", "建筑类2402"])
    ws.append(["20249999", "路人", "计科2501"])
    buf = io.BytesIO(); wb.save(buf)
    r = client.post("/api/base/students/import", headers=admin_h,
                    files={"file": ("s.xlsx", buf.getvalue())})
    assert r.status_code == 200, r.text
    client.post("/api/users", headers=admin_h, json={
        "username": "tcc", "password": "tcc-123456", "real_name": "补录导员",
        "enabled": True, "grade_ids": [g25["id"]]})  # 已存在时忽略

    def _tcc_headers():
        try:
            return _login("tcc", "tcc-654321")
        except AssertionError:
            tok = _login("tcc", "tcc-123456")["Authorization"].split()[-1]
            client.put("/api/auth/password", json={"old_password": "tcc-123456",
                                                   "new_password": "tcc-654321"},
                       headers={"Authorization": f"Bearer {tok}"})
            return _login("tcc", "tcc-654321")

    return {"admin_h": admin_h, "tcc_h": _tcc_headers()}


ROWS_3 = [
    (1, "高等数学①㈠", "2024-2025-1", 4, 86, "必修"),
    (2, "中国传统文化", "2024-2025-2", 2, "优", "选修"),
    (3, "形势与政策(1)", "2024-2025-2", 0.5, "合格", "必修"),
]


def _pdf(no="20246670", name="陈良广", klass="建筑类2402", rows=ROWS_3):
    return ("a.pdf", make_transcript_pdf(no, name, klass, rows))


def _preview(h, *files):
    r = client.post("/api/scores/transcript/preview", headers=h,
                    files=[("files", f) for f in files])
    assert r.status_code == 200, r.text
    return r.json()


def _confirm(h, plan=None, *files):
    r = client.post("/api/scores/transcript/confirm", headers=h,
                    files=[("files", f) for f in files], data={"plan": plan or "{}"})
    assert r.status_code == 200, r.text
    return r.json()


def test_parse_levels_and_retake():
    data = make_transcript_pdf("20246670", "陈良广", "建筑类2402班", [
        (1, "高等数学①㈠", "2024-2025-1", 4, 86, "必修"),
        (2, "中国传统文化", "2024-2025-2", 2, "优", "选修"),
        (3, "当代大学生国家安全教育", "2024-2025-2", 1, "合格", "必修"),
        (4, "神秘课程", "2024-2025-1", 1, "通过", "必修"),   # 换算表外的等级
        (5, "大学英语㈠", "2025-2026-1", 3.5, "88△", "必修"),  # 重修重考
    ], gpa="3.5764")
    tf = parse_transcript_pdf("a.pdf", data, CONV)
    assert tf.error == ""
    assert (tf.student_no, tf.name, tf.class_name) == ("20246670", "陈良广", "建筑类2402")
    assert tf.gpa_total == 3.5764
    assert len(tf.rows) == 5
    r1, r2, r3, r4, r5 = tf.rows
    assert (r1.score_raw, r1.score_num, r1.credit, r1.semester) == ("86", 86.0, 4.0, "秋季")
    assert (r2.score_raw, r2.score_num, r2.course_category, r2.is_elective) == ("优", 95.0, "选修", "是")
    assert (r3.score_raw, r3.score_num, r3.semester) == ("合格", 80.0, "春季")
    assert r4.score_num is None and "未知等级" in r4.exception
    assert (r5.score_raw, r5.score_num, r5.retake_type) == ("88", 88.0, "重修重考")


def test_preview_and_confirm_revert(env):
    h = env["admin_h"]
    pv = _preview(h, _pdf())
    assert pv["student_count"] == 1 and pv["row_count"] == 3
    assert pv["new_count"] == 3 and pv["overwrite_count"] == 0
    file0 = pv["files"][0]
    assert file0["error"] == "" and file0["name"] == "陈良广"
    assert [r["status"] for r in file0["rows"]] == ["new"] * 3

    # 部分导入：只导第 1 行
    part = _confirm(h, '{"include": {"0": [1]}}', _pdf())
    assert part["stats"]["records_created"] == 1
    sid = next(s["id"] for s in client.get("/api/base/students", headers=h,
                                           params={"page_size": 100}).json()["items"]
               if s["student_no"] == "20246670")
    recs = client.get(f"/api/scores/records", headers=h,
                      params={"student_id": sid}).json()
    assert len(recs) == 1 and recs[0]["course_name"] == "高等数学①㈠"
    assert recs[0]["course_code"] == "高等数学①㈠"  # 成绩单无课程代码，以课程名代替

    # 全量补录：1 覆盖 + 2 新增
    full = _confirm(h, None, _pdf())
    assert full["stats"]["records_created"] == 2
    assert full["stats"]["records_overwritten"] == 1

    # 整批回滚：删掉本批新增的 2 条、恢复被覆盖那条的旧值；部分导入批次的记录保留
    r = client.post(f"/api/batches/{full['batch_id']}/revert", headers=h)
    assert r.status_code == 200, r.text
    recs = client.get("/api/scores/records", headers=h, params={"student_id": sid}).json()
    assert [x["course_name"] for x in recs] == ["高等数学①㈠"]
    assert recs[0]["score_num"] == 86.0


def test_match_by_course_name_with_long_table(env):
    """长表已导入（带课程号/绩点）的课程，成绩单按课程名匹配 → 覆盖且保留绩点。"""
    h = env["admin_h"]
    import openpyxl
    wb = openpyxl.Workbook(); ws = wb.active
    ws.append(["学号", "姓名", "学生标签", "课程名称", "课程号", "学分", "总成绩", "绩点",
               "学年度", "学期"])
    ws.append(["20246670", "陈良广", "建筑类2402", "高等数学①㈠ ", "A1500011", "4.0", 72, 2.0,
               "2024-2025", "1"])
    ws.append(["20246670", "陈良广", "建筑类2402", "大学物理", "A1500022", "3.0", 90, 4.0,
               "2024-2025", "1"])
    buf = io.BytesIO(); wb.save(buf)
    r = client.post("/api/scores/import/confirm", headers=h,
                    files={"file": ("long.xlsx", buf.getvalue())}, data={"plan": "{}"})
    assert r.status_code == 200, r.text
    assert r.json()["stats"]["records_created"] == 2

    pv = _preview(h, _pdf())
    by_name = {row["course_name"]: row for row in pv["files"][0]["rows"]}
    assert by_name["高等数学①㈠"]["status"] == "overwrite"
    assert by_name["高等数学①㈠"]["existing_score_raw"] == "72"
    assert "多条记录" in by_name["高等数学①㈠"]["exception"]  # 成绩单残留 + 长表记录并存提醒
    assert by_name["中国传统文化"]["status"] == "new"
    # 长表里的「大学物理」不受影响，预览也不会把它算进补录行
    assert "大学物理" not in by_name

    _confirm(h, None, _pdf())
    sid = next(s["id"] for s in client.get("/api/base/students", headers=h,
                                           params={"page_size": 100}).json()["items"]
               if s["student_no"] == "20246670")
    recs = client.get("/api/scores/records", headers=h, params={"student_id": sid}).json()
    math = next(x for x in recs if x["course_name"] == "高等数学①㈠")
    assert math["score_num"] == 86.0 and math["gpa"] == 2.0  # 分数更新、绩点保留
    assert math["course_code"] == "A1500011"  # 覆盖不改课程代码


def test_unknown_student_and_scope(env):
    h = env["admin_h"]
    pv = _preview(h, ("x.pdf", make_transcript_pdf("20999999", "不在册", "建筑类2402", ROWS_3)))
    assert pv["student_count"] == 0
    assert "不存在" in pv["files"][0]["error"]
    out = _confirm(h, None, ("x.pdf", make_transcript_pdf("20999999", "不在册", "建筑类2402", ROWS_3)))
    assert out["stats"].get("records_created", 0) == 0

    # 辅导员只辖 25级：24级学生的成绩单 → 整份无权，确认不产生任何记录
    pv2 = _preview(env["tcc_h"], _pdf())
    assert "无权" in pv2["files"][0]["error"]
    out2 = _confirm(env["tcc_h"], None, _pdf())
    assert out2["stats"].get("records_created", 0) == 0


def test_dedup_within_file():
    data = make_transcript_pdf("20246670", "陈良广", "建筑类2402", [
        (1, "体育(一)", "2024-2025-1", 0.75, 78, "必修"),
        (2, "体育(一)", "2024-2025-1", 0.75, 90, "必修"),  # 同课程同名次：取靠后者
    ])
    tf = parse_transcript_pdf("a.pdf", data, CONV)
    assert len(tf.rows) == 1 and tf.rows[0].score_num == 90.0
    assert convert_level("优", CONV) == 95.0
