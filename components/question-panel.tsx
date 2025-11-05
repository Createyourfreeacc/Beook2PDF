"use client";

import * as React from "react";
import AddQuizQuestionForm from "@/components/add-quiz-question-form";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type QuizRow = {
  id: number;
  question: string;
  correct_answer: string;
  wrong_answers: string; // JSON string
  created_at: string; // ISO or SQLite DATETIME
};

export default function QuestionsPanel() {
  const [items, setItems] = React.useState<QuizRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/quiz/postQuestion", { method: "GET" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const data = (await res.json()) as { rows: QuizRow[] };
      setItems(data.rows);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load questions");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // Listen for a custom event fired by the form when a question is added
  React.useEffect(() => {
    const handler = () => load();
    window.addEventListener("quiz:question-added", handler as EventListener);
    return () =>
      window.removeEventListener("quiz:question-added", handler as EventListener);
  }, [load]);

  const filtered = React.useMemo(() => {
    const key = filter.trim().toLowerCase();
    if (!key) return items;
    return items.filter((r) => {
      const wrongs = safeParseArray(r.wrong_answers).join(" ");
      return (
        r.question.toLowerCase().includes(key) ||
        r.correct_answer.toLowerCase().includes(key) ||
        wrongs.toLowerCase().includes(key)
      );
    });
  }, [items, filter]);

  async function handleDelete(id: number) {
    try {
      const res = await fetch(`/api/quiz/postQuestion?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Delete failed");
      }
      toast.info("Question removed");
      // Optimistic update
      setItems((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      toast.error(err?.message || "Could not delete question");
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Left: your existing form */}
      <AddQuizQuestionForm />

      {/* Right: list + filter */}
      <Card className="min-h-[28rem]">
        <CardHeader className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="q-filter">Search</Label>
              <Input
                id="q-filter"
                placeholder="Filter by text…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={() => setFilter("")}>
              Clear
            </Button>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              {items.length === 0
                ? "No questions yet. Add your first one on the left."
                : "No results for your filter."}
            </div>
          ) : (
            <ScrollArea className="h-[24rem]">
              <ul className="divide-y">
                {filtered.map((row) => {
                  const wrongs = safeParseArray(row.wrong_answers);
                  return (
                    <li key={row.id} className="p-4 group">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium break-words">
                              {row.question}
                            </p>
                            <Badge variant="secondary" className="shrink-0">
                              {formatDate(row.created_at)}
                            </Badge>
                          </div>

                          <div className="mt-2 text-sm">
                            <div>
                              <span className="font-medium">Correct:</span>{" "}
                              <span className="text-muted-foreground">
                                {row.correct_answer}
                              </span>
                            </div>
                            <div className="mt-1">
                              <span className="font-medium">Wrong ({wrongs.length}):</span>{" "}
                              <span className="text-muted-foreground break-words">
                                {wrongs.join(" · ")}
                              </span>
                            </div>
                          </div>
                        </div>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="shrink-0 opacity-80 group-hover:opacity-100"
                            >
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete this question?
                              </AlertDialogTitle>
                            </AlertDialogHeader>
                            <p className="text-sm text-muted-foreground">
                              This action cannot be undone.
                            </p>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => handleDelete(row.id)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function safeParseArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function formatDate(v: string) {
  const d = new Date(v);
  // Fallback: if SQLite DATETIME comes as local-ish string, this still renders nicely
  return isNaN(d.getTime()) ? v : d.toLocaleString();
}
