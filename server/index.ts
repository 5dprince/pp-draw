import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import cookieParser from "cookie-parser";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";

import {
  clearSessionCookie,
  isAuthenticated,
  isPasswordValid,
  requireAuth,
  setSessionCookie,
} from "./auth.js";
import { config } from "./config.js";
import {
  dbInfo,
  deleteDrawing,
  getDrawing,
  insertDrawing,
  listDrawings,
  updateDrawingAfterSave,
} from "./db.js";
import {
  checkStorage,
  deleteSceneJson,
  getLibraryJson,
  getSceneJson,
  putLibraryJson,
  putSceneJson,
  sceneKey,
} from "./storage.js";

type ExcalidrawScene = {
  appState: Record<string, unknown>;
  elements: unknown[];
  files: Record<string, unknown>;
  source: string;
  type: "excalidraw";
  version: number;
};

type ExcalidrawLibrary = {
  libraryItems: unknown[];
  source: string;
  type: "excalidrawlib";
  version: number;
};

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<void>;

const app = express();

app.use(express.json({ limit: config.jsonLimit }));
app.use(cookieParser());

function asyncRoute(handler: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function httpError(status: number, message: string) {
  const error = new Error(message);
  Object.assign(error, { status });
  return error;
}

function cleanTitle(title: unknown, fallback = "未命名画布") {
  if (typeof title !== "string") {
    return fallback;
  }
  const cleaned = title.trim();
  return cleaned || fallback;
}

function drawingId(req: Request) {
  const id = req.params.id;
  if (typeof id !== "string") {
    throw httpError(400, "画布 ID 不正确");
  }
  return id;
}

function normalizeAppState(appState: unknown) {
  if (!appState || typeof appState !== "object" || Array.isArray(appState)) {
    return {};
  }

  const normalized = { ...(appState as Record<string, unknown>) };
  delete normalized.collaborators;
  return normalized;
}

function normalizeScene(input: unknown): ExcalidrawScene {
  if (!input || typeof input !== "object") {
    throw httpError(400, "画布数据格式不正确");
  }

  const raw = input as Partial<ExcalidrawScene>;
  if (!Array.isArray(raw.elements)) {
    throw httpError(400, "画布数据缺少 elements");
  }
  const files = raw.files && typeof raw.files === "object" && !Array.isArray(raw.files) ? raw.files : {};

  return {
    appState: normalizeAppState(raw.appState),
    elements: raw.elements.map((element) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) {
        return element;
      }

      const imageElement = element as Record<string, unknown>;
      if (imageElement.type !== "image" || typeof imageElement.fileId !== "string") {
        return element;
      }

      const file = (files as Record<string, unknown>)[imageElement.fileId];
      if (!file || typeof file !== "object" || !("dataURL" in file)) {
        return element;
      }

      return { ...imageElement, status: "saved" };
    }),
    files,
    source: typeof raw.source === "string" ? raw.source : "excalidraw-minio",
    type: "excalidraw",
    version: typeof raw.version === "number" ? raw.version : 2,
  };
}

function emptyScene(): ExcalidrawScene {
  return {
    appState: {
      gridSize: null,
      viewBackgroundColor: "#ffffff",
    },
    elements: [],
    files: {},
    source: "excalidraw-minio",
    type: "excalidraw",
    version: 2,
  };
}

function emptyLibrary(): ExcalidrawLibrary {
  return {
    libraryItems: [],
    source: "excalidraw-minio",
    type: "excalidrawlib",
    version: 2,
  };
}

function normalizeLibrary(input: unknown): ExcalidrawLibrary {
  if (Array.isArray(input)) {
    return { ...emptyLibrary(), libraryItems: input };
  }

  if (!input || typeof input !== "object") {
    throw httpError(400, "素材库数据格式不正确");
  }

  const raw = input as Partial<ExcalidrawLibrary> & { library?: unknown };
  const libraryItems = Array.isArray(raw.libraryItems)
    ? raw.libraryItems
    : Array.isArray(raw.library)
      ? raw.library
      : null;

  if (!libraryItems) {
    throw httpError(400, "素材库数据缺少 libraryItems");
  }

  return {
    libraryItems,
    source: typeof raw.source === "string" ? raw.source : "excalidraw-minio",
    type: "excalidrawlib",
    version: typeof raw.version === "number" ? raw.version : 2,
  };
}

app.get(
  "/api/health",
  asyncRoute(async (_req, res) => {
    const storage = await checkStorage();
    res.json({
      database: dbInfo(),
      storage,
    });
  }),
);

app.get("/api/me", (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.post("/api/login", (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!isPasswordValid(password)) {
    res.status(401).json({ error: "密码不正确" });
    return;
  }
  setSessionCookie(res);
  res.json({ authenticated: true });
});

app.post("/api/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/drawings", requireAuth, (req, res) => {
  void req;
  res.json({ drawings: listDrawings() });
});

app.get(
  "/api/library",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const json = await getLibraryJson();
    if (!json) {
      res.json({ exists: false, libraryItems: [] });
      return;
    }

    const library = normalizeLibrary(JSON.parse(json));
    res.json({ exists: true, libraryItems: library.libraryItems });
  }),
);

app.put(
  "/api/library",
  requireAuth,
  asyncRoute(async (req, res) => {
    const library = normalizeLibrary(req.body);
    await putLibraryJson(JSON.stringify(library));
    res.json({ libraryItems: library.libraryItems });
  }),
);

app.post(
  "/api/drawings",
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = nanoid(12);
    const title = cleanTitle(req.body?.title, "未命名画布");
    const scene = emptyScene();
    const json = JSON.stringify(scene);
    const objectKey = sceneKey(id);

    await putSceneJson(objectKey, json);
    const drawing = insertDrawing({
      bytes: Buffer.byteLength(json),
      elementCount: 0,
      id,
      objectKey,
      title,
    });

    res.status(201).json({ drawing, scene });
  }),
);

app.get(
  "/api/drawings/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const drawing = getDrawing(drawingId(req));
    if (!drawing) {
      throw httpError(404, "画布不存在");
    }

    const scene = normalizeScene(JSON.parse(await getSceneJson(drawing.objectKey)));
    res.json({ drawing, scene });
  }),
);

app.put(
  "/api/drawings/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const drawing = getDrawing(drawingId(req));
    if (!drawing) {
      throw httpError(404, "画布不存在");
    }

    const title = cleanTitle(req.body?.title, drawing.title);
    const scene = normalizeScene(req.body?.scene);
    const json = JSON.stringify(scene);

    await putSceneJson(drawing.objectKey, json);
    const updated = updateDrawingAfterSave({
      bytes: Buffer.byteLength(json),
      elementCount: scene.elements.length,
      id: drawing.id,
      title,
    });

    res.json({ drawing: updated, scene });
  }),
);

app.delete(
  "/api/drawings/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const drawing = getDrawing(drawingId(req));
    if (!drawing) {
      throw httpError(404, "画布不存在");
    }

    await deleteSceneJson(drawing.objectKey);
    deleteDrawing(drawing.id);
    res.status(204).end();
  }),
);

const root = dirname(fileURLToPath(import.meta.url));
const distDir = join(root, "..", "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      res.sendFile(join(distDir, "index.html"));
      return;
    }
    next();
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : 500;
  const message = error instanceof Error ? error.message : "服务器错误";
  res.status(Number.isFinite(status) ? status : 500).json({ error: message });
});

app.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${config.port}`);
});
