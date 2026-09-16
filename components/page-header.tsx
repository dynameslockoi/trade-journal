/**
 * Gives a title the two-tone treatment: the last word carries the accent colour, so a multi-word
 * title reads as one phrase rather than a label. A single-word title is left alone — accenting the
 * only word would just be a whole heading in colour — and a node title (the trade page's symbol
 * plus its IPO badge) is passed through untouched, since there is nothing to split.
 *
 * Exported so the auth pages can give their heading the same treatment as a page header.
 */
export function accentTitle(title: React.ReactNode) {
  if (typeof title !== "string") return title;
  const cut = title.lastIndexOf(" ");
  if (cut <= 0) return title;
  return (
    <>
      {title.slice(0, cut + 1)}
      <span className="page-head-accent">{title.slice(cut + 1)}</span>
    </>
  );
}

/**
 * One header for every page: consistent title scale, optional eyebrow above it and action buttons
 * that wrap under the title on narrow screens instead of squeezing it.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  /** A node so a title can carry a badge beside it (an IPO allocation, for instance). */
  title: React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <div className="page-head-row">
        <div className="page-head-text">
          <h1>{accentTitle(title)}</h1>
          {subtitle && <div className="muted page-head-sub">{subtitle}</div>}
        </div>
        {actions && <div className="page-head-actions">{actions}</div>}
      </div>
    </header>
  );
}
