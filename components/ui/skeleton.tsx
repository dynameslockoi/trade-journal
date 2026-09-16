import { cn } from "@/lib/utils";

/** Placeholder block used while a route's data is still loading. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-[var(--surface-3)]", className)}
      {...props}
    />
  );
}

export { Skeleton };
