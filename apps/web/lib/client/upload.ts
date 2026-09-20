/** Browser-side upload: request a signed URL, PUT the file, finalise, then poll until processed. */
export interface UploadedAsset {
  id: string;
  fileName: string;
  url: string;
  thumbnailUrl: string;
  status: string;
}

export async function uploadMediaFile(file: File, onProgress?: (pct: number) => void): Promise<UploadedAsset> {
  onProgress?.(5);
  const res = await fetch("/api/media", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, size: file.size }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Upload rejected");
  onProgress?.(20);
  const put = await fetch(data.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
  if (!put.ok) throw new Error("Storage upload failed");
  onProgress?.(70);
  const done = await fetch(`/api/media/${data.assetId}/complete`, { method: "POST" });
  if (!done.ok) throw new Error("Could not finalise upload");
  // Wait for the worker to produce renditions (thumbnail + platform sizes).
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`/api/media/${data.assetId}/url`);
    const u = await r.json();
    const list = await fetch(`/api/media?pageSize=1&kind=IMAGE`)
      .then((x) => x.json())
      .catch(() => null);
    const status = list?.items?.find((a: { id: string }) => a.id === data.assetId)?.status;
    onProgress?.(70 + Math.min(29, i * 3));
    if (status === "READY" || status === "FAILED") {
      if (status === "FAILED") throw new Error("Image processing failed");
      onProgress?.(100);
      return { id: data.assetId, fileName: file.name, url: u.url, thumbnailUrl: u.thumbnailUrl, status };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const u = await fetch(`/api/media/${data.assetId}/url`).then((r) => r.json());
  onProgress?.(100);
  return { id: data.assetId, fileName: file.name, url: u.url, thumbnailUrl: u.thumbnailUrl, status: "UPLOADED" };
}
