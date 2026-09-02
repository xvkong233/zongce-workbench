# 生成演示数据库：全部为虚构数据，仅用于 README 截图
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

os_env = {"ZONGCE_DATA_DIR": str(Path(__file__).resolve().parent)}
import os
os.environ.update(os_env)

from app.main import seed  # noqa: E402,F401  (import 即建表+种子)
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import (AcademicYear, ClassInfo, EvalRecord, Grade,  # noqa: E402
                        ScoreRecord, Student)
from app.auth import hash_password  # noqa: E402
from app.models import User  # noqa: E402

Base.metadata.create_all(engine)

random.seed(42)
db = SessionLocal()
seed(db)

year = db.query(AcademicYear).filter_by(name="2025-2026").first() or AcademicYear(name="2025-2026")
db.add(year)

g24 = Grade(name="24级", enrollment_year=2024)
g23 = Grade(name="23级", enrollment_year=2023)
db.add_all([g24, g23])
db.flush()

c1 = ClassInfo(name="建筑类2401", grade_id=g24.id, major="建筑类")
c2 = ClassInfo(name="建筑类2402", grade_id=g24.id, major="建筑类")
c3 = ClassInfo(name="土木类2301", grade_id=g23.id, major="土木类")
db.add_all([c1, c2, c3])
db.flush()

names = ["张伟", "王芳", "李婷", "刘畅", "陈晨", "杨帆", "赵鑫", "周悦",
         "吴桐", "徐磊", "孙倩", "胡军", "朱琳", "高翔", "林静", "何斌",
         "郭爽", "罗凯", "郑爽阳".replace("爽", "晓"), "韩雪"]
students = []
for i, n in enumerate(names):
    cls = c1 if i < 8 else (c2 if i < 15 else c3)
    s = Student(student_no=f"24{i + 1:07d}" if cls.grade_id == g24.id else f"23{i + 1:07d}",
                name=n, class_id=cls.id)
    students.append(s)
db.add_all(students)
db.flush()

courses = [
    ("MATH1001", "高等数学A(上)", "王教授", 4.0, "秋季"),
    ("ENG1001", "大学英语(一)", "李老师", 3.0, "秋季"),
    ("IDEA1001", "思想道德与法治", "张老师", 3.0, "秋季"),
    ("PE1001", "大学体育(一)", "刘老师", 1.0, "秋季"),
    ("MATH1002", "高等数学A(下)", "王教授", 4.0, "春季"),
    ("CS1101", "程序设计基础", "陈老师", 4.0, "春季"),
    ("PHY1001", "大学物理(一)", "赵老师", 4.0, "春季"),
    ("ENG1002", "大学英语(二)", "李老师", 3.0, "春季"),
]

for s in students:
    for code, cname, teacher, credit, sem in courses:
        base = random.randint(62, 97)
        if random.random() < 0.12:  # 少量五级制等级成绩
            level = random.choice(["优", "良", "中", "及格"])
            raw, num = level, {"优": 95, "良": 85, "中": 75, "及格": 65}[level]
        else:
            raw, num = str(base), float(base)
        db.add(ScoreRecord(student_id=s.id, academic_year_id=year.id, semester=sem,
                           course_code=code, course_name=cname, teacher=teacher,
                           credit=credit, score_raw=raw, score_num=num,
                           gpa=round(max(0.0, (num - 50) / 10), 1)))

eval_items = [
    ("思想品德", "基础分+23\n志愿服务2次+1.5", 24.5),
    ("社会工作", "班级学习委员+10\n加分明细：出勤全勤", 12.0),
    ("科研及科技创新", "校结构设计竞赛三等奖+15", 15.0),
    ("文体活动", "校运会跳远第三名+8\n迎新晚会参演+2.5", 10.5),
    ("集体建设", "班级基础分+7\n寝室基础分+8\n文明寝室+4", 19.0),
]
for s in students:
    for item, detail, base in eval_items:
        score = round(max(0, base + random.uniform(-3, 3)), 1)
        db.add(EvalRecord(student_id=s.id, academic_year_id=year.id,
                          item_name=item, detail_text=detail, score=score))

db.query(User).filter_by(username="admin").update({"must_change_password": False})
db.commit()
print("demo db ready:",
      db.query(Student).count(), "students,",
      db.query(ScoreRecord).count(), "scores,",
      db.query(EvalRecord).count(), "eval records")
db.close()
