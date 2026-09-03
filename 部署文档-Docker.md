# 部署文档 · Docker

> 适用：综测计算工作台 v1.3。单容器部署：镜像内多阶段构建前端，由 FastAPI 同源静态托管；SQLite 数据库存放于 Docker 命名卷，容器生命周期之外持久化。

## 1. 文件说明

| 文件 | 作用 |
|---|---|
| `Dockerfile` | 多阶段构建：Node 构建前端 → Python 运行时（含 HEALTHCHECK） |
| `docker-compose.yml` | 编排：项目名、端口、命名卷、JWT 密钥、自启策略 |
| `.dockerignore` | 排除样本数据 / 截图 / node_modules，加速构建 |

## 2. 快速启动

```bash
cd /path/to/综测计算工作台
docker compose up -d --build
```

首次启动自动在命名卷中创建 `zongce.db`，并写入默认管理员 `admin / admin123`（**登录后立即改密**）。浏览器访问 `http://服务器IP:8300` 即可。

### 构建镜像源（默认开启）

`pip install` 默认走清华 PyPI 源、`npm ci` 默认走 npmmirror（国内构建速度快）。构建机在**境外**时设为关闭，改用官方源：

```bash
USE_CN_MIRROR=false docker compose up -d --build
# 或写入 .env：echo "USE_CN_MIRROR=false" >> .env
```

等价的裸 `docker build` 写法：`docker build --build-arg USE_CN_MIRROR=false -t zongce-workbench .`（默认不加参数 = 走镜像源）。

> 无需本机安装 Node 或 Python——前端构建、依赖安装全部在镜像内完成。
> 目录名为中文时 compose 无法自动推导项目名，`docker-compose.yml` 已显式指定 `name: zongce`。

## 3. 数据持久化

- 容器内数据目录为 `/data`（环境变量 `ZONGCE_DATA_DIR=/data`），由命名卷 `zongce-data` 承载；
- **容器删除、`docker compose down`、镜像升级重建均不丢数据**；只有 `docker volume rm zongce_zongce-data` 才会删。

### 3.1 备份 / 恢复 / 迁移

**重要**：数据库开启 WAL 后，数据可能暂存于 `zongce.db-wal`，**直接裸拷单个 `zongce.db` 文件会丢数据甚至得到损坏文件**。务必用下面任一方式：

```bash
# 方式一（推荐）：SQLite 备份 API，生成合并后的完整快照（容器运行中也可用）
docker run --rm -v zongce_zongce-data:/data zongce-workbench:latest \
  python -c "import sqlite3;s=sqlite3.connect('/data/zongce.db');d=sqlite3.connect('/data/backup.db');s.backup(d);d.close()"
docker run --rm -v zongce_zongce-data:/data -v "$PWD:/backup" alpine cp /data/backup.db /backup/

# 方式二：停服后整目录打包
docker compose down
docker run --rm -v zongce_zongce-data:/data -v "$PWD:/backup" alpine tar czf /backup/zongce-data.tar.gz /data
docker compose up -d
```

**恢复 / 从宝塔部署迁移**：

```bash
# 把旧服务器 /www/wwwroot/zongce/backend/data/zongce.db（先按方式一导出）
# 拷到新服务器，然后通过 docker cp 导入卷（不要走 bind mount 拷贝）
docker volume create zongce_zongce-data
docker run -d --name zongce-import -v zongce_zongce-data:/data alpine sleep 60
docker cp ./zongce.db zongce-import:/data/zongce.db
docker rm -f zongce-import
docker compose up -d
```

### 3.2 Linux 服务器改用 bind mount（可选）

想直接看到数据文件（便于面板计划任务备份）的 Linux 用户，把 compose 中 `volumes` 改为：

```yaml
    volumes:
      - ./data:/data
```

> **Windows / macOS 开发机不要用 bind mount 存 SQLite**：Docker Desktop 的虚拟化文件系统不支持 SQLite 依赖的文件锁与 WAL 共享内存，会出现 `disk I/O error` 甚至索引损坏（本项目实测复现）。命名卷在所有平台都可靠。

## 4. 配置项

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `ZONGCE_JWT_SECRET` | 内置默认值 | **生产环境务必修改**（见下） |
| `ZONGCE_DATA_DIR` | `/data` | 容器内数据目录，一般无需改动 |
| `USE_CN_MIRROR` | `true` | 构建期开关：默认 pip 走清华源、npm 走 npmmirror；境外构建设 `false` |
| 端口映射 | `8300:8300` | 改 compose 左侧宿主机端口即可，如 `80:8300` |

在项目根目录创建 `.env` 设置密钥（compose 自动读取）：

```bash
echo "ZONGCE_JWT_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d
```

> 更换密钥后所有登录态失效，需重新登录（数据不受影响）。

## 5. 常用运维命令

```bash
docker compose ps                  # 状态（含 healthcheck）
docker compose logs -f zongce      # 日志
docker compose restart             # 重启
docker compose down                # 停止并删容器（数据保留在卷中）
docker compose up -d --build       # 升级代码后重建镜像并启动
./update.sh                        # 一键升级：确认 → 备份数据库 → git pull → 重建 → 健康检查（数据卷只读访问）
docker volume rm zongce_zongce-data  # ⚠ 彻底清空数据（先确认已有备份）
```

## 6. Nginx 反代（可选，套域名/HTTPS 时）

```nginx
server {
    listen 80;
    server_name zongce.example.com;
    client_max_body_size 50m;   # 成绩 Excel 上传
    location / {
        proxy_pass http://127.0.0.1:8300;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 7. 验证清单

1. `curl http://127.0.0.1:8300/api/health` 返回 `{"status":"ok"}`，`docker compose ps` 显示 healthy；
2. 浏览器打开站点 → 登录页正常，admin 首登强制改密；
3. `docker compose down && docker compose up -d` 后重新登录 → 之前录入的数据仍在（持久化生效）；
4. 上传样本 Excel → 预览与入库正常。

## 8. 常见问题

- **启动失败 / unhealthy**：`docker compose logs zongce`；确认 8300 未被占用（改 compose 左侧端口）；
- **端口映射不生效（`docker port` 无输出、宿主机连不上）**：Docker Desktop 端口转发服务偶发卡死，`docker compose down && up -d` 重建容器，无效则重启 Docker Desktop；
- **上传 413**：Nginx `client_max_body_size` 未调大（容器本身无限制）；
- **锁库 database is locked**：单容器单 uvicorn 进程挂库，勿再另起本地进程共用同一库文件；
- **忘记 admin 密码**：`docker compose exec zongce python -m app.reset_admin` 重置为 `admin123`；
- **`disk I/O error` / 数据库索引损坏**：十有八九是 SQLite 数据文件被放在了虚拟化/网络文件系统（bind mount、NFS）上——改用命名卷（见 §3.2 警告），损坏的库可用 `PRAGMA quick_check` 定位 + `REINDEX` / `.recover` 修复。
