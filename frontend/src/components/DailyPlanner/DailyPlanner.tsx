"use client";

import { useState, useEffect } from "react";
import { Task } from "./types";
import {
  useDailyPlanner,
  getTodayStr,
  formatDueDateLabel,
} from "./useDailyPlanner";

export default function DailyPlanner() {
  const {
    filteredTasks,
    activeTab,
    setActiveTab,
    isCollapsed,
    setIsCollapsed,
    counts,
    addTask,
    updateTask,
    toggleComplete,
    deleteTask,
    loaded,
  } = useDailyPlanner();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const [formTitle, setFormTitle] = useState("");
  const [formDueDate, setFormDueDate] = useState(getTodayStr());
  const [formError, setFormError] = useState("");

  const handleOpenAddModal = () => {
    setEditingTask(null);
    setFormTitle("");
    setFormDueDate(getTodayStr());
    setFormError("");
    setModalOpen(true);
  };

  const handleOpenEditModal = (task: Task) => {
    setEditingTask(task);
    setFormTitle(task.title);
    setFormDueDate(task.dueDate);
    setFormError("");
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingTask(null);
    setFormError("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setFormError("Task title is required.");
      return;
    }
    if (!formDueDate) {
      setFormError("Due date is required.");
      return;
    }

    if (editingTask) {
      const success = updateTask(editingTask.id, {
        title: formTitle,
        dueDate: formDueDate,
      });
      if (success) handleCloseModal();
    } else {
      const success = addTask(formTitle, formDueDate);
      if (success) handleCloseModal();
    }
  };

  const handleDelete = () => {
    if (!editingTask) return;
    if (confirm("Are you sure you want to delete this task?")) {
      deleteTask(editingTask.id);
      handleCloseModal();
    }
  };

  // Keyboard shortcut ESC to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && modalOpen) {
        handleCloseModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen]);

  if (!loaded) {
    return (
      <div className="w-full rounded-xl border border-neutral-800 bg-[#121214] p-3.5 text-neutral-400">
        <p className="text-xs font-mono">Loading Daily Planner…</p>
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-neutral-800 bg-[#121214] p-3.5 sm:p-4 text-neutral-100 shadow-sm">
      {/* Compact Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-600/20 border border-blue-500/30 text-blue-400">
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </div>
          <h2 className="text-xs font-semibold tracking-tight text-white uppercase font-mono">
            Daily Planner
          </h2>
        </div>

        <button
          onClick={handleOpenAddModal}
          aria-label="Add task"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-700 bg-neutral-800/80 text-neutral-300 transition-colors hover:border-blue-500 hover:bg-blue-600 hover:text-white"
          title="Add new task"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      </div>

      {/* Compact Tabs */}
      <div className="flex items-center gap-1 border-b border-neutral-800/80 pb-2 mb-2 overflow-x-auto">
        <TabButton
          label="Ongoing"
          count={counts.ongoing}
          active={activeTab === "ongoing"}
          onClick={() => setActiveTab("ongoing")}
        />
        <TabButton
          label="Completed"
          count={counts.completed}
          active={activeTab === "completed"}
          onClick={() => setActiveTab("completed")}
        />
        <TabButton
          label="Missed"
          count={counts.missed}
          active={activeTab === "missed"}
          onClick={() => setActiveTab("missed")}
          isMissed={counts.missed > 0}
        />
      </div>

      {/* MY TASKS Section Header */}
      <div className="flex items-center justify-between py-1 mb-0.5">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-400 hover:text-neutral-200 transition-colors"
          aria-expanded={!isCollapsed}
          aria-label="Toggle task list visibility"
        >
          <svg
            className={`h-3 w-3 transition-transform duration-200 ${
              isCollapsed ? "" : "rotate-90"
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span>MY TASKS</span>
        </button>

        <span className="rounded-full bg-neutral-800/90 border border-neutral-700/60 px-1.5 py-0.2 font-mono text-[9px] text-neutral-400">
          {filteredTasks.length}
        </span>
      </div>

      {/* Task List Content */}
      {!isCollapsed && (
        <div className="space-y-1">
          {filteredTasks.length === 0 ? (
            <div className="py-3.5 text-center text-xs text-neutral-500 italic border border-dashed border-neutral-800/80 rounded-lg my-1.5">
              {activeTab === "ongoing" && "No ongoing tasks"}
              {activeTab === "completed" && "No completed tasks yet"}
              {activeTab === "missed" && "No missed tasks"}
            </div>
          ) : (
            filteredTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={() => toggleComplete(task.id)}
                onEdit={() => handleOpenEditModal(task)}
              />
            ))
          )}

          {/* Add Task Button */}
          <button
            onClick={handleOpenAddModal}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-800 bg-neutral-900/40 py-1.5 text-xs font-medium text-neutral-400 transition-all hover:border-blue-500/60 hover:bg-blue-600/10 hover:text-blue-400 active:scale-[0.99]"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add tasks
          </button>
        </div>
      )}

      {/* Modal Dialog for Add / Edit */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-[#18181c] p-5 shadow-2xl text-neutral-100">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-neutral-800">
              <h3 className="text-sm font-semibold text-white">
                {editingTask ? "Edit Task" : "Add New Task"}
              </h3>
              <button
                onClick={handleCloseModal}
                className="text-neutral-400 hover:text-white text-xs p-1 rounded-md"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">
                  Task Title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Revise Computer Networks Chapter 3"
                  className="w-full rounded-lg border border-neutral-700 bg-[#121214] px-3 py-2 text-xs text-white placeholder-neutral-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">
                  Due Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                  className="w-full rounded-lg border border-neutral-700 bg-[#121214] px-3 py-2 text-xs text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {formError && (
                <p className="text-xs text-red-400 font-medium">{formError}</p>
              )}

              <div className="flex items-center justify-between pt-2.5 border-t border-neutral-800">
                {editingTask ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="flex items-center gap-1 rounded-lg border border-red-900/40 bg-red-950/30 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/60 hover:text-white transition-colors"
                  >
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                    Delete
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors shadow-sm"
                  >
                    {editingTask ? "Save" : "Save Task"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  label,
  count,
  active,
  onClick,
  isMissed,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  isMissed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all ${
        active
          ? "bg-blue-600 text-white font-medium shadow-xs"
          : "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200"
      }`}
    >
      <span>{label}</span>
      <span
        className={`rounded-full px-1.5 py-0.2 text-[9px] font-mono ${
          active
            ? "bg-white/20 text-white"
            : isMissed
            ? "bg-red-950/60 text-red-400 border border-red-900/50"
            : "bg-neutral-800 text-neutral-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function TaskRow({
  task,
  onToggle,
  onEdit,
}: {
  task: Task;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const dateLabel = formatDueDateLabel(task.dueDate);
  const isToday = dateLabel === "Today";
  const isTomorrow = dateLabel === "Tomorrow";

  return (
    <div className="group flex items-center justify-between gap-2.5 rounded-lg border border-neutral-800/70 bg-[#161618] px-2.5 py-1.5 transition-all hover:border-neutral-700 hover:bg-[#1a1a1d]">
      {/* Checkbox & Title */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          aria-label={
            task.completed ? "Mark task incomplete" : "Mark task complete"
          }
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ${
            task.completed
              ? "border-blue-500 bg-blue-600 text-white"
              : "border-neutral-500 hover:border-blue-400 bg-transparent"
          }`}
        >
          {task.completed && (
            <svg
              className="h-2.5 w-2.5 stroke-[3]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
        </button>

        <span
          className={`text-xs min-w-0 flex-1 leading-snug break-words ${
            task.completed
              ? "line-through text-neutral-500"
              : "text-neutral-200"
          }`}
        >
          {task.title}
        </span>
      </div>

      {/* Date Label & Edit Action */}
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-medium ${
            task.completed
              ? "bg-neutral-800/40 text-neutral-500"
              : isToday
              ? "bg-blue-950/70 text-blue-400 border border-blue-800/40"
              : isTomorrow
              ? "bg-purple-950/70 text-purple-400 border border-purple-800/40"
              : "bg-neutral-800/60 text-neutral-400"
          }`}
        >
          {dateLabel}
        </span>

        <button
          onClick={onEdit}
          aria-label="Edit task"
          title="Edit task"
          className="p-1 rounded text-neutral-500 opacity-0 group-hover:opacity-100 hover:bg-neutral-800 hover:text-white transition-all"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

