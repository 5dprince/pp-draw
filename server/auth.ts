import { timingSafeEqual } from "node:crypto";

import type { NextFunction, Request, Response } from "express";
import * as jwt from "jsonwebtoken";

import { config } from "./config.js";

const cookieName = "excalidraw_minio_session";
const sessionDays = 7;

function constantTimeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  const length = Math.max(actualBuffer.length, expectedBuffer.length, 1);
  const paddedActual = Buffer.alloc(length);
  const paddedExpected = Buffer.alloc(length);
  actualBuffer.copy(paddedActual);
  expectedBuffer.copy(paddedExpected);
  return timingSafeEqual(paddedActual, paddedExpected) && actual.length === expected.length;
}

export function isPasswordValid(password: string) {
  return constantTimeEqual(password, config.appPassword);
}

export function setSessionCookie(res: Response) {
  const token = jwt.sign({ sub: "admin" }, config.sessionSecret, {
    expiresIn: `${sessionDays}d`,
  });
  res.cookie(cookieName, token, {
    httpOnly: true,
    maxAge: sessionDays * 24 * 60 * 60 * 1000,
    sameSite: "lax",
    secure: config.cookieSecure,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(cookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
  });
}

export function isAuthenticated(req: Request) {
  const token = req.cookies?.[cookieName];
  if (!token || typeof token !== "string") {
    return false;
  }
  try {
    const payload = jwt.verify(token, config.sessionSecret);
    return typeof payload === "object" && payload.sub === "admin";
  } catch {
    return false;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "未登录" });
}
