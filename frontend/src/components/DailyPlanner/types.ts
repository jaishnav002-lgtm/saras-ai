export type Task = {
  id: string;
  title: string;
  dueDate: string; // YYYY-MM-DD format (local date)
  completed: boolean;
};

export type TabType = "ongoing" | "completed" | "missed";
