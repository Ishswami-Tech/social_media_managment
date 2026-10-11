"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { parsePostCsv, type ImportRow } from "@/lib/post-import";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlatformIcon } from "@/components/app/platform-icon";

interface Account {
  id: string;
  platform: string;
  displayName: string;
  mediaRequired: boolean;
  maxLength: number;
}

export function PostImport({ accounts, timezone }: { accounts: Account[]; timezone: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [importId, setImportId] = useState("");
  const [fileName, setFileName] = useState("");
  const targets = accounts.filter((account) => selected.includes(account.id));
  const warnings = targets.filter(
    (account) => account.mediaRequired || rows.some((row) => row.text.length > account.maxLength),
  );
  async function readFile(file?: File) {
    setRows([]);
    setError("");
    setFileName(file?.name ?? "");
    setImportId(crypto.randomUUID());
    if (!file) return;
    if (file.size > 2_000_000) {
      setError("Choose a CSV file smaller than 2 MB");
      return;
    }
    try {
      setRows(parsePostCsv(await file.text()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this CSV");
    }
  }
  function downloadTemplate() {
    const content =
      'title,text,scheduled_at,tags\r\nLaunch,"Our new collection is here!",,launch|new\r\nTip,"Save this tip for later.",,tips\r\n';
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "social-posts-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function importPosts() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/posts/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ importId, accountIds: selected, rows }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Import failed. Try again.");
      toast.success(`${data.posts.length} draft posts imported`);
      router.push("/posts");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>1. Choose accounts</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!accounts.length && (
            <p className="text-sm text-muted-foreground">
              Connect a social account before importing.{" "}
              <Link href="/accounts" className="text-primary underline">
                Connect accounts
              </Link>
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((account) => (
              <label key={account.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
                <input
                  type="checkbox"
                  checked={selected.includes(account.id)}
                  disabled={busy}
                  onChange={(e) => {
                    setSelected((current) =>
                      e.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id),
                    );
                    setImportId(crypto.randomUUID());
                  }}
                />
                <PlatformIcon platform={account.platform} />
                <span className="text-sm font-medium">{account.displayName}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Each imported post will have a separate caption for every selected account. You can customize it in the
            composer.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>2. Upload your CSV</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download />
              Download template
            </Button>
            <span className="text-xs text-muted-foreground">Up to 100 posts · 2 MB maximum</span>
          </div>
          <Label htmlFor="post-csv">CSV file</Label>
          <Input
            id="post-csv"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
          <p className="text-sm text-muted-foreground">
            Required column: <code>text</code>. Optional: <code>title</code>, <code>scheduled_at</code>,{" "}
            <code>tags</code>. Separate tags with |. Dates need an explicit timezone, for example{" "}
            <code>2026-11-01T09:00:00+05:30</code>.
          </p>
          <p className="text-sm text-muted-foreground">
            Imports are saved as drafts. Dates are planning dates until you review and schedule each post. Calendar
            times display in {timezone}.
          </p>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </CardContent>
      </Card>
      {!!rows.length && (
        <Card>
          <CardHeader>
            <CardTitle>3. Review {rows.length} posts</CardTitle>
            <p className="text-sm text-muted-foreground">{fileName}</p>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!!warnings.length && (
              <p className="rounded-lg border bg-muted p-3 text-sm">
                Some posts need changes for {warnings.map((a) => a.displayName).join(", ")}. Add required media or
                shorten captions in the composer before scheduling.
              </p>
            )}
            <div className="max-h-96 overflow-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-3">Post</th>
                    <th className="p-3">Caption</th>
                    <th className="p-3">Planned time</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="border-t">
                      <td className="p-3 align-top">{row.title || `Post ${index + 1}`}</td>
                      <td className="max-w-md p-3 align-top whitespace-pre-wrap">{row.text}</td>
                      <td className="p-3 align-top whitespace-nowrap">
                        {row.scheduledAt
                          ? new Intl.DateTimeFormat("en", {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: timezone,
                            }).format(new Date(row.scheduledAt))
                          : "Unscheduled"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button onClick={importPosts} disabled={busy || !selected.length} className="justify-self-start">
              <Upload />
              {busy ? "Importing…" : `Import ${rows.length} drafts`}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
