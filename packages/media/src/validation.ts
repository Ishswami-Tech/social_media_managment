import type { MediaKind } from "@platform/types";

export const ALLOWED_MIME: Record<string, MediaKind> = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/webp": "IMAGE",
  "image/gif": "GIF",
  "video/mp4": "VIDEO",
  "video/quicktime": "VIDEO",
  "video/webm": "VIDEO",
  "application/pdf": "DOCUMENT",
};

export const MAX_BYTES: Record<MediaKind, number> = {
  IMAGE: 30 * 1024 * 1024,
  GIF: 15 * 1024 * 1024,
  VIDEO: 2 * 1024 * 1024 * 1024,
  DOCUMENT: 100 * 1024 * 1024,
};

export interface UploadRequest {
  fileName: string;
  mimeType: string;
  size: number;
}

export interface UploadValidation {
  ok: boolean;
  kind?: MediaKind;
  error?: string;
}

const SAFE_NAME = /^[\w.\- ()]{1,200}$/;

export function validateUpload(req: UploadRequest): UploadValidation {
  const kind = ALLOWED_MIME[req.mimeType.toLowerCase()];
  if (!kind) return { ok: false, error: `Unsupported file type ${req.mimeType}` };
  if (!Number.isFinite(req.size) || req.size <= 0) return { ok: false, error: "Invalid file size" };
  if (req.size > MAX_BYTES[kind])
    return {
      ok: false,
      kind,
      error: `File exceeds the ${Math.round(MAX_BYTES[kind] / 1_048_576)}MB limit for ${kind.toLowerCase()}s`,
    };
  if (!SAFE_NAME.test(req.fileName)) return { ok: false, kind, error: "File name contains unsupported characters" };
  const ext = req.fileName.split(".").pop()?.toLowerCase();
  const expected = EXT_FOR_MIME[req.mimeType.toLowerCase()];
  if (expected && ext && !expected.includes(ext))
    return { ok: false, kind, error: `File extension .${ext} does not match type ${req.mimeType}` };
  return { ok: true, kind };
}

const EXT_FOR_MIME: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "video/mp4": ["mp4", "m4v"],
  "video/quicktime": ["mov"],
  "video/webm": ["webm"],
  "application/pdf": ["pdf"],
};

/** Magic-byte sniffing so a renamed executable cannot pass as an image. */
export function sniffMime(head: Uint8Array): string | undefined {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "image/webp";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    return brand.startsWith("qt") ? "video/quicktime" : "video/mp4";
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  return undefined;
}

/** Deterministic, tenant-prefixed object key; never derived from user-controlled paths. */
export function buildStorageKey(organizationId: string, assetId: string, fileName: string): string {
  const ext =
    fileName
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "bin";
  return `org/${organizationId}/media/${assetId}.${ext}`;
}
