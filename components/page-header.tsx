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
          <h1>{title}</h1>
          {subtitle && <div className="muted page-head-sub">{subtitle}</div>}
        </div>
        {actions && <div className="page-head-actions">{actions}</div>}
      </div>
    </header>
  );
}
