"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { cn } from "@/lib/utils";

/**
 * The month grid behind every date field. react-day-picker brings its own stylesheet, but it is
 * unlayered — and an unlayered rule outranks everything inside the app's `@layer components`, so the
 * grid came out at the library's 44px defaults with none of the app's palette. Attaching the app's
 * own class names and styling them in globals.css keeps the calendar on the same tokens as the rest
 * of the UI, with no ordering question to get wrong.
 */
export function Calendar({ className, ...props }: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays
      weekStartsOn={1}
      className={cn("app-calendar", className)}
      // `pick-` rather than `cal-`: the P&L calendar page already owns a `.cal-nav`, and a shared
      // name would have styled the month grid with the year strip's rules.
      classNames={{
        months: "pick-months",
        month: "pick-month",
        nav: "pick-nav",
        button_previous: "pick-nav-btn pick-nav-prev",
        button_next: "pick-nav-btn pick-nav-next",
        chevron: "pick-chevron",
        month_caption: "pick-caption",
        caption_label: "pick-caption-label",
        month_grid: "pick-grid",
        weekdays: "pick-weekdays",
        weekday: "pick-weekday",
        weeks: "pick-weeks",
        week: "pick-week",
        day: "pick-day",
        day_button: "pick-day-btn",
        today: "pick-day-today",
        selected: "pick-day-selected",
        outside: "pick-day-outside",
        disabled: "pick-day-disabled",
        hidden: "pick-hidden",
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === "left" ? (
            <ChevronLeft size={15} aria-hidden {...rest} />
          ) : (
            <ChevronRight size={15} aria-hidden {...rest} />
          ),
      }}
      {...props}
    />
  );
}
