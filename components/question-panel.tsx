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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type QuizRow = {
  id: number;
  question: string;
  correct_answer: string;
  wrong_answers: string; // JSON string
  created_at: string; // ISO or SQLite DATETIME
  has_asset?: number; // 0/1 from DB
  assetMimeType?: string | null;
  assetDataUrl?: string | null; // data:image/...;base64,...
  book_ref?: string | null;
  chapter_ref?: string | null;
};

type BookApiItem = {
  BookID: string;
  Titel: string[] | string;
  CourseName: string;
  Refrence: string;
  Issue: number[];
};

function getBookLabel(book: BookApiItem): string {
  if (Array.isArray(book.Titel)) {
    if (book.Titel.length > 0 && book.Titel[0]) return book.Titel[0] as string;
  } else if (book.Titel) {
    return book.Titel;
  }
  if (book.CourseName) return book.CourseName;
  if (book.Refrence) return book.Refrence;
  return `Book ${book.BookID}`;
}

export default function QuestionsPanel() {
  const [items, setItems] = React.useState<QuizRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState("");

  // new: sorting + filters
  const [sortOrder, setSortOrder] = React.useState<"newest" | "oldest">(
    "newest"
  );
  const [bookFilter, setBookFilter] = React.useState<string>("all"); // "all" | "none" | ref
  const [chapterFilter, setChapterFilter] = React.useState<string>("all"); // "all" | "none" | ref

  // new: book metadata for nicer labels
  const [books, setBooks] = React.useState<BookApiItem[]>([]);

  React.useEffect(() => {
    const loadBooks = async () => {
      try {
        const res = await fetch("/api/getBooks");
        if (!res.ok) return;
        const data = await res.json();
        setBooks((data?.booklist ?? []) as BookApiItem[]);
      } catch {
        // non-critical
      }
    };
    loadBooks();
  }, []);

  const bookByRef = React.useMemo(() => {
    const map = new Map<string, BookApiItem>();
    for (const b of books) {
      if (b.Refrence) {
        map.set(b.Refrence, b);
      }
    }
    return map;
  }, [books]);

  const bookLabelForRef = (ref: string | null | undefined): string => {
    if (!ref) return "None";
    const b = bookByRef.get(ref);
    if (b) return getBookLabel(b);
    return ref; // fallback to raw reference string
  };

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
      window.removeEventListener(
        "quiz:question-added",
        handler as EventListener
      );
  }, [load]);

  // Available filters based on current data
  const availableBookRefs = React.useMemo(() => {
    const set = new Set<string>();
    for (const row of items) {
      if (row.book_ref) set.add(row.book_ref);
    }
    return Array.from(set).sort();
  }, [items]);

  const availableChapterRefs = React.useMemo(() => {
    const set = new Set<string>();

    for (const row of items) {
      // respect current bookFilter when building chapter list
      const matchesBook =
        bookFilter === "all"
          ? true
          : bookFilter === "none"
          ? !row.book_ref
          : row.book_ref === bookFilter;

      if (!matchesBook) continue;
      if (!row.chapter_ref) continue;
      set.add(row.chapter_ref);
    }
    return Array.from(set).sort();
  }, [items, bookFilter]);

  const filtered = React.useMemo(() => {
    const key = filter.trim().toLowerCase();

    let list = items.filter((r) => {
      // text filter
      if (key) {
        const wrongs = safeParseArray(r.wrong_answers).join(" ");
        const text =
          r.question.toLowerCase() +
          " " +
          r.correct_answer.toLowerCase() +
          " " +
          wrongs.toLowerCase();
        if (!text.includes(key)) return false;
      }

      // book filter
      if (bookFilter === "none") {
        if (r.book_ref) return false;
      } else if (bookFilter !== "all") {
        if (r.book_ref !== bookFilter) return false;
      }

      // chapter filter
      if (chapterFilter === "none") {
        if (r.chapter_ref) return false;
      } else if (chapterFilter !== "all") {
        if (r.chapter_ref !== chapterFilter) return false;
      }

      return true;
    });

    // sort by created_at
    list = list.slice().sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      if (sortOrder === "newest") return db - da;
      return da - db;
    });

    return list;
  }, [items, filter, bookFilter, chapterFilter, sortOrder]);

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
      {/* Left: existing form */}
      <AddQuizQuestionForm />

      {/* Right: list + filters */}
      <Card className="min-h-[28rem]">
        <CardHeader className="space-y-3">
          {/* Search row (unchanged) */}
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
            <Button
              variant="outline"
              type="button"
              onClick={() => setFilter("")}
            >
              Clear
            </Button>
          </div>

          {/* NEW: book / chapter / sort controls */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Select
              value={bookFilter}
              onValueChange={(val) => {
                setBookFilter(val);
                setChapterFilter("all"); // reset chapter when book changes
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by book" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All books</SelectItem>
                <SelectItem value="none">Book: None</SelectItem>
                {availableBookRefs.map((ref) => (
                  <SelectItem key={ref} value={ref}>
                    {bookLabelForRef(ref)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={chapterFilter}
              onValueChange={setChapterFilter}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by chapter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All chapters</SelectItem>
                <SelectItem value="none">Chapter: None</SelectItem>
                {availableChapterRefs.map((ref) => (
                  <SelectItem key={ref} value={ref}>
                    Chapter {ref}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={sortOrder}
              onValueChange={(v: "newest" | "oldest") => setSortOrder(v)}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Sort by date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
              </SelectContent>
            </Select>
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
            <ScrollArea className="h-[39rem]">
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

                          {/* NEW: book / chapter info, but subtle */}
                          <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-2">
                            <span>
                              Book:{" "}
                              <span className="font-medium">
                                {bookLabelForRef(row.book_ref ?? null)}
                              </span>
                            </span>
                            <span>
                              · Chapter:{" "}
                              <span className="font-medium">
                                {row.chapter_ref ?? "None"}
                              </span>
                            </span>
                          </div>

                          <div className="mt-2 text-sm">
                            <div>
                              <span className="font-medium">Correct:</span>{" "}
                              <span className="text-muted-foreground">
                                {row.correct_answer}
                              </span>
                            </div>
                            <div className="mt-1">
                              <span className="font-medium">
                                Wrong ({wrongs.length}):
                              </span>{" "}
                              <span className="text-muted-foreground break-words">
                                {wrongs.join(" · ")}
                              </span>
                            </div>
                          </div>
                          {row.assetDataUrl && (
                            <div className="mt-3">
                              <img
                                src={row.assetDataUrl}
                                alt="Quiz asset"
                                loading="lazy"
                                className="max-h-64 w-full rounded-md border object-contain"
                              />
                            </div>
                          )}
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
