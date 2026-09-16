import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea data-slot="textarea" className={cn("input min-h-24 resize-y", className)} {...props} />
  );
}

export { Textarea };
