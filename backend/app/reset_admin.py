"""忘记 admin 密码时的救援脚本：重置为 admin123，并要求首次登录强制改密。

用法（Docker 部署）：docker compose exec zongce python -m app.reset_admin
用法（裸机部署，在 backend 目录下）：python -m app.reset_admin
"""
from .auth import hash_password
from .database import Base, SessionLocal, engine
from .models import OperationLog, User


def main():
    Base.metadata.create_all(engine)  # 救援脚本独立运行，不依赖应用启动建表
    with SessionLocal() as db:
        admin = db.query(User).filter_by(username="admin").first()
        if admin is None:
            print("未找到 admin 账号，无可重置对象")
            return
        admin.password_hash, admin.salt = hash_password("admin123")
        admin.token_version += 1      # 使所有已登录凭证立即失效
        admin.enabled = True
        admin.must_change_password = True
        admin.failed_attempts, admin.locked_until = 0, None  # 同时解除登录锁定
        db.add(OperationLog(operator_name="system", action="重置密码",
                            detail="admin 密码经救援脚本重置为初始值（首登强制改密）"))
        db.commit()
        print("admin 密码已重置为 admin123，请立即登录并修改。")


if __name__ == "__main__":
    main()
