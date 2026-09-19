"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export function MediaUploader() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function upload(file: File) {
    setProgress(5);
    const res = await fetch("/api/media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, size: file.size }),
    });
    const data = await res.json();
    if (!res.ok) {
      setProgress(null);
      return toast.error(data.message ?? "Upload rejected");
    }
    setProgress(20);
    const isMemory = String(data.uploadUrl).includes("/upload/");
    const target = isMemory ? `/api/media/dev?key=${encodeURIComponent(data.storageKey)}` : data.uploadUrl;
    const put = await fetch(target, { method: "PUT", headers: { "content-type": file.type }, body: file });
    if (!put.ok) {
      setProgress(null);
      return toast.error("Storage upload failed");
    }
    setProgress(80);
    const done = await fetch(`/api/media/${data.assetId}/complete`, { method: "POST" });
    setProgress(null);
    if (!done.ok) return toast.error("Could not finalise upload");
    toast.success(`${file.name} uploaded; processing renditions`);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {progress !== null && <Progress value={progress} className="w-32" />}
      <input
        ref={input}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,application/pdf"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <Button onClick={() => input.current?.click()} disabled={progress !== null}>
        <Upload /> Upload
      </Button>
    </div>
  );
}
