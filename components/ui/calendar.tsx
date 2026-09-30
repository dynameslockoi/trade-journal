"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { cn } from "@/lib/utils";

/**
 * The month grid behind every date field. react-day-picker brings its own stylesheet, but it is
 * unlayered — and an unlayered rule outranks everything inside the app's `@layer components`, so the
 * grid came out at the library's 44px defaults with none of the app's palette. Attaching the app's
 * own class names and styling them in globals.css keeps the calendar on the same tokens as the rest
 * of the UI, with no ordering question to get wrong.
 */

/**
 * react-day-picker formats its labels through `formatters`. The journal already reads the market in
 * Malaysian terms — ringgit, the KL session clock, zakat — so the grid names its days the same way
 * the trading week is spoken through the rest of the app's vocabulary (`Okt` also keeps the caption
 * short enough that two dropdowns and both chevrons fit on one row).
 */
const WEEKDAY_NAMES = ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"];
const MONTH_NAMES = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];

/**
 * The dropdowns need explicit bounds. Left to itself react-day-picker offers a century of years and
 * stops at the end of the current one, which hides December from a trade dated ahead of expiry. A
 * journal never reaches further back than an imported history could, so 2000 onwards, plus a few
 * years of headroom.
 */
const START_MONTH = new Date(2000, 0, 1);
const YEARS_AHEAD = 5;

export function Calendar({ className, ...props }: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays
      weekStartsOn={1}
      /**
       * Month and year as dropdowns, and `navLayout="around"` to pull the two chevrons into the
       * caption's own row. The default layout renders the nav as an absolutely positioned overlay
       * whose buttons land underneath the caption: the caption paints later, so it swallowed every
       * pointer event aimed at ‹ and › and the month could not be changed by mouse at all. `around`
       * places the buttons in the flow, so there is nothing left for the caption to cover.
       */
      captionLayout="dropdown"
      navLayout="around"
      startMonth={START_MONTH}
      endMonth={new Date(new Date().getFullYear() + YEARS_AHEAD, 11, 31)}
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
        dropdowns: "pick-dropdowns",
        dropdown: "pick-dropdown",
        dropdown_root: "pick-dropdown-root",
        months_dropdown: "pick-dropdown-months",
        years_dropdown: "pick-dropdown-years",
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
      formatters={{
        formatWeekdayName: day => WEEKDAY_NAMES[day.getDay()],
        formatMonthDropdown: date => MONTH_NAMES[date.getMonth()],
      }}
      components={{
        // `orientation` is "down" inside the dropdowns, where the chevron is a 13px hint beside the
        // caption; the nav's own chevrons carry the row and stay a size larger. The library's `size`
        // and `disabled` are dropped in favour of those two sizes.
        Chevron: ({ orientation, disabled, size, ...rest }) =>
          orientation === "down" ? (
            <ChevronDown {...rest} size={13} aria-hidden />
          ) : orientation === "left" ? (
            <ChevronLeft {...rest} size={16} aria-hidden />
          ) : (
            <ChevronRight {...rest} size={16} aria-hidden />
          ),
      }}
      {...props}
    />
  );
}
