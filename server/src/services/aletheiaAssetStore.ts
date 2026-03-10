import crypto from "crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";

const PODCAST_ASSET_TYPE = "aletheia_briefing";
const PODCAST_STORAGE_PROVIDER = "s3";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

let s3Client: S3Client | null = null;

function getPodcastBucket(): string {
  return (process.env.PODCAST_AUDIO_BUCKET || "").trim();
}

function getPodcastPrefix(): string {
  const raw = (process.env.PODCAST_AUDIO_PREFIX || "aletheia").trim();
  return raw.replace(/^\/+|\/+$/g, "");
}

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-2",
    });
  }
  return s3Client;
}

function buildStorageKey(tenantId: string, contextHash: string): string {
  const normalizedHash = crypto
    .createHash("sha256")
    .update(contextHash)
    .digest("hex")
    .slice(0, 24);
  const day = new Date().toISOString().slice(0, 10);
  return `${getPodcastPrefix()}/${tenantId}/${day}/${normalizedHash}.pcm`;
}

async function readBodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const withTransform = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof withTransform.transformToByteArray === "function") {
    const bytes = await withTransform.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof (body as any)[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
      if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(Buffer.from(chunk));
      }
    }
    return Buffer.concat(chunks);
  }

  return Buffer.alloc(0);
}

export type PersistedAletheiaAsset = {
  script: string;
  contextHash: string;
  createdAt: number;
  pcm: Buffer;
  mimeType: string;
  sampleRate: number;
  segmentsCount: number;
  model?: string;
  voiceName?: string;
};

export async function loadPersistedAletheiaAsset(
  tenantId: string,
  contextHash: string
): Promise<PersistedAletheiaAsset | null> {
  const bucket = getPodcastBucket();
  if (!bucket) return null;

  try {
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    const rowResult = await tenantPool.query(
      `SELECT script, storage_key, mime_type, sample_rate, segments_count, model, voice_name, audio_bytes, created_at, expires_at
       FROM public.podcast_assets
       WHERE asset_type = $1
         AND context_hash = $2
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [PODCAST_ASSET_TYPE, contextHash]
    );
    if (rowResult.rows.length === 0) return null;

    const row = rowResult.rows[0];
    const getRes = await getS3Client().send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: row.storage_key,
      })
    );
    const pcm = await readBodyToBuffer(getRes.Body);
    if (!pcm.length) return null;

    return {
      script: row.script,
      contextHash,
      createdAt: new Date(row.created_at).getTime(),
      pcm,
      mimeType: row.mime_type || "audio/pcm;rate=24000",
      sampleRate: Number(row.sample_rate) || 24000,
      segmentsCount: Number(row.segments_count) || 1,
      model: row.model || undefined,
      voiceName: row.voice_name || undefined,
    };
  } catch (error: any) {
    if (
      error?.code === "42P01" || // undefined_table
      error?.name === "NoSuchKey" ||
      error?.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    console.warn(
      `[AletheiaAssetStore] Failed to load persisted asset for tenant ${tenantId}:`,
      error?.message || error
    );
    return null;
  }
}

export async function hasPersistedAletheiaAsset(
  tenantId: string
): Promise<{ available: boolean; createdAt?: string; durationSec?: number }> {
  const bucket = getPodcastBucket();
  if (!bucket) return { available: false };

  try {
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    const result = await tenantPool.query(
      `SELECT created_at, audio_bytes, sample_rate
       FROM public.podcast_assets
       WHERE asset_type = $1
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [PODCAST_ASSET_TYPE]
    );
    if (result.rows.length === 0) return { available: false };

    const row = result.rows[0];
    const sampleRate = Number(row.sample_rate) || 24000;
    const audioBytes = Number(row.audio_bytes) || 0;
    const durationSec = audioBytes > 0 ? audioBytes / 2 / sampleRate : undefined;

    return {
      available: true,
      createdAt: row.created_at,
      durationSec,
    };
  } catch {
    return { available: false };
  }
}

export async function persistAletheiaAsset(input: {
  tenantId: string;
  contextHash: string;
  script: string;
  pcm: Buffer;
  mimeType: string;
  sampleRate: number;
  segmentsCount: number;
  model?: string;
  voiceName?: string;
  ttlMs?: number;
}): Promise<void> {
  const bucket = getPodcastBucket();
  if (!bucket || !input.pcm.length) return;

  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const storageKey = buildStorageKey(input.tenantId, input.contextHash);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlMs);

  try {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: input.pcm,
        ContentType: "audio/pcm",
        ServerSideEncryption: "aws:kms",
      })
    );

    const tenantPool = await tenantDbManager.getTenantPool(input.tenantId);
    await tenantPool.query(
      `INSERT INTO public.podcast_assets (
          asset_type, context_hash, script, storage_provider, storage_key,
          mime_type, sample_rate, segments_count, model, voice_name, audio_bytes, created_at, expires_at
       ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11, $12, $13
       )
       ON CONFLICT (asset_type, context_hash)
       DO UPDATE SET
          script = EXCLUDED.script,
          storage_provider = EXCLUDED.storage_provider,
          storage_key = EXCLUDED.storage_key,
          mime_type = EXCLUDED.mime_type,
          sample_rate = EXCLUDED.sample_rate,
          segments_count = EXCLUDED.segments_count,
          model = EXCLUDED.model,
          voice_name = EXCLUDED.voice_name,
          audio_bytes = EXCLUDED.audio_bytes,
          created_at = EXCLUDED.created_at,
          expires_at = EXCLUDED.expires_at`,
      [
        PODCAST_ASSET_TYPE,
        input.contextHash,
        input.script,
        PODCAST_STORAGE_PROVIDER,
        storageKey,
        input.mimeType,
        input.sampleRate,
        input.segmentsCount,
        input.model || null,
        input.voiceName || null,
        input.pcm.length,
        createdAt.toISOString(),
        expiresAt.toISOString(),
      ]
    );
  } catch (error: any) {
    console.error(
      `[AletheiaAssetStore] Failed to persist asset for tenant ${input.tenantId}:`,
      error?.message || error
    );
    throw error;
  }
}

