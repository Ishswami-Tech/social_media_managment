export function PageHeader({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  /** Small mono label above the title, e.g. a date or section name. */
  eyebrow?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 font-mono text-[12px] tracking-wide text-muted-foreground uppercase">{eyebrow}</div>}
        <h1 className="font-display text-[32px] leading-[1.1] font-semibold tracking-tight md:text-[40px]">{title}</h1>
        {description && <p className="mt-2 max-w-[62ch] text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
