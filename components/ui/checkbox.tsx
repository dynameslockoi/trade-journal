"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The mark fills most of the 17px control: at 12px with a 3 stroke it sat small and thin inside the
 * box, which read as an empty square at a glance. 14px on a 3.5 stroke is unmistakably a tick.
 */
const mark = { size: 14, strokeWidth: 3.5, absoluteStrokeWidth: false } as const;

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root data-slot="checkbox" className={cn("checkbox-control", className)} {...props}>
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="checkbox-indicator">
        {props.checked === "indeterminate" ? <Minus {...mark} /> : <Check {...mark} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
