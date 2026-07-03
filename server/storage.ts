import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { config, requiredStorageEnv } from "./config.js";

let client: S3Client | null = null;
let bucketReady = false;

function assertStorageConfigured() {
  const missing = requiredStorageEnv();
  if (missing.length > 0) {
    const error = new Error(`Missing MinIO config: ${missing.join(", ")}`);
    Object.assign(error, { status: 500 });
    throw error;
  }
}

function s3() {
  assertStorageConfigured();
  if (!client) {
    client = new S3Client({
      credentials: {
        accessKeyId: config.minio.accessKey,
        secretAccessKey: config.minio.secretKey,
      },
      endpoint: config.minio.endpoint,
      forcePathStyle: config.minio.forcePathStyle,
      region: config.minio.region,
    });
  }
  return client;
}

export function sceneKey(id: string) {
  return config.minio.prefix ? `${config.minio.prefix}/${id}.excalidraw` : `${id}.excalidraw`;
}

export function libraryKey() {
  return config.minio.prefix
    ? `${config.minio.prefix}/library.excalidrawlib`
    : "library.excalidrawlib";
}

async function ensureBucket() {
  if (bucketReady) {
    return;
  }

  try {
    await s3().send(new HeadBucketCommand({ Bucket: config.minio.bucket }));
    bucketReady = true;
    return;
  } catch (headError) {
    if (!config.minio.autoCreateBucket) {
      throw headError;
    }
  }

  await s3().send(new CreateBucketCommand({ Bucket: config.minio.bucket }));
  bucketReady = true;
}

function isMissingObject(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return candidate.name === "NoSuchKey" || candidate.$metadata?.httpStatusCode === 404;
}

async function putJson(objectKey: string, json: string, contentType: string) {
  await ensureBucket();
  await s3().send(
    new PutObjectCommand({
      Body: json,
      Bucket: config.minio.bucket,
      CacheControl: "no-store",
      ContentType: contentType,
      Key: objectKey,
    }),
  );
}

async function getObjectText(objectKey: string) {
  await ensureBucket();
  const result = await s3().send(
    new GetObjectCommand({
      Bucket: config.minio.bucket,
      Key: objectKey,
    }),
  );

  if (!result.Body) {
    throw new Error("Empty MinIO object body");
  }

  return result.Body.transformToString();
}

export async function putSceneJson(objectKey: string, json: string) {
  await putJson(objectKey, json, "application/vnd.excalidraw+json; charset=utf-8");
}

export async function getSceneJson(objectKey: string) {
  return getObjectText(objectKey);
}

export async function deleteSceneJson(objectKey: string) {
  await ensureBucket();
  await s3().send(
    new DeleteObjectCommand({
      Bucket: config.minio.bucket,
      Key: objectKey,
    }),
  );
}

export async function putLibraryJson(json: string) {
  await putJson(libraryKey(), json, "application/vnd.excalidrawlib+json; charset=utf-8");
}

export async function getLibraryJson() {
  try {
    return await getObjectText(libraryKey());
  } catch (error) {
    if (isMissingObject(error)) {
      return null;
    }
    throw error;
  }
}

export async function checkStorage() {
  const missing = requiredStorageEnv();
  if (missing.length > 0) {
    return {
      bucketReachable: false,
      missing,
      storageConfigured: false,
    };
  }

  try {
    await ensureBucket();
    return {
      bucketReachable: true,
      missing: [],
      storageConfigured: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown MinIO error";
    return {
      bucketReachable: false,
      message,
      missing: [],
      storageConfigured: true,
    };
  }
}
