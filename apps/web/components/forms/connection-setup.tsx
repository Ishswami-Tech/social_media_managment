"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ConnectionFamily {
  name: string;
  family: string;
  configured: boolean;
  callback: string;
  connected: number;
  attention: number;
  description: string;
  dashboard: string;
}

export function ConnectionSetup({ families }: { families: ConnectionFamily[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(family: ConnectionFamily) {
    try {
      await navigator.clipboard.writeText(family.callback);
      setCopied(family.family);
      toast.success("Callback URL copied");
    } catch {
      toast.error("Could not copy. Select the callback URL and copy it manually.");
    }
  }
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      {families.map((family) => (
        <Card key={family.family}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              {family.name}
              <span className="text-xs font-normal text-muted-foreground">
                {family.configured ? "Ready to connect" : "Setup needed"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">{family.description}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>{family.connected} connected</span>
              {family.attention > 0 && <span className="text-destructive">{family.attention} need reconnection</span>}
            </div>
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Connection setup</summary>
              <div className="mt-3 grid gap-3 text-sm">
                <p>Register this callback URL in your provider&apos;s login settings:</p>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 rounded bg-muted p-2 text-xs break-all select-all">
                    {family.callback}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copy(family)}
                    aria-label={`Copy ${family.name} callback URL`}
                  >
                    {copied === family.family ? <Check /> : <Copy />}
                  </Button>
                </div>
                <a
                  href={family.dashboard}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline"
                >
                  Open provider settings
                  <ExternalLink className="size-3" />
                </a>
                {family.family === "meta" && (
                  <p>
                    Use Facebook Login for Business → Settings → Valid OAuth Redirect URIs. Connect a Facebook Page and
                    its linked Instagram professional account.
                  </p>
                )}
                {!family.configured && (
                  <p>
                    Your server administrator needs to configure this provider&apos;s App ID and secret before accounts
                    can connect.
                  </p>
                )}
                {family.callback.startsWith("http://") && (
                  <p className="text-amber-700 dark:text-amber-400">
                    This address uses HTTP. For a live integration, configure the app&apos;s public HTTPS address and
                    register that callback.
                  </p>
                )}
              </div>
            </details>
            {family.configured && (
              <Button asChild>
                <a href={`/api/oauth/${family.family}/start`}>Connect {family.name}</a>
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
