"use client";

import { useEffect, useState, useMemo } from "react";
import { Task, TabType } from "./types";

const STORAGE_KEY = "saras_daily_planner_tasks";

export function getTodayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDueDateLabel(dueDateStr: string): string {
  const today = getTodayStr();
  const tomorrow = getTomorrowStr();

  if (dueDateStr === today) return "Today";
  if (dueDateStr === tomorrow) return "Tomorrow";

  try {
    const parts = dueDateStr.split("-").map(Number);
    if (parts.length === 3) {
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(d);
    }
  } catch {
    // fallback to string
  }
  return dueDateStr;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function useDailyPlanner() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("ongoing");
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load from localStorage safely
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const validTasks: Task[] = parsed.filter(
            (t) =>
              t &&
              typeof t.id === "string" &&
              typeof t.title === "string" &&
              typeof t.dueDate === "string" &&
              typeof t.completed === "boolean"
          );
          setTasks(validTasks);
        }
      }
    } catch (err) {
      console.error("Failed to parse daily planner tasks from localStorage", err);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Save to localStorage when tasks change
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (err) {
      console.error("Failed to save daily planner tasks to localStorage", err);
    }
  }, [tasks, loaded]);

  const todayStr = getTodayStr();

  // Dynamic status computation at render time
  const ongoingTasks = useMemo(
    () => tasks.filter((t) => !t.completed && t.dueDate >= todayStr),
    [tasks, todayStr]
  );

  const completedTasks = useMemo(
    () => tasks.filter((t) => t.completed),
    [tasks]
  );

  const missedTasks = useMemo(
    () => tasks.filter((t) => !t.completed && t.dueDate < todayStr),
    [tasks, todayStr]
  );

  const filteredTasks = useMemo(() => {
    if (activeTab === "completed") return completedTasks;
    if (activeTab === "missed") return missedTasks;
    return ongoingTasks;
  }, [activeTab, ongoingTasks, completedTasks, missedTasks]);

  const addTask = (title: string, dueDate: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !dueDate) return false;

    const newTask: Task = {
      id: generateId(),
      title: trimmedTitle,
      dueDate,
      completed: false,
    };

    setTasks((prev) => [newTask, ...prev]);
    return true;
  };

  const updateTask = (id: string, updates: { title: string; dueDate: string }) => {
    const trimmedTitle = updates.title.trim();
    if (!trimmedTitle || !updates.dueDate) return false;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, title: trimmedTitle, dueDate: updates.dueDate } : t
      )
    );
    return true;
  };

  const toggleComplete = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  return {
    tasks,
    filteredTasks,
    activeTab,
    setActiveTab,
    isCollapsed,
    setIsCollapsed,
    counts: {
      ongoing: ongoingTasks.length,
      completed: completedTasks.length,
      missed: missedTasks.length,
    },
    addTask,
    updateTask,
    toggleComplete,
    deleteTask,
    loaded,
  };
}
