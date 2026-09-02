"""请求/响应模型（核心载荷）。"""
from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str
    password: str


class PasswordIn(BaseModel):
    old_password: str = ""
    new_password: str = Field(min_length=6)


class SchemeItem(BaseModel):
    name: str
    max_score: float
    base_template: str = ""


class SchemeIn(BaseModel):
    weight_academic: float = 0.8
    weight_eval: float = 0.2
    retake_rule: str = "latest"
    items: list[SchemeItem]


class ConversionIn(BaseModel):
    level_text: str
    score: float
    level_group: str = "五级制"


class UserIn(BaseModel):
    username: str
    password: str = ""
    real_name: str = ""
    enabled: bool = True
    must_change_password: bool = True
    grade_ids: list[int] = []


class ClassIn(BaseModel):
    name: str
    grade_id: int
    college_id: int | None = None
    major: str | None = None  # 显式专业；留空按班级名自动提取（排名分组用）


class StudentIn(BaseModel):
    student_no: str
    name: str
    class_id: int


class EvalSaveItem(BaseModel):
    item_name: str
    detail_text: str = ""
    score: float = 0


class EvalSaveIn(BaseModel):
    student_id: int
    academic_year_id: int
    items: list[EvalSaveItem]


class EvalBatchIn(BaseModel):
    academic_year_id: int
    rows: list[EvalSaveIn]


class CopyPrevIn(BaseModel):
    from_year_id: int
    to_year_id: int
    class_id: int | None = None


class FillBaseIn(BaseModel):
    academic_year_id: int
    class_id: int
    only_missing: bool = True


class WorkbookIn(BaseModel):
    academic_year_id: int
    grade_ids: list[int] = []
    class_ids: list[int] = []
    brief: bool = False


class ClearDataIn(BaseModel):
    academic_year_id: int
    grade_id: int
    kind: str = Field(pattern="^(score|eval)$")  # score=成绩记录 eval=综测记录
