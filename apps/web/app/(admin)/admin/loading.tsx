/** Admin pages stream in behind a table-shaped skeleton. */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy aria-label="Loading">
      <div className="mb-2 h-6 w-48 rounded bg-muted" />
      <div className="mb-6 h-3 w-96 max-w-full rounded bg-muted" />
      <div className="grid gap-2 rounded-xl border p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem_6rem] gap-3">
            <div className="h-4 rounded bg-muted" />
            <div className="h-4 rounded bg-muted/70" />
            <div className="h-4 rounded bg-muted/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
