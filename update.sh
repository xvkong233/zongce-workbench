#!/usr/bin/env bash
# 综测计算工作台 · 生产环境升级脚本
#
# 流程：确认 → 备份 SQLite（数据卷只读挂载，物理上不可能改动数据）
#      → git pull --ff-only → docker compose up -d --build → 等待容器 healthy
#
# 数据安全：数据库在命名卷 zongce_zongce-data 中，独立于镜像/容器生命周期，
# 升级重建镜像与容器不触碰卷；备份步骤对卷挂载 :ro，无写权限。
#
# 用法：
#   ./update.sh              交互确认后升级
#   ./update.sh -y           跳过确认（无人值守）
#   ./update.sh --no-pull    跳过 git pull（手动同步代码到服务器时）
#   ./update.sh -h           帮助
#
# 境外构建机：USE_CN_MIRROR=false ./update.sh
#
# 从备份恢复（手动，backup.db 为升级脚本生成的快照）：
#   docker compose down
#   docker run -d --name zongce-import -v zongce_zongce-data:/data alpine sleep 60
#   docker cp backups/zongce-XXXXXXXX.db zongce-import:/data/zongce.db
#   docker rm -f zongce-import
#   docker compose up -d

set -euo pipefail
cd "$(dirname "$0")"

# Git Bash/MSYS 下 docker -v 需要 Windows 形态的宿主机路径（D:/... 而非 /d/...）
if uname -s | grep -qi msys; then HOSTDIR="$(pwd -W)"; else HOSTDIR="$(pwd)"; fi

VOLUME="zongce_zongce-data"
IMAGE="zongce-workbench:latest"
CONTAINER="zongce"
BACKUP_DIR="backups"
KEEP_BACKUPS=10       # 本地保留的最近备份份数
HEALTH_TIMEOUT=180    # 等待容器 healthy 的秒数上限

BACKUP_FILE=""
YES=0
SKIP_PULL=0

usage() {
  grep '^# ' "$0" | sed 's/^# \{0,1\}//' | head -20
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    -y|--yes)  YES=1 ;;
    --no-pull) SKIP_PULL=1 ;;
    -h|--help) usage ;;
    *) echo "未知参数：$arg（-h 查看用法）"; exit 1 ;;
  esac
done

log()  { printf '\033[1;34m[update]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[失败]\033[0m %s\n' "$*" >&2; exit 1; }

trap 'warn "升级中断：数据卷始终未被本脚本写入或删除；最新备份：$(ls -t "$BACKUP_DIR"/zongce-*.db 2>/dev/null | head -1 || echo 无)"' ERR

# ---------- 前置检查 ----------
command -v docker >/dev/null 2>&1 || die "未找到 docker 命令"
docker compose version >/dev/null 2>&1 || die "未找到 docker compose v2 插件"
[ -f docker-compose.yml ] || die "请在项目根目录运行本脚本"

if [ "$YES" -ne 1 ]; then
  printf '将升级 综测计算工作台：自动备份 → git pull → 重建镜像与容器（数据卷不动）。继续？[y/N] '
  read -r reply || reply=""
  case "$reply" in y | Y | yes | YES) ;; *) echo "已取消"; exit 0 ;; esac
fi

# ---------- 备份（数据卷只读挂载） ----------
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  warn "未找到数据卷 $VOLUME（首次部署？），跳过备份"
elif ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  warn "未找到镜像 $IMAGE（首次部署？），跳过备份"
else
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/zongce-$(date +%Y%m%d-%H%M%S).db"
  log "备份数据库 → $BACKUP_FILE"
  docker run --rm -v "$VOLUME:/data:ro" -v "$HOSTDIR/$BACKUP_DIR:/backup" "$IMAGE" \
    python -c "import sqlite3;s=sqlite3.connect('/data/zongce.db');d=sqlite3.connect('/backup/$(basename "$BACKUP_FILE")');s.backup(d);d.close()"
  [ -s "$BACKUP_FILE" ] || die "备份文件为空，中止升级（数据未受影响）"
  log "备份完成：$(du -h "$BACKUP_FILE" | cut -f1)"
  ls -t "$BACKUP_DIR"/zongce-*.db | tail -n +$((KEEP_BACKUPS + 1)) | while read -r old; do
    rm -f "$old"
    log "清理旧备份：$old"
  done
fi

# ---------- 更新代码 ----------
if [ "$SKIP_PULL" -ne 1 ]; then
  log "拉取最新代码（git pull --ff-only）"
  git pull --ff-only || die "git pull 失败：请处理本地改动后重试，或手动更新代码后用 --no-pull 重跑"
else
  warn "跳过 git pull（使用当前目录代码）"
fi

# ---------- 重建并启动 ----------
log "重建镜像并启动容器（命名卷数据不受影响）"
docker compose up -d --build

# ---------- 健康检查 ----------
log "等待容器健康检查通过（最多 ${HEALTH_TIMEOUT}s）..."
elapsed=0
while :; do
  cid="$(docker compose ps -q "$CONTAINER")"
  if [ -n "$cid" ]; then
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
    [ "$status" = "healthy" ] && break
  else
    status="missing"
  fi
  [ "$elapsed" -ge "$HEALTH_TIMEOUT" ] \
    && die "等待超时（当前状态：$status）。排查：docker compose logs $CONTAINER"
  sleep 5
  elapsed=$((elapsed + 5))
done
trap - ERR

log "升级完成 ✓"
docker compose ps
echo
echo "本次备份：${BACKUP_FILE:-无（首次部署）}"
echo "回滚方式：git checkout <旧提交> && ./update.sh --no-pull（数据不受影响）"
