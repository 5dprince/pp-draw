# PP Draw

一个轻量的 Excalidraw 私有画布服务：

- 单密码登录
- SQLite 保存画布列表、标题和更新时间
- MinIO 保存完整 `.excalidraw` JSON
- 全局素材库保存到 MinIO
- 画布默认手动保存，可在页面顶部打开自动保存

## 环境变量

复制示例配置：

```bash
cp .env.example .env
```

最少需要配置：

```env
APP_PASSWORD=change-me
SESSION_SECRET=replace-with-a-long-random-string

MINIO_ENDPOINT=http://your-minio-host:9000
MINIO_BUCKET=file
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_FORCE_PATH_STYLE=true
MINIO_PREFIX=excalidraw
```

`MINIO_ENDPOINT` 可以写完整地址 `http://172.16.2.10:9000`；如果只写 `172.16.2.10:9000`，服务会自动按 HTTP 处理。

大图片画布会让 JSON 很大，可以按需调高：

```env
JSON_LIMIT=200mb
```

## Docker

构建镜像，镜像名为 `pp-draw`：

```bash
docker build -t pp-draw .
```

运行：

```bash
docker run -d \
  --name pp-draw \
  --restart unless-stopped \
  -p 4173:4173 \
  -v /home/pp-draw-data:/app/data \
  -e APP_PASSWORD='change-me' \
  -e SESSION_SECRET='replace-with-a-long-random-string' \
  -e MINIO_ENDPOINT='http://your-minio-host:9000' \
  -e MINIO_BUCKET='file' \
  -e MINIO_ACCESS_KEY='your-access-key' \
  -e MINIO_SECRET_KEY='your-secret-key' \
  -e MINIO_FORCE_PATH_STYLE='true' \
  -e MINIO_PREFIX='excalidraw' \
  5dprince/pp-draw

```

打开：

```text
http://127.0.0.1:4173
```

## Docker Compose

`.env` 填好后：

```bash
docker compose up -d --build
```

## 本地开发

```bash
npm install
npm run dev
```

开发地址：

```text
http://127.0.0.1:5173
```

## 本地生产运行

```bash
npm run build
npm run start
```

默认监听：

```text
http://127.0.0.1:4173
```

部署到 HTTPS 反向代理后，可以设置：

```env
COOKIE_SECURE=true
```
