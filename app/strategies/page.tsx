"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";

type Strategy = { id: string; name: string; description: string | null; rules: string | null };
const blank = { name: "", description: "", rules: "" };

export default function Strategies() {
  const [items, setItems] = useState<Strategy[]>([]);
  const [open, setOpen] = useState(false);
  // The id being edited, or null when the form is creating a new strategy.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");
  const formCard = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data } = await createClient().from("strategies").select("*").order("name");
    setItems((data ?? []) as Strategy[]);
  };
  useEffect(() => { load(); }, []);
  // Opening the form (new or edit) brings it into view, since it sits above the cards.
  useEffect(() => { if (open) formCard.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [open]);

  const set = (k: keyof typeof blank, v: string) => setForm(x => ({ ...x, [k]: v }));
  const close = () => { setOpen(false); setEditing(null); setForm(blank); setError(""); };
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
    const { data: { user } } = await s.auth.getUser();
    if (!user) { setError("Please sign in again."); return; }
    const payload = { name: form.name.trim(), description: form.description, rules: form.rules };
    if (!payload.name) { setError("Enter a strategy name."); return; }
    const { error: writeError } = editing
      ? await s.from("strategies").update(payload).eq("id", editing)
      : await s.from("strategies").insert({ user_id: user.id, ...payload });
    if (writeError) setError(writeError.message);
    else { close(); load(); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this strategy? Existing trades will remain.")) return;
    const { error: deleteError } = await createClient().from("strategies").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    else load();
  }

  return <div className="content">
    <PageHeader title="Strategy Library" subtitle="Define setups and measure real performance."
      actions={<button className="btn btn-primary" onClick={() => { setError(""); setEditing(null); setForm(blank); setOpen(true); }}>+ New Strategy</button>} />
    {error && <div className="error">{error}</div>}
    {open && <div className="card card-pad" ref={formCard}>
      <h3 style={{ marginTop: 0 }}>{editing ? "Edit Strategy" : "New Strategy"}</h3>
      <form onSubmit={save} className="grid" style={{ gap: 12 }}>
        <label className="field">Name<input className="input" required value={form.name} onChange={e => set("name", e.target.value)} /></label>
        <label className="field">Description<textarea className="input" rows={2} value={form.description} onChange={e => set("description", e.target.value)} /></label>
        <label className="field">Rules / Checklist<textarea className="input" rows={5} value={form.rules} onChange={e => set("rules", e.target.value)} /></label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button className="btn btn-primary">{editing ? "Save Changes" : "Save Strategy"}</button>
        </div>
      </form>
    </div>}
    <div className="grid three">
      {items.map(s => <div className="card card-pad" key={s.id}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{s.name}</h3>
          <div style={{ display: "flex", gap: 8, flex: "none", alignSelf: "flex-start" }}>
            <button className="btn" onClick={() => startEdit(s)}>Edit</button>
            <button className="btn danger-btn" onClick={() => remove(s.id)}>Delete</button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>{s.description || "No description."}</p>
        <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)", whiteSpace: "pre-wrap", fontSize: 13 }}>{s.rules || "No rules defined."}</div>
      </div>)}
    </div>
    {!items.length && <div className="card card-pad empty">No strategies yet. Create your first setup.</div>}
  </div>;
}
