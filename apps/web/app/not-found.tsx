import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md content-center gap-4 py-16 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">There is nothing at this address</h1>
      <p className="text-sm text-muted-foreground">The link may be old, or the post it pointed to was removed.</p>
      <div className="flex justify-center">
        <Button asChild>
          <Link href="/home">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
