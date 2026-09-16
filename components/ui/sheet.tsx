"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn("dialog-overlay", "data-[state=open]:animate-in data-[state=open]:fade-in-0", className)}
      {...props}
    />
  );
}

/** A dialog anchored to an edge. Only `left` is used in the app (the phone's navigation drawer). */
function SheetContent({
  className,
  children,
  side = "left",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "left" | "right" | "top" | "bottom";
}) {
  const anchored: Record<string, string> = {
    left: "sheet-content inset-0 auto 0 0 data-[state=open]:slide-in-from-left",
    right: "sheet-content inset-0 0 0 auto data-[state=open]:slide-in-from-right",
    top: "sheet-content inset-x-0 top-0 bottom-auto w-full data-[state=open]:slide-in-from-top",
    bottom: "sheet-content inset-x-0 bottom-0 top-auto w-full data-[state=open]:slide-in-from-bottom",
  };
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(anchored[side], "data-[state=open]:animate-in", className)}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("sheet-header", className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("settings-actions", className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("day-modal-date", className)} {...props} />;
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("muted", className)} {...props} />;
}

function SheetCloseButton({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return (
    <SheetPrimitive.Close className={cn("icon-btn", className)} aria-label="Close" {...props}>
      <X size={16} />
    </SheetPrimitive.Close>
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetCloseButton,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetPortal,
  SheetOverlay,
};
