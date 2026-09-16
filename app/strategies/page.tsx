"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";
import { ConfirmButton } from "@/components/confirm-button";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Strategy = { id: string; name: string; description: string | null; rules: string | null };
type Tag = { id: string; name: string; category: string | null };

const blank = { name: "", description: "", rules: "" };

/** The categories a tag can belong to; the order the groups are listed in. */
const TAG_CATEGORIES = ["setup", "mistake", "condition", "custom"] as const;
const TAG_HINTS: Record<string, string> = {
  setup: "How you entered — breakout, pullback, IPO flip.",
  mistake: "What went wrong — chased it, moved my stop.",
  condition: "The market you traded in — trending, choppy, news day.",
  custom: "Anything else worth filtering on.",
};

/**
 * Strategies and tags are both small label lists — a setup you trade, a label you stick on a trade —
 * so they share one page behind tabs instead of sitting in the sidebar as two destinations. Each tab
 * owns its own controls, and the lists are independent: one page, two jobs.
 */
export default function StrategiesAndTags() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tab, setTab] = useState("strategies");
  const [open, setOpen] = useState(false);
  // The id being edited, or null when the form is creating a new strategy.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tagName, setTagName] = useState("");
  const [tagCategory, setTagCategory] = useState<string>("setup");
  const formCard = useRef<HTMLDivElement>(null);

  const loadStrategies = async () => {
    const { data, error } = await createClient().from("strategies").select("*").order("name");
    if (error) setLoadError(error.message);
    setStrategies((data ?? []) as Strategy[]);
  };
  const loadTags = async () => {
    const { data, error } = await createClient().from("tags").select("*").order("category").order("name");
    if (error) setLoadError(error.message);
    setTags((data ?? []) as Tag[]);
  };
  useEffect(() => {
    loadStrategies();
    loadTags();
  }, []);
  // Opening the form (new or edit) brings it into view, since it sits above the cards.
  useEffect(() => {
    if (open) formCard.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  const set = (k: keyof typeof blank, v: string) => setForm(x => ({ ...x, [k]: v }));
  const close = () => {
    setOpen(false);
    setEditing(null);
    setForm(blank);
    setError("");
  };
  const startEdit = (s: Strategy) => {
    setError("");
    setEditing(s.id);
    setForm({ name: s.name, description: s.description ?? "", rules: s.rules ?? "" });
    setOpen(true);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const s = createClient();
    const {
      data: { user },
    } = await s.auth.getUser();
    if (!user) {
      setError("Please sign in again.");
      return;
    }
    const payload = { name: form.name.trim(), description: form.description, rules: form.rules };
    if (!payload.name) {
      setError("Enter a strategy name.");
      return;
    }
    const { error: writeError } = editing
      ? await s.from("strategies").update(payload).eq("id", editing)
      : await s.from("strategies").insert({ user_id: user.id, ...payload });
    if (writeError) setError(writeError.message);
    else {
      close();
      loadStrategies();
    }
  }

  async function remove(id: string) {
    const { error: deleteError } = await createClient().from("strategies").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    else loadStrategies();
  }

  async function addTag(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const name = tagName.trim();
    if (!name) return;
    const s = createClient();
    const {
      data: { user },
    } = await s.auth.getUser();
    if (!user) {
      setError("Please sign in again.");
      return;
    }
    const { error: writeError } = await s.from("tags").insert({ user_id: user.id, name, category: tagCategory });
    if (writeError) setError(writeError.message);
    else {
      setTagName("");
      loadTags();
    }
  }

  async function removeTag(id: string) {
    const { error: deleteError } = await createClient().from("tags").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    else loadTags();
  }

  // Tags read better grouped: a flat pile of thirty chips says nothing about how they are used.
  const groups = useMemo(
    () =>
      TAG_CATEGORIES.map(category => [category, tags.filter(t => (t.category ?? "custom") === category)] as const).filter(
        ([, list]) => list.length > 0,
      ),
    [tags],
  );

  return (
    <div className="content">
      <PageHeader
        title="Strategies & Tags"
        subtitle="The setups you trade and the labels you stick on them — one page, two lists."
      />
      <LoadError message={loadError} what="your strategies and tags" />
      {error && <Alert variant="error">{error}</Alert>}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="tabs-bar">
          <TabsList>
            <TabsTrigger value="strategies">
              Strategies <span className="tabs-count">{strategies.length}</span>
            </TabsTrigger>
            <TabsTrigger value="tags">
              Tags <span className="tabs-count">{tags.length}</span>
            </TabsTrigger>
          </TabsList>
          <div className="tabs-actions">
            {tab === "strategies" && (
              <Button
                onClick={() => {
                  setError("");
                  setEditing(null);
                  setForm(blank);
                  setOpen(true);
                }}
              >
                + New Strategy
              </Button>
            )}
          </div>
        </div>

        <TabsContent value="strategies" className="grid">
          {open && (
            <Card ref={formCard}>
              <CardHeader>
                <CardTitle>{editing ? "Edit Strategy" : "New Strategy"}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={save} className="grid gap-3">
                  <div className="form-field">
                    <Label htmlFor="st-name">Name</Label>
                    <Input id="st-name" required value={form.name} onChange={e => set("name", e.target.value)} />
                  </div>
                  <div className="form-field">
                    <Label htmlFor="st-desc">Description</Label>
                    <Textarea id="st-desc" rows={2} value={form.description} onChange={e => set("description", e.target.value)} />
                  </div>
                  <div className="form-field">
                    <Label htmlFor="st-rules">Rules / Checklist</Label>
                    <Textarea id="st-rules" rows={5} value={form.rules} onChange={e => set("rules", e.target.value)} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={close}>
                      Cancel
                    </Button>
                    <Button>{editing ? "Save Changes" : "Save Strategy"}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
          <div className="grid three">
            {strategies.map(s => (
              <Card key={s.id}>
                <CardContent>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{s.name}</CardTitle>
                    <div className="flex flex-none gap-2 self-start">
                      <Button variant="secondary" size="sm" onClick={() => startEdit(s)}>
                        Edit
                      </Button>
                      <ConfirmButton
                        size="sm"
                        title={`Delete ${s.name}?`}
                        description="Existing trades keep their record and stay in the journal."
                        onConfirm={() => remove(s.id)}
                      >
                        Delete
                      </ConfirmButton>
                    </div>
                  </div>
                  <p className="muted text-[12px] mt-4 mb-0">{s.description || "No description."}</p>
                  <div className="pt-2.5 mt-2.5 border-t border-[var(--border)] whitespace-pre-wrap text-[12px]">
                    {s.rules || "No rules defined."}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {!strategies.length && (
            <Card>
              <CardContent className="empty">No strategies yet. Create your first setup.</CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="tags" className="grid">
          <Card>
            <CardContent>
              <div className="card-head">
                <div>
                  <b>Your tags</b>
                  <div className="muted card-hint">
                    These are the labels the trade forms and the journal's filter offer.
                  </div>
                </div>
                <Badge>{tags.length} tags</Badge>
              </div>
              {/* The creator lives with the list it feeds, so the tab strip stays a tab strip. */}
              <form onSubmit={addTag} className="tag-add">
                <Input
                  className="min-w-[150px] flex-1"
                  placeholder="New tag name"
                  required
                  value={tagName}
                  onChange={e => setTagName(e.target.value)}
                  aria-label="Tag name"
                />
                <Select value={tagCategory} onValueChange={setTagCategory}>
                  <SelectTrigger className="w-[150px]" aria-label="Tag category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAG_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button>Add</Button>
              </form>
              {groups.length ? (
                <div className="tag-groups">
                  {groups.map(([category, list]) => (
                    <div className="tag-group" key={category}>
                      <div className="tag-group-head">
                        <b>{category}</b>
                        <span className="muted">{TAG_HINTS[category]}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {list.map(t => (
                          <span className="tag-chip" key={t.id}>
                            {t.name}
                            <button type="button" onClick={() => removeTag(t.id)} aria-label={`Delete ${t.name}`}>
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">No tags yet. Add one above — “breakout”, “chased it”, “news day”.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
