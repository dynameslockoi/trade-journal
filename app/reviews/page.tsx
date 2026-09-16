"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { KEYS, loadDailyReview, loadWeeklyReview } from "@/lib/data";
import { invalidate, readCached } from "@/lib/query-cache";
import { PageHeader } from "@/components/page-header";
import { LoadError } from "@/components/load-error";
import { dayKey, myParts } from "@/lib/trading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DAILY_TEXT = [["what_went_well", "What went well?"], ["mistakes", "Biggest mistake?"], ["tomorrow_plan", "Tomorrow's plan"]] as const;
const WEEKLY_TEXT = [["summary", "What happened this week?"], ["lessons", "Key lessons / recurring patterns"], ["action_plan", "Action plan for next week"]] as const;

export default function Reviews() {
  // Today in Malaysia. Reading the UTC date instead would open the form on yesterday's date for the
  // first eight hours of every Malaysian morning.
  const today = dayKey(new Date());
  const monday = (() => {
    const parts = myParts(new Date())!;
    const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    return dayKey(new Date(Date.UTC(parts.year, parts.month - 1, parts.day - (day === 0 ? 6 : day - 1), 4)));
  })();

  const [d, setD] = useState(today);
  const [w, setW] = useState(monday);
  const [daily, setDaily] = useState<any>({ plan_followed: false, execution_score: 8, mood_score: 8, what_went_well: "", mistakes: "", tomorrow_plan: "" });
  const [weekly, setWeekly] = useState<any>({ summary: "", lessons: "", action_plan: "" });
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Cached per date, so stepping back to a day already opened is instant — and a save invalidates
      // the key it wrote, so the copy in the cache cannot outlive an edit.
      const [a, b] = await Promise.all([
        readCached(KEYS.dailyReview(d), () => loadDailyReview(d)),
        readCached(KEYS.weeklyReview(w), () => loadWeeklyReview(w)),
      ]);
      // Without this a failed read looks like an empty review and the next save would overwrite one.
      setLoadError(a.error ?? b.error ?? null);
      if (a.data) setDaily(a.data);
      if (b.data) setWeekly(b.data);
    })();
  }, [d, w]);

  const save = async (table: string, payload: any) => {
    const s = createClient();
    const { data: { user } } = await s.auth.getUser();
    if (!user) return;
    const { error } = await s.from(table).upsert({ user_id: user.id, ...payload }, { onConflict: table === "daily_reviews" ? "user_id,review_date" : "user_id,week_start" });
    if (error) toast.error(error.message);
    else {
      invalidate(table === "daily_reviews" ? KEYS.dailyReview(d) : KEYS.weeklyReview(w));
      toast.success("Saved successfully.");
    }
  };

  return <div className="content">
    <PageHeader title="Reviews" subtitle="Turn your trading history into repeatable improvements." />
    <LoadError message={loadError} what="this review" />
    <div className="grid two">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Daily Review</CardTitle>
          <div className="w-[190px]">
            <DatePicker value={d} onChange={setD} placeholder="Review date" label="Review date" />
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="review-label">
            <Checkbox id="rv-plan" checked={!!daily.plan_followed} onCheckedChange={v => setDaily({ ...daily, plan_followed: !!v })} />
            <Label htmlFor="rv-plan">I followed my plan</Label>
          </div>
          {([["execution_score", "Execution score"], ["mood_score", "Mood score"]] as const).map(([k, l]) => (
            <div className="form-field" key={k}>
              <Label htmlFor={`rv-${k}`}>{l}</Label>
              <Input id={`rv-${k}`} type="number" min="1" max="10" value={daily[k]} onChange={e => setDaily({ ...daily, [k]: Number(e.target.value) })} />
            </div>
          ))}
          {DAILY_TEXT.map(([k, l]) => (
            <div className="form-field" key={k}>
              <Label htmlFor={`rv-${k}`}>{l}</Label>
              <Textarea id={`rv-${k}`} rows={4} value={daily[k] || ""} onChange={e => setDaily({ ...daily, [k]: e.target.value })} />
            </div>
          ))}
          <Button type="button" onClick={() => save("daily_reviews", { ...daily, review_date: d })}>Save Daily Review</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Weekly Review</CardTitle>
          <div className="w-[190px]">
            <DatePicker value={w} onChange={setW} placeholder="Week start" label="Week start" />
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {WEEKLY_TEXT.map(([k, l]) => (
            <div className="form-field" key={k}>
              <Label htmlFor={`rv-${k}`}>{l}</Label>
              <Textarea id={`rv-${k}`} rows={7} value={weekly[k] || ""} onChange={e => setWeekly({ ...weekly, [k]: e.target.value })} />
            </div>
          ))}
          <Button type="button" onClick={() => save("weekly_reviews", { ...weekly, week_start: w })}>Save Weekly Review</Button>
        </CardContent>
      </Card>
    </div>
  </div>;
}
