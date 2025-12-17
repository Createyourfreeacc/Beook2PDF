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
import { useI18n } from "@/components/i18n-provider";

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

type ChaptersByBookRef = {
  [bookRef: string]: {
    [chapterRef: string]: string;
  };
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
  const { t } = useI18n();
  const [items, setItems] = React.useState<QuizRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState("");

  // new: sorting + filters
  const [sortOrder, setSortOrder] = React.useState<"newest" | "oldest">(
    "newest"
  );
  const [bookFilter, setBookFilter] = React.useState<string>("all"); // "all" | "none" | ref
  const [chapterFilter, setChapterFilter] = React.useState<string>("all"); // "all" | "none" | ref

  // book metadata for nicer labels
  const [books, setBooks] = React.useState<BookApiItem[]>([]);

  // chapter titles per book_ref / chapter_ref, used for nicer labels
  const [chaptersByBookRef, setChaptersByBookRef] =
    React.useState<ChaptersByBookRef>({});

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

  React.useEffect(() => {
    const loadChaptersForBooks = async () => {
      if (!books || books.length === 0) return;

      const updates: ChaptersByBookRef = {};

      for (const b of books) {
        const ref = b.Refrence;
        if (!ref) continue;
        if (chaptersByBookRef[ref]) continue; // already loaded

        try {
          const params = new URLSearchParams({ bookRef: ref });
          const res = await fetch(`/api/getChapters?${params.toString()}`);
          if (!res.ok) continue;
          const data = await res.json();
          const list = (data?.chapters ?? []) as { ref: string; title: string }[];

          const byChapter: { [chapterRef: string]: string } = {};
          for (const c of list) {
            if (c.ref) {
              byChapter[c.ref] = c.title || c.ref;
            }
          }

          if (Object.keys(byChapter).length > 0) {
            updates[ref] = byChapter;
          }
        } catch {
          // non-critical: we just fall back to raw chapter_ref later
        }
      }

      if (Object.keys(updates).length > 0) {
        setChaptersByBookRef((prev) => ({ ...prev, ...updates }));
      }
    };

    loadChaptersForBooks();
  }, [books, chaptersByBookRef]);

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

  const chapterLabelForRef = (
    chapterRef: string | null | undefined,
    bookRefHint?: string | null
  ): string => {
    if (!chapterRef) return "None";

    // Prefer lookup with the provided bookRef
    if (bookRefHint && chaptersByBookRef[bookRefHint]) {
      const byChapter = chaptersByBookRef[bookRefHint];
      if (byChapter && byChapter[chapterRef]) {
        return byChapter[chapterRef];
      }
    }

    // Fallback: search all known books for this chapterRef
    for (const [bookRef, byChapter] of Object.entries(chaptersByBookRef)) {
      if (byChapter && byChapter[chapterRef]) {
        return byChapter[chapterRef];
      }
    }

    // Last resort: show the raw DB value
    return chapterRef;
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
      // Important: we only expose concrete chapter values once a specific
      // book has been chosen. When the book filter is "all", no chapters
      // are collected here so you cannot select a chapter without a book.
      const matchesBook =
        bookFilter === "all"
          ? false
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
      toast.info(t("questionsPanel.questionRemoved"));
      // Optimistic update
      setItems((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      toast.error(err?.message || t("questionsPanel.couldNotDelete"));
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
              <Label htmlFor="q-filter">{t("questionsPanel.search")}</Label>
              <Input
                id="q-filter"
                placeholder={t("questionsPanel.filterPlaceholder")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              type="button"
              onClick={() => setFilter("")}
            >
              {t("common.clear")}
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
                <SelectValue placeholder={t("common.book")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("questionsPanel.allBooks")}</SelectItem>
                <SelectItem value="none">{t("questionsPanel.bookNone")}</SelectItem>
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
                <SelectValue placeholder={t("common.chapter")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("questionsPanel.allChapters")}</SelectItem>
                <SelectItem value="none">{t("questionsPanel.chapterNone")}</SelectItem>
                {availableChapterRefs.map((ref) => (
                  <SelectItem key={ref} value={ref}>
                    {chapterLabelForRef(
                      ref,
                      bookFilter === "all" || bookFilter === "none" ? undefined : bookFilter
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={sortOrder}
              onValueChange={(v: "newest" | "oldest") => setSortOrder(v)}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">{t("questionsPanel.newestFirst")}</SelectItem>
                <SelectItem value="oldest">{t("questionsPanel.oldestFirst")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              {items.length === 0
                ? t("questionsPanel.noQuestionsYet")
                : t("questionsPanel.noResults")}
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
                              {t("common.book")}:{" "}
                              <span className="font-medium">
                                {bookLabelForRef(row.book_ref ?? null)}
                              </span>
                            </span>
                            <span>
                              · {t("common.chapter")}:{" "}
                              <span className="font-medium">
                                {chapterLabelForRef(
                                  row.chapter_ref ?? null,
                                  row.book_ref ?? null
                                )}
                              </span>
                            </span>
                          </div>

                          <div className="mt-2 text-sm">
                            <div>
                              <span className="font-medium">{t("common.correct")}:</span>{" "}
                              <span className="text-muted-foreground">
                                {row.correct_answer}
                              </span>
                            </div>
                            <div className="mt-1">
                              <span className="font-medium">
                                {t("common.wrong")} ({wrongs.length}):
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
                              {t("questionsPanel.deleteButton")}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t("questionsPanel.deleteTitle")}
                              </AlertDialogTitle>
                            </AlertDialogHeader>
                            <p className="text-sm text-muted-foreground">
                              {t("questionsPanel.deleteWarning")}
                            </p>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => handleDelete(row.id)}
                              >
                                {t("common.delete")}
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
