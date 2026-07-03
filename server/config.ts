import { resolve } from "node:path";

import dotenv from "dotenv";

dotenv.config();

const trueValues = new Set(["1", "true", "yes", "on"]);

function boolEnv(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  return trueValues.has(value.toLowerCase());
}

function numberEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function endpointEnv(name: string) {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    return "";
  }
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}

export const config = {
  appPassword: process.env.APP_PASSWORD ?? "admin123",
  cookieSecure: boolEnv("COOKIE_SECURE", false),
  databasePath: resolve(process.env.DATABASE_PATH ?? "./data/app.db"),
  host: process.env.HOST ?? "127.0.0.1",
  jsonLimit: process.env.JSON_LIMIT ?? "200mb",
  minio: {
    accessKey: process.env.MINIO_ACCESS_KEY ?? "",
    autoCreateBucket: boolEnv("MINIO_AUTO_CREATE_BUCKET", true),
    bucket: process.env.MINIO_BUCKET ?? "",
    endpoint: endpointEnv("MINIO_ENDPOINT"),
    forcePathStyle: boolEnv("MINIO_FORCE_PATH_STYLE", true),
    prefix: (process.env.MINIO_PREFIX ?? "excalidraw").replace(/^\/+|\/+$/g, ""),
    region: process.env.MINIO_REGION ?? "us-east-1",
    secretKey: process.env.MINIO_SECRET_KEY ?? "",
  },
  port: numberEnv("API_PORT", numberEnv("PORT", 4173)),
  sessionSecret:
    process.env.SESSION_SECRET ??
    "replace-this-session-secret-before-sharing-the-service",
};

export function requiredStorageEnv() {
  const missing: string[] = [];
  if (!config.minio.endpoint) missing.push("MINIO_ENDPOINT");
  if (!config.minio.bucket) missing.push("MINIO_BUCKET");
  if (!config.minio.accessKey) missing.push("MINIO_ACCESS_KEY");
  if (!config.minio.secretKey) missing.push("MINIO_SECRET_KEY");
  return missing;
}
