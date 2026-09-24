/** Shown while a signed-in page streams in: the shape of a feed, nothing that jumps. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl animate-pulse" aria-busy aria-label="Loading">
      <div className="mb-6 h-4 w-40 rounded bg-muted" />
      <div className="grid gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="grid gap-3 rounded-xl border p-4">
            <div className="h-4 w-2/3 rounded bg-muted" />
            <div className="h-3 w-1/3 rounded bg-muted" />
            <div className="h-24 rounded-lg bg-muted/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
