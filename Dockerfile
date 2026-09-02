# ---------- 阶段一：构建前端 ----------
FROM node:22-alpine AS frontend-build
WORKDIR /build
COPY frontend/app/package.json frontend/app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/app/ ./
RUN npm run build

# ---------- 阶段二：Python 运行时（后端 + 静态托管前端产物） ----------
FROM python:3.12-slim
WORKDIR /app/backend

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend-build /build/dist /app/frontend/app/dist

# 数据目录：SQLite 数据库落在 /data，由宿主机卷持久化
ENV ZONGCE_DATA_DIR=/data \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai
VOLUME ["/data"]

EXPOSE 8300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8300/api/health',timeout=3).status==200 else 1)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8300"]
