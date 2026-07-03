import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { config } from "./config.js";

export type DrawingRecord = {
  bytes: number;
  createdAt: string;
  elementCount: number;
  id: string;
  objectKey: string;
  title: string;
  updatedAt: string;
};

type DrawingRow = {
  bytes: number;
  created_at: string;
  element_count: number;
  id: string;
  object_key: string;
  title: string;
  updated_at: string;
};

mkdirSync(dirname(config.databasePath), { recursive: true });

const db = new DatabaseSync(config.databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS drawings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    element_count INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_drawings_updated_at ON drawings(updated_at DESC);
`);

function mapDrawing(row: DrawingRow): DrawingRecord {
  return {
    bytes: row.bytes,
    createdAt: row.created_at,
    elementCount: row.element_count,
    id: row.id,
    objectKey: row.object_key,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

export function listDrawings() {
  const rows = db
    .prepare("SELECT * FROM drawings ORDER BY updated_at DESC")
    .all() as DrawingRow[];
  return rows.map(mapDrawing);
}

export function getDrawing(id: string) {
  const row = db.prepare("SELECT * FROM drawings WHERE id = ?").get(id) as
    | DrawingRow
    | undefined;
  return row ? mapDrawing(row) : null;
}

export function insertDrawing(input: {
  bytes: number;
  elementCount: number;
  id: string;
  objectKey: string;
  title: string;
}) {
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO drawings
        (id, title, object_key, element_count, bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.id,
    input.title,
    input.objectKey,
    input.elementCount,
    input.bytes,
    now,
    now,
  );
  const drawing = getDrawing(input.id);
  if (!drawing) {
    throw new Error("Drawing was not inserted");
  }
  return drawing;
}

export function updateDrawingAfterSave(input: {
  bytes: number;
  elementCount: number;
  id: string;
  title: string;
}) {
  const now = new Date().toISOString();
  db.prepare(
    `
      UPDATE drawings
      SET title = ?, element_count = ?, bytes = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(input.title, input.elementCount, input.bytes, now, input.id);
  return getDrawing(input.id);
}

export function deleteDrawing(id: string) {
  db.prepare("DELETE FROM drawings WHERE id = ?").run(id);
}

export function dbInfo() {
  return {
    path: config.databasePath,
    totalDrawings: Number(
      (db.prepare("SELECT COUNT(*) AS count FROM drawings").get() as { count: number })
        .count,
    ),
  };
}
