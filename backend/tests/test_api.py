"""接口级回归测试：鉴权越权、路径穿越、重复填充、空综测项、管理员账户保护。

运行：cd backend && python -m pytest tests/ -q
（test_api.py 按字母序先于 test_rules.py 收集，模块导入前已切换到临时数据目录）
"""
import io
import os
import sys
import tempfile

# 必须在导入 app 之前设置：app.database 在导入时即固化 DB 路径
os.environ["ZONGCE_DATA_DIR"] = tempfile.mkdtemp(prefix="zongce-test-")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import DIST, app  # noqa: E402

client = TestClient(app)


def _login(username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def admin_h():
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
    client.put("/api/auth/password", json={"old_password": "admin123", "new_password": "admin-12345"},
               headers={"Authorization": f"Bearer {tok}"})
    return _login("admin", "admin-12345")


@pytest.fixture(scope="module")
def env(admin_h):
    """两个年级、两个班级、每班一名学生；辅导员只绑定 24级。"""
    import openpyxl

    year_id = client.post("/api/base/academic-years", headers=admin_h,
                          json={"name": "2024-2025"}).json()["id"]
    g24 = client.post("/api/base/grades", headers=admin_h, json={"name": "24级"}).json()
    g25 = client.post("/api/base/grades", headers=admin_h, json={"name": "25级"}).json()
    c24 = client.post("/api/base/classes", headers=admin_h,
                      json={"name": "建筑类2401", "grade_id": g24["id"]}).json()
    c25 = client.post("/api/base/classes", headers=admin_h,
                      json={"name": "计科2501", "grade_id": g25["id"]}).json()

    def _make_student(no, name, class_name):
        wb = openpyxl.Workbook(); ws = wb.active
        ws.append(["学号", "姓名", "班级"]); ws.append([no, name, class_name])
        buf = io.BytesIO(); wb.save(buf)
        r = client.post("/api/base/students/import", headers=admin_h,
                        files={"file": ("s.xlsx", buf.getvalue())})
        assert r.status_code == 200, r.text

    _make_student("20240001", "甲", "建筑类2401")
    _make_student("20250001", "乙", "计科2501")

    client.post("/api/users", headers=admin_h, json={
        "username": "cc", "password": "cc-123456", "real_name": "导员",
        "enabled": True, "grade_ids": [g24["id"]]})
    tok = client.post("/api/auth/login", json={"username": "cc", "password": "cc-123456"}).json()["token"]
    client.put("/api/auth/password", json={"old_password": "cc-123456", "new_password": "cc-654321"},
               headers={"Authorization": f"Bearer {tok}"})
    cc_h = _login("cc", "cc-654321")
    return {"year_id": year_id, "c24": c24, "c25": c25, "cc_h": cc_h, "admin_h": admin_h}


def _students(h, **params):
    return client.get("/api/base/students", headers=h, params=params).json()


def _student_id(h, no):
    return next(s["id"] for s in _students(h, page_size=100)["items"] if s["student_no"] == no)


# ---------- 鉴权 / 越权 ----------
def test_bearer_garbage_token_401_not_500():
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


def test_counseler_cannot_list_foreign_class(env):
    """辅导员用 class_id 查询所辖年级之外的班级 → 403，而非泄露数据。"""
    r = client.get("/api/base/students", headers=env["cc_h"], params={"class_id": env["c25"]["id"]})
    assert r.status_code == 403, r.text
    # 所辖班级正常
    r = client.get("/api/base/students", headers=env["cc_h"], params={"class_id": env["c24"]["id"]})
    assert r.status_code == 200 and r.json()["total"] == 1


def test_counseler_cannot_move_student_to_foreign_class(env):
    sid = _student_id(env["admin_h"], "20240001")
    r = client.put(f"/api/base/students/{sid}", headers=env["cc_h"],
                   json={"student_no": "20240001", "name": "甲", "class_id": env["c25"]["id"]})
    assert r.status_code == 403, r.text
    # 所辖班级内移动允许
    r = client.put(f"/api/base/students/{sid}", headers=env["cc_h"],
                   json={"student_no": "20240001", "name": "甲", "class_id": env["c24"]["id"]})
    assert r.status_code == 200


def test_update_student_validates_target_class(env):
    sid = _student_id(env["admin_h"], "20240001")
    r = client.put(f"/api/base/students/{sid}", headers=env["admin_h"],
                   json={"student_no": "20240001", "name": "甲", "class_id": 99999})
    assert r.status_code == 404
    r = client.put(f"/api/base/students/{sid}", headers=env["admin_h"],
                   json={"student_no": "  ", "name": "甲", "class_id": env["c24"]["id"]})
    assert r.status_code == 400


def test_admin_account_protected_from_users_api(env):
    users = client.get("/api/users", headers=env["admin_h"]).json()
    admin_id = next(u["id"] for u in users if u["username"] == "admin")
    r = client.put(f"/api/users/{admin_id}", headers=env["admin_h"], json={
        "username": "admin", "password": "", "real_name": "x", "enabled": False, "grade_ids": []})
    assert r.status_code == 400
    r = client.delete(f"/api/users/{admin_id}", headers=env["admin_h"])
    assert r.status_code == 400
    # 管理员仍可登录使用
    assert client.get("/api/auth/me", headers=env["admin_h"]).status_code == 200


def test_logs_bad_date_400(env):
    r = client.get("/api/logs", headers=env["admin_h"], params={"start": "not-a-date"})
    assert r.status_code == 400


# ---------- 业务正确性 ----------
def test_fill_base_idempotent(env):
    """重复填充（含 only_missing=False）不崩溃、不产生重复记录。"""
    body = {"academic_year_id": env["year_id"], "class_id": env["c24"]["id"]}
    r1 = client.post("/api/evals/fill-base", headers=env["admin_h"],
                     json={**body, "only_missing": True})
    assert r1.status_code == 200 and r1.json()["filled_records"] > 0
    r2 = client.post("/api/evals/fill-base", headers=env["admin_h"],
                     json={**body, "only_missing": False})
    assert r2.status_code == 200, r2.text
    assert r2.json()["filled_records"] == 0  # 已存在的逐项跳过


def test_save_empty_eval_items_creates_no_records(env):
    """整项为空的综测保存不落库：学生不应被误判为「已录入综测」。"""
    sid = _student_id(env["admin_h"], "20250001")
    items = [{"item_name": n, "detail_text": "", "score": 0} for n in
             ("思想品德", "社会工作", "科研及科技创新", "文体活动", "集体建设")]
    r = client.put("/api/evals/save", headers=env["admin_h"],
                   json={"student_id": sid, "academic_year_id": env["year_id"], "items": items})
    assert r.status_code == 200
    roster = client.get("/api/evals/roster", headers=env["admin_h"], params={
        "academic_year_id": env["year_id"], "class_id": env["c25"]["id"]}).json()
    row = next(x for x in roster["rows"] if x["student_id"] == sid)
    assert row["entered"] is False
    # 非空项正常落库
    r = client.put("/api/evals/save", headers=env["admin_h"], json={
        "student_id": sid, "academic_year_id": env["year_id"],
        "items": [{"item_name": "思想品德", "detail_text": "基础分+23", "score": 23},
                  *[{**it, "item_name": n} for it, n in
                    zip(items[1:], ("社会工作", "科研及科技创新", "文体活动", "集体建设"))]]})
    assert r.status_code == 200
    roster = client.get("/api/evals/roster", headers=env["admin_h"], params={
        "academic_year_id": env["year_id"], "class_id": env["c25"]["id"]}).json()
    row = next(x for x in roster["rows"] if x["student_id"] == sid)
    assert row["entered"] is True


def test_save_capped_detail_not_reported(env):
    """求和超过分项满分、得分恰填满分 → 视为封顶填写，不计明细不符。"""
    sid = _student_id(env["admin_h"], "20250001")

    def items(score):
        base = [{"item_name": n, "detail_text": "", "score": 0} for n in
                ("社会工作", "科研及科技创新", "文体活动", "集体建设")]
        return [{"item_name": "思想品德", "detail_text": "基础分+23\n积极分子+3", "score": score}, *base]

    r = client.put("/api/evals/save", headers=env["admin_h"], json={
        "student_id": sid, "academic_year_id": env["year_id"], "items": items(25)})
    assert r.status_code == 200 and r.json()["mismatches"] == [], r.text
    # 得分低于满分（求和 26 > 20）→ 仍是不符
    r = client.put("/api/evals/save", headers=env["admin_h"], json={
        "student_id": sid, "academic_year_id": env["year_id"], "items": items(20)})
    assert r.status_code == 200 and r.json()["mismatches"] == ["思想品德"]


def test_overview_reports_eval_mismatches(env):
    """总览按年级统计数据有误人数，/overview/eval-mismatches 返回项目级明细。"""
    sid = _student_id(env["admin_h"], "20250001")
    base = [{"item_name": n, "detail_text": "", "score": 0} for n in
            ("社会工作", "科研及科技创新", "文体活动", "集体建设")]
    items = [{"item_name": "思想品德", "detail_text": "基础分+23\n积极分子+3", "score": 20}, *base]
    r = client.put("/api/evals/save", headers=env["admin_h"],
                   json={"student_id": sid, "academic_year_id": env["year_id"], "items": items})
    assert r.status_code == 200 and r.json()["mismatches"] == ["思想品德"]

    o = client.get("/api/overview", headers=env["admin_h"],
                   params={"academic_year_id": env["year_id"]}).json()
    assert o["totals"]["eval_mismatch_students"] >= 1
    row25 = next(g for g in o["grade_rows"] if g["grade_name"] == "25级")
    assert row25["eval_mismatch_students"] == 1
    sample = row25["mismatch_sample"][0]
    assert sample["student_no"] == "20250001"
    assert sample["items"][0]["item_name"] == "思想品德"
    assert sample["items"][0]["diff"] == 6  # 明细和 26 − 得分 20

    r = client.get("/api/overview/eval-mismatches", headers=env["admin_h"],
                   params={"academic_year_id": env["year_id"]}).json()
    assert r["count"] >= 1
    target = next(s for s in r["students"] if s["student_no"] == "20250001")
    assert target["grade_name"] == "25级" and target["class_name"] == "计科2501"
    assert target["items"][0]["soft_sum"] == 26 and target["items"][0]["score"] == 20


def test_delete_counselor_with_logs_and_batches(env):
    """删除产生过操作日志/导入批次的辅导员：应成功，日志保留（operator 置空）。"""
    client.post("/api/users", headers=env["admin_h"], json={
        "username": "dd", "password": "dd-123456", "real_name": "待删",
        "enabled": True, "grade_ids": []})
    tok = client.post("/api/auth/login", json={"username": "dd", "password": "dd-123456"}).json()["token"]
    client.put("/api/auth/password", json={"old_password": "dd-123456", "new_password": "dd-654321"},
               headers={"Authorization": f"Bearer {tok}"})
    hd = _login("dd", "dd-654321")
    # dd 产生操作日志（新建年级）
    client.post("/api/base/grades", headers=hd, json={"name": "27级"})
    uid = next(u["id"] for u in client.get("/api/users", headers=env["admin_h"]).json()
               if u["username"] == "dd")
    r = client.delete(f"/api/users/{uid}", headers=env["admin_h"])
    assert r.status_code == 200, r.text
    assert all(u["username"] != "dd" for u in client.get("/api/users", headers=env["admin_h"]).json())
    # 日志保留：操作人名仍可查（operator_id 已置空）
    logs = client.get("/api/logs", headers=env["admin_h"], params={"operator": "dd"}).json()
    assert logs["total"] >= 1
    # 再次删除 → 404
    assert client.delete(f"/api/users/{uid}", headers=env["admin_h"]).status_code == 404


# ---------- 静态托管 ----------
@pytest.mark.skipif(not DIST.exists(), reason="前端构建产物 dist 不存在（CI 未构建前端）")
def test_spa_route_blocks_path_traversal():
    """/%2e%2e/ 解码后为 /../，不得越出 dist 读取任意文件。"""
    r = client.get("/%2e%2e/%2e%2e/README.md")
    assert r.status_code == 200
    assert "<html" in r.text[:200].lower()  # 应回退到 SPA index.html，而非文件内容
    assert "Ant Design Pro" not in r.text
    r = client.get("/%2e%2e/%2e%2e/%2e%2e/backend/app/auth.py")
    assert "PBKDF2" not in r.text


def test_update_counselor_without_username_field(env):
    """编辑账号：前端编辑表单不含 username 字段，PUT 不应因 UserIn.username 必填而 422。"""
    users = client.get("/api/users", headers=env["admin_h"]).json()
    cc = next(u for u in users if u["username"] == "cc")
    payload = {"real_name": "导员改", "enabled": True, "grade_ids": [], "password": ""}
    r = client.put(f"/api/users/{cc['id']}", headers=env["admin_h"], json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["real_name"] == "导员改"
    # 重置密码：旧凭证失效、新密码首登强制改密
    r = client.put(f"/api/users/{cc['id']}", headers=env["admin_h"],
                   json={**payload, "password": "new-pass-9"})
    assert r.status_code == 200
    assert client.post("/api/auth/login",
                       json={"username": "cc", "password": "cc-654321"}).status_code == 401
    r = client.post("/api/auth/login", json={"username": "cc", "password": "new-pass-9"})
    assert r.status_code == 200 and r.json()["must_change_password"] is True
