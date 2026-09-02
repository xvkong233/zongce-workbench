"""§13.1 数据库模型。"""
from datetime import datetime

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer,
                        String, Text, UniqueConstraint)
from sqlalchemy.ext.mutable import MutableList
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    salt: Mapped[str] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(16), default="counselor")  # admin|counselor
    real_name: Mapped[str] = mapped_column(String(64), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    token_version: Mapped[int] = mapped_column(Integer, default=1)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    grades: Mapped[list["Grade"]] = relationship(
        secondary="user_grades", lazy="selectin")


class UserGrade(Base):
    __tablename__ = "user_grades"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    grade_id: Mapped[int] = mapped_column(ForeignKey("grades.id", ondelete="CASCADE"), primary_key=True)


class College(Base):
    __tablename__ = "colleges"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)


class AcademicYear(Base):
    __tablename__ = "academic_years"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(16), unique=True)  # 2024-2025


class Grade(Base):
    __tablename__ = "grades"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(32), unique=True)  # 24级
    enrollment_year: Mapped[int] = mapped_column(Integer)


class ClassInfo(Base):
    __tablename__ = "classes"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    grade_id: Mapped[int] = mapped_column(ForeignKey("grades.id"))
    college_id: Mapped[int | None] = mapped_column(ForeignKey("colleges.id"), nullable=True)
    major: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 显式专业（v1.3.3）；
    # 为空时排名分组按班级名自动提取（calc.major_group）
    grade: Mapped["Grade"] = relationship(lazy="joined")
    college: Mapped["College | None"] = relationship(lazy="joined")


class Student(Base):
    __tablename__ = "students"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_no: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"))
    klass: Mapped["ClassInfo"] = relationship(lazy="joined")


class ScoreRecord(Base):
    __tablename__ = "score_records"
    __table_args__ = (UniqueConstraint("student_id", "academic_year_id", "semester", "course_code"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    academic_year_id: Mapped[int] = mapped_column(ForeignKey("academic_years.id"), index=True)
    semester: Mapped[str] = mapped_column(String(8))  # 秋季|春季
    course_code: Mapped[str] = mapped_column(String(64))
    course_name: Mapped[str] = mapped_column(String(128))
    teacher: Mapped[str] = mapped_column(String(128), default="")
    credit: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_raw: Mapped[str] = mapped_column(String(64), default="")   # 原始值留档
    score_num: Mapped[float | None] = mapped_column(Float, nullable=True)  # 换算后百分制
    gpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_elective: Mapped[str] = mapped_column(String(16), default="")
    course_category: Mapped[str] = mapped_column(String(32), default="")
    retake_type: Mapped[str] = mapped_column(String(16), default="")
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id"), nullable=True)


class EvalRecord(Base):
    __tablename__ = "eval_records"
    __table_args__ = (UniqueConstraint("student_id", "academic_year_id", "item_name"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    academic_year_id: Mapped[int] = mapped_column(ForeignKey("academic_years.id"), index=True)
    item_name: Mapped[str] = mapped_column(String(32))
    detail_text: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[float] = mapped_column(Float, default=0)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id"), nullable=True)


class EvalScheme(Base):
    """academic_year_id 为空 = 全局默认方案；grade_id 非空 = 年级专属方案（优先级最高）。"""
    __tablename__ = "eval_schemes"
    id: Mapped[int] = mapped_column(primary_key=True)
    academic_year_id: Mapped[int | None] = mapped_column(ForeignKey("academic_years.id"), nullable=True)
    grade_id: Mapped[int | None] = mapped_column(ForeignKey("grades.id"), nullable=True)
    weight_academic: Mapped[float] = mapped_column(Float, default=0.8)
    weight_eval: Mapped[float] = mapped_column(Float, default=0.2)
    retake_rule: Mapped[str] = mapped_column(String(16), default="latest")  # latest|highest
    items: Mapped[list] = mapped_column(JSON, default=list)
    # items: [{"name": 思想品德, "max_score": 25, "base_template": "基础分+23"}]


class GradeConversion(Base):
    __tablename__ = "grade_conversions"
    id: Mapped[int] = mapped_column(primary_key=True)
    level_text: Mapped[str] = mapped_column(String(32), unique=True)
    score: Mapped[float] = mapped_column(Float)
    level_group: Mapped[str] = mapped_column(String(16))  # 百分制|两级制|五级制


class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # score|eval|student
    filename: Mapped[str] = mapped_column(String(256), default="")
    academic_year_id: Mapped[int | None] = mapped_column(ForeignKey("academic_years.id"), nullable=True)
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    # MutableList：flush 后的就地 append 也能被变更检测跟踪，保证快照入库
    snapshot: Mapped[list] = mapped_column(MutableList.as_mutable(JSON), default=list)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    reverted: Mapped[bool] = mapped_column(Boolean, default=False)


class OperationLog(Base):
    __tablename__ = "operation_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    operator_name: Mapped[str] = mapped_column(String(64), default="")
    action: Mapped[str] = mapped_column(String(32))
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
