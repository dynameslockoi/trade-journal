"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  HOURS,
  MINUTES,
  dateLabel,
  dateTimeLabel,
  joinDateTime,
  parseISODate,
  splitDateTime,
  toISODate,
  today,
  wallClock,
} from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * The trigger wears the same classes as the Radix select button, so a date field, a dropdown and a
 * text input are the same object on screen. Radix sets `data-state="open"` on it, which is what
 * rotates the caret and paints the accent ring while the panel is up.
 */
function Trigger({
  id,
  text,
  placeholder,
  ariaLabel,
}: {
  id?: string;
  text: string;
  placeholder: string;
  ariaLabel?: string;
}) {
  return (
    <PopoverTrigger asChild>
      <button type="button" id={id} className="select-btn picker-trigger" aria-label={ariaLabel}>
        <span className="picker-value">
          <CalendarDays size={14} aria-hidden className="picker-icon" />
          <span className={cn("picker-text", !text && "picker-empty")}>{text || placeholder}</span>
        </span>
        <ChevronDown className="select-caret" size={15} aria-hidden />
      </button>
    </PopoverTrigger>
  );
}

function TimeSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="picker-time-btn">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A date in a popover. The value is the `"YYYY-MM-DD"` string the forms already store and Supabase
 * already holds — the picker only changes how it is entered, not what is saved.
 */
export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "Any date",
  clearable = true,
  label,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
  /** Named for screen readers when no visible `<Label htmlFor>` points at the trigger. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseISODate(value);

  const pick = (date: Date | undefined) => {
    if (!date) return;
    onChange(toISODate(date));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Trigger id={id} text={dateLabel(value)} placeholder={placeholder} ariaLabel={label} />
      <PopoverContent align="start" className="picker-panel">
        <Calendar mode="single" selected={selected} defaultMonth={selected ?? today()} onSelect={pick} />
        <div className="picker-foot">
          <button type="button" className="picker-action" onClick={() => pick(today())}>
            Today
          </button>
          {clearable && (
            <button
              type="button"
              className="picker-action"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A date and a time in one popover, for the entry and exit stamps. The panel stays open while the
 * hour and minute are chosen, so a trade can be logged in one pass.
 */
export function DateTimePicker({
  id,
  value,
  onChange,
  placeholder = "Set date & time",
  label,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const { date, time } = splitDateTime(value);
  const selected = parseISODate(date);
  const [hour, minute] = time.split(":");

  const setPart = (part: "hour" | "minute", v: string) =>
    onChange(joinDateTime(date, part === "hour" ? `${v}:${minute}` : `${hour}:${v}`));

  // "Now" in Malaysia, so it lands on the same clock the journal reads the entry stamp in.
  const now = () => {
    const { date: d, time: t } = wallClock(new Date());
    onChange(`${d}T${t}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Trigger id={id} text={dateTimeLabel(value)} placeholder={placeholder} ariaLabel={label} />
      <PopoverContent align="start" className="picker-panel">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? today()}
          onSelect={d => d && onChange(joinDateTime(toISODate(d), time))}
        />
        <div className="picker-time">
          <Label htmlFor={`${id}-hour`}>Time</Label>
          <div className="picker-time-row">
            <TimeSelect value={hour} options={HOURS} onChange={v => setPart("hour", v)} label="Hour" />
            <span className="picker-time-sep">:</span>
            <TimeSelect value={minute} options={MINUTES} onChange={v => setPart("minute", v)} label="Minute" />
          </div>
        </div>
        <div className="picker-foot">
          <button type="button" className="picker-action" onClick={now}>
            Now
          </button>
          <button
            type="button"
            className="picker-action"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            Clear
          </button>
          <button type="button" className="picker-action picker-done" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
