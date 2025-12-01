"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Plus, Trash, ImageIcon } from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type AssetState =
  | {
    base64: string;
    mime: string;
    name: string;
  }
  | null;

type BookApiItem = {
  BookID: string; // ZILPCOURSEDEF.Z_PK as string
  Titel: string[] | string;
  CourseName: string;
  Refrence: string; // this is the one we care about (e.g. 978-3-905036-95-4)
  Issue: number[];
};

type ChapterApiItem = {
  chapterId: number;
  title: string;
  ref: string;
  issueId: string | null;
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

export default function AddQuizQuestionForm() {
  const [question, setQuestion] = useState("");
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [wrongAnswers, setWrongAnswers] = useState<string[]>(["", "", ""]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [books, setBooks] = useState<BookApiItem[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [booksError, setBooksError] = useState<string | null>(null);

  // selectedBookRef is either "none" or the actual Refrence string
  const [selectedBookRef, setSelectedBookRef] = useState<string>("none");

  // Chapters for the currently selected book
  const [chapters, setChapters] = useState<ChapterApiItem[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chaptersError, setChaptersError] = useState<string | null>(null);

  // Selected chapter reference (ZPRODUCTREFERENCE) or "none"
  const [selectedChapter, setSelectedChapter] = useState<string>("none");

  // Optional asset
  const [asset, setAsset] = useState<AssetState>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const loadBooks = async () => {
      try {
        setBooksLoading(true);
        setBooksError(null);
        const res = await fetch("/api/getBooks");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        const list = (data?.booklist ?? []) as BookApiItem[];
        setBooks(list);
      } catch (err: any) {
        console.error("Failed to fetch books:", err);
        setBooksError("Could not load books.");
      } finally {
        setBooksLoading(false);
      }
    };
    loadBooks();
  }, []);

  useEffect(() => {
    // Whenever the selected book changes, load its chapters from the DB.
    // If no book is selected ("none"), chapters stay empty and the chapter
    // dropdown is effectively disabled.
    if (!selectedBookRef || selectedBookRef === "none") {
      setChapters([]);
      setChaptersError(null);
      setChaptersLoading(false);
      // Also reset any previously selected chapter
      setSelectedChapter("none");
      return;
    }

    let cancelled = false;

    const loadChapters = async () => {
      try {
        setChaptersLoading(true);
        setChaptersError(null);

        const params = new URLSearchParams({ bookRef: selectedBookRef });
        const res = await fetch(`/api/getChapters?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();

        if (!data?.success) {
          throw new Error(data?.error || "Failed to load chapters");
        }

        const list = (data.chapters ?? []) as ChapterApiItem[];
        if (!cancelled) {
          setChapters(list);
          // If the currently selected chapter is not part of this book anymore,
          // reset it back to "none".
          if (
            selectedChapter !== "none" &&
            !list.some((c) => c.ref === selectedChapter)
          ) {
            setSelectedChapter("none");
          }
        }
      } catch (err: any) {
        console.error("Failed to fetch chapters:", err);
        if (!cancelled) {
          setChapters([]);
          setChaptersError("Could not load chapters.");
        }
      } finally {
        if (!cancelled) {
          setChaptersLoading(false);
        }
      }
    };

    loadChapters();

    return () => {
      cancelled = true;
    };
  }, [selectedBookRef, selectedChapter]);

  const addWrongAnswer = () => {
    if (wrongAnswers.length < 30) setWrongAnswers((prev) => [...prev, ""]);
  };

  const removeWrongAnswer = (index: number) => {
    if (wrongAnswers.length > 3) {
      setWrongAnswers((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleChangeWrongAnswer = (index: number, value: string) => {
    setWrongAnswers((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  const handleAssetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setMessage("");

    if (!file) {
      setAsset(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setMessage("Only image files are supported at the moment.");
      setAsset(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        const base64 = result.includes(",") ? result.split(",")[1] ?? "" : result;
        setAsset({
          base64,
          mime: file.type,
          name: file.name,
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const trimmedWrong = wrongAnswers
      .map((w) => w.trim())
      .filter((w) => w.length > 0);

    if (trimmedWrong.length < 3) {
      setLoading(false);
      setMessage("Please provide at least 3 wrong answers.");
      return;
    }

    if (trimmedWrong.length > 30) {
      setLoading(false);
      setMessage("Too many wrong answers (max 30).");
      return;
    }

    // "none" means no reference -> null in DB
    const bookRefValue =
      selectedBookRef && selectedBookRef !== "none"
        ? selectedBookRef
        : null;

    // "none" means no chapter -> null in DB
    const chapterRefValue =
      selectedChapter && selectedChapter !== "none"
        ? selectedChapter
        : null;

    try {
      const payload = {
        question: question.trim(),
        correctAnswer: correctAnswer.trim(),
        wrongAnswers: trimmedWrong,
        assetBase64: asset?.base64 ?? null,
        assetMime: asset?.mime ?? null,
        assetName: asset?.name ?? null,
        bookRef: bookRefValue,      // already there
        chapterRef: chapterRefValue // NEW
      };

      const res = await fetch("/api/quiz/postQuestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      setLoading(false);

      if (res.ok) {
        setMessage("Question added successfully!");
        setQuestion("");
        setCorrectAnswer("");
        setWrongAnswers(["", "", ""]);
        setSelectedBookRef("none");
        setSelectedChapter("none");
        setAsset(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }

        window.dispatchEvent(new CustomEvent("quiz:question-added"));
      } else {
        setMessage(`Error: ${data.error ?? "Unknown error"}`);
      }
    } catch (err: any) {
      console.error(err);
      setLoading(false);
      setMessage("Unexpected error while saving the question.");
    }
  };

  return (
    <Card className="h-fit-[28rem]">
      <CardHeader>
        <CardTitle>Add custom quiz</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Book / chapter assignment */}
          <div className="space-y-2">
            <Label className="text-sm">Assign</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
              {/* BOOK SELECT (optional, uses reference string) */}
              <div>
                <Label className="text-xs text-muted-foreground">
                  Book
                </Label>
                <Select
                  value={selectedBookRef}
                  onValueChange={(value) => {
                    setSelectedBookRef(value);
                    // Reset chapter whenever the book changes so we don't mix chapters from different books.
                    setSelectedChapter("none");
                  }}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue
                      placeholder={
                        booksLoading
                          ? "Loading books..."
                          : "Select a book (optional)"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {books.map((b) => (
                      <SelectItem key={b.BookID} value={b.Refrence}>
                        {getBookLabel(b)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {booksError && (
                  <p className="text-[11px] text-destructive mt-1">
                    {booksError}
                  </p>
                )}
              </div>

              {/* CHAPTER SELECT (driven by real chapters for the chosen book) */}
              <div>
                <Label className="text-xs text-muted-foreground">
                  Chapter
                </Label>
                <Select
                  value={selectedChapter}
                  onValueChange={setSelectedChapter}
                  disabled={
                    !selectedBookRef ||
                    selectedBookRef === "none" ||
                    chaptersLoading
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue
                      placeholder={
                        !selectedBookRef || selectedBookRef === "none"
                          ? "Select a book first"
                          : chaptersLoading
                            ? "Loading chapters..."
                            : "Select a chapter (optional)"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {chapters.map((c) => (
                      <SelectItem
                        key={c.ref || String(c.chapterId)}
                        value={c.ref}
                      >
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chaptersError && selectedBookRef !== "none" && (
                  <p className="text-[11px] text-destructive mt-1">
                    {chaptersError}
                  </p>
                )}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Assigning a book is optional. If you choose &quot;None&quot;,
              the question will not be linked.
            </p>
          </div>

          <div>
            <Label>Question</Label>
            <div className="flex items-center gap-2 mt-2">
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <Label>Correct answer</Label>
            <div className="flex items-center gap-2 mt-2">
              <Input
                value={correctAnswer}
                onChange={(e) => setCorrectAnswer(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <Label>Wrong answers</Label>
            <p className="text-xs text-muted-foreground">
              At least 3 wrong answers are required, up to 30.
            </p>
            <div className="space-y-2 mt-2">
              {wrongAnswers.map((answer, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={answer}
                    onChange={(e) =>
                      handleChangeWrongAnswer(i, e.target.value)
                    }
                    required={i < 3}
                    placeholder={`Wrong answer ${i + 1}`}
                  />
                  {wrongAnswers.length > 3 && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      onClick={() => removeWrongAnswer(i)}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {wrongAnswers.length < 30 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={addWrongAnswer}
                >
                  <Plus className="h-4 w-4 mr-2" /> Add additional wrong answer
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Image</Label>

            <div
              className="mt-1 h-32 md:h-40 border-2 border-dashed rounded-md flex flex-col items-center justify-center cursor-pointer hover:bg-muted/40 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon className="h-8 w-8 mb-2 opacity-60" />
              <p className="text-xs text-muted-foreground">
                Click to choose an image (optional)
              </p>
              {asset && (
                <p className="mt-2 text-[11px] text-muted-foreground text-center">
                  Selected: <span className="font-mono">{asset.name}</span>
                </p>
              )}
            </div>

            {/* Hidden real input */}
            <Input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAssetChange}
              className="hidden"
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Saving..." : "Save Question"}
          </Button>

          {message && (
            <p className="text-center mt-2 text-sm text-muted-foreground">
              {message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
