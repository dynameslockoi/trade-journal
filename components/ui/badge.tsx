import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("badge", {
  variants: {
    variant: {
      default: "",
      outline: "bg-transparent",
      positive: "positive bg-transparent",
      negative: "negative bg-transparent",
      /** An IPO allocation keeps its spreadsheet's yellow, in both themes. */
      ipo: "badge-ipo",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
