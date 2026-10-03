"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import DailyPlanner from "@/components/DailyPlanner/DailyPlanner";
import { Subject, createSubject, listSubjects, ApiError } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    setLoading(true);
    listSubjects()
      .then(setSubjects)
      .catch(() => setError("Could not load subjects"))
      .finally(() => setLoading(false));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await createSubject(name, description);
      setName("");
      setDescription("");
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create subject");
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-neutral-500">Your subjects and study materials</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
          + Create Subject
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card p-4 mb-8 max-w-md space-y-3">
          <div>
            <label className="block text-xs uppercase tracking-wide mb-1">Subject name</label>
            <input
              className="input-field"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Computer Networks"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide mb-1">
              Description (optional)
            </label>
            <input
              className="input-field"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? "Creating…" : "Create"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-sm border border-black bg-neutral-50 px-3 py-2 mb-6 max-w-md">{error}</p>}

      <div className="mb-8 max-w-2xl">
        <DailyPlanner />
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading subjects…</p>
      ) : subjects.length === 0 ? (
        <div className="card p-8 text-center text-neutral-500 max-w-md">
          <p className="mb-2">No subjects yet.</p>
          <p className="text-sm">Create your first subject to start uploading materials.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {subjects.map((s) => (
            <button
              key={s.id}
              onClick={() => router.push(`/subjects/${s.id}`)}
              className="card p-4 text-left hover:bg-neutral-50 transition-colors"
            >
              <h3 className="font-semibold mb-1">{s.name}</h3>
              {s.description && (
                <p className="text-sm text-neutral-500 mb-3 line-clamp-2">{s.description}</p>
              )}
              <div className="flex items-center justify-between text-xs text-neutral-500 mt-4 pt-3 border-t border-black">
                <span>{s.document_count} document{s.document_count === 1 ? "" : "s"}</span>
                <span>
                  {s.last_activity
                    ? new Date(s.last_activity).toLocaleDateString()
                    : "No activity"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </AppShell>
  );
}
