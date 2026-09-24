"use client";

/**
 * Route-level error boundary for the signed-in app: the shell stays, the
 * failing page is replaced by a plain explanation and a retry.
 */
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server logs carry the full stack; the digest ties the two together.
    console.error("page failed", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto grid max-w-md gap-4 py-16 text-center">
      <AlertTriangle className="mx-auto size-8 text-amber-500" aria-hidden />
      <h1 className="text-xl font-semibold">This page hit a problem</h1>
      <p className="text-sm text-muted-foreground">
        Nothing you did was lost. Try again; if it keeps happening, the reference below helps whoever looks into it.
      </p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">{error.digest}</p>}
      <div className="flex justify-center gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/home">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
