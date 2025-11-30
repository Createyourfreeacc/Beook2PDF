"use client";

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { ChevronLeft, ChevronRight } from "lucide-react";

type QuizAnswer = {
  id: number;
  number: number;
  text: string;
  isCorrect: boolean | null;
};

type QuizAssetPage = {
  id: number;
  mediaType: string;
  dataUrl: string;
};

type QuizSharedAssetGroup = {
  id: number;
  questionNumbers: number[];   // 1-based indices in this chapter
  pages: QuizAssetPage[];      // the “4 pages” etc.
};

type QuizQuestion = {
  id: number;
  ref: string | null;
  text: string;
  answers: QuizAnswer[];
  assets?: QuizAssetPage[];    // question-specific assets (still under question)
};

type QuizChapter = {
  id: number;
  title: string;
  questions: QuizQuestion[];
  sharedAssets?: QuizSharedAssetGroup[]; // NEW
};

type QuizBook = {
  id: number;
  title: string;
  chapters: QuizChapter[];
};

function formatQuestionNumbers(nums: number[]): string {
  if (!nums.length) return "";
  const sorted = [...nums].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    if (start === prev) {
      ranges.push(`${start}`);
    } else {
      ranges.push(`${start}–${prev}`);
    }
    start = prev = n;
  }
  if (start === prev) {
    ranges.push(`${start}`);
  } else {
    ranges.push(`${start}–${prev}`);
  }
  return ranges.join(", ");
}

export default function QuizPage() {
  const [status, setStatus] = useState<string>("Idle");
  const [books, setBooks] = useState<QuizBook[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
  const [loadingQuiz, setLoadingQuiz] = useState<boolean>(false);
  const [showSolutions, setShowSolutions] = useState<boolean>(false);

  // userAnswers[questionId] = answerId | null
  const [userAnswers, setUserAnswers] = useState<
    Record<number, number | null>
  >({});

  const tabsScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateScrollIndicators() {
    const el = tabsScrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;

    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }

  function scrollTabsBy(delta: number) {
    const el = tabsScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: "smooth" });
  }

  // handle window resize once the component is mounted
  useEffect(() => {
    const onResize = () => updateScrollIndicators();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // re-evaluate scroll indicators whenever books or selected book change
  useEffect(() => {
    updateScrollIndicators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books.length, selectedBookId]);

  async function runDecrypt() {
    setStatus("Decrypting questions and answers...");
    try {
      const res = await fetch("/api/quiz/decrypt", { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus("Decrypt failed");
        return false;
      }
      setStatus(
        `Decrypted A: ${data.answerDecryptedRows}/${data.answerProcessedRows} | ` +
        `Q: ${data.questionDecryptedRows}/${data.questionProcessedRows}`
      );
      return true;
    } catch (err) {
      console.error(err);
      setStatus("Decrypt error");
      return false;
    }
  }

  async function loadQuiz() {
    setLoadingQuiz(true);
    try {
      const res = await fetch("/api/quiz/list");
      const data: QuizResponse = await res.json();
      if (!res.ok || !data.ok) {
        console.error("Quiz load error:", data);
        setLoadingQuiz(false);
        return;
      }
      setBooks(data.books);
      if (data.books.length > 0 && selectedBookId === null) {
        setSelectedBookId(data.books[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingQuiz(false);
    }
  }

  // Run decrypt + load quiz on first mount
  useEffect(() => {
    (async () => {
      const ok = await runDecrypt();
      if (ok) {
        await loadQuiz();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setAnswer(questionId: number, answerId: number | null) {
    // Do not allow changing answers while solutions are visible
    if (showSolutions) return;

    setUserAnswers((prev) => ({
      ...prev,
      [questionId]: answerId,
    }));
  }

  function isSelected(questionId: number, answerId: number) {
    const selected = userAnswers[questionId];
    return selected === answerId;
  }

  const selectedBook = books.find((b) => b.id === selectedBookId) ?? null;

  return (
    <div className="container mx-auto py-8 space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Beook Quiz</h1>
          <p className="text-sm text-muted-foreground">
            Questions are grouped by book and chapter. Answer them and then
            reveal the solutions to see what you got right.
          </p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          <div className="text-xs text-muted-foreground max-w-xs text-right">
            {status}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const ok = await runDecrypt();
                if (ok) await loadQuiz();
              }}
            >
              decrypt again
            </Button>
            <Button
              variant={showSolutions ? "secondary" : "default"}
              size="sm"
              onClick={() => {
                setShowSolutions((prev) => {
                  const next = !prev;

                  // When hiding solutions, reset all user choices
                  if (!next) {
                    setUserAnswers({});
                  }

                  return next;
                });
              }}
              disabled={books.length === 0}
            >
              {showSolutions ? "hide solution" : "show solution"}
            </Button>
          </div>
        </div>
      </header>

      <Separator />

      {loadingQuiz && (
        <p className="text-sm text-muted-foreground">
          loading quiz data...
        </p>
      )}

      {books.length === 0 && !loadingQuiz && (
        <p className="text-sm text-muted-foreground">
          No quiz content detected. Please verify that Beook is installed and
          the decrypted database contains question and answer data. Make sure
          to stop the Beook Application.
        </p>
      )}

      {books.length > 0 && (
        <Tabs
          value={selectedBookId?.toString() ?? undefined}
          onValueChange={(val) => setSelectedBookId(Number(val))}
          className="space-y-4"
        >
          {/* horizontally scrollable books bar with wheel + arrow support */}
          <div className="relative w-full rounded-md overflow-hidden">
            {/* left fade indicator */}
            {canScrollLeft && (
              <button
                type="button"
                className="scroll-indicator-left cursor-pointer select-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
                onClick={() => scrollTabsBy(-200)}
                aria-label="Scroll books left"
              >
                <ChevronLeft
                  className="h-4 w-4 text-foreground" // <— solid, no opacity
                  aria-hidden="true"
                  strokeWidth={3}
                />
              </button>
            )}

            {canScrollRight && (
              <button
                type="button"
                className="scroll-indicator-right cursor-pointer select-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
                onClick={() => scrollTabsBy(200)}
                aria-label="Scroll books right"
              >
                <ChevronRight
                  className="h-4 w-4 text-foreground" // or "text-white" if you want
                  aria-hidden="true"
                  strokeWidth={3}
                />
              </button>
            )}

            <div
              ref={tabsScrollRef}
              className="w-full overflow-x-auto overflow-y-hidden scrollbar-hide"
              onWheel={(e) => {
                if (e.deltaY === 0) return;
                e.preventDefault();
                e.currentTarget.scrollLeft += e.deltaY;
                updateScrollIndicators();
              }}
              onScroll={updateScrollIndicators}
            >
              <TabsList className="inline-flex min-w-max justify-start">
                {books.map((book) => (
                  <TabsTrigger
                    key={book.id}
                    value={book.id.toString()}
                    className="whitespace-nowrap"
                  >
                    {book.title}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>

          {books.map((book) => (
            <TabsContent
              key={book.id}
              value={book.id.toString()}
              className="space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">{book.title}</h2>
                {book.ref && (
                  <span className="text-xs text-muted-foreground">
                    Product: {book.ref}
                  </span>
                )}
              </div>

              {book.chapters.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No questions found for this book.
                </p>
              ) : (
                <Accordion type="multiple" className="space-y-2">
                  {book.chapters.map((chapter) => (
                    <AccordionItem
                      key={chapter.id}
                      value={chapter.id.toString()}
                      className="border rounded-lg"
                    >
                      <AccordionTrigger className="px-4">
                        <div className="flex flex-col items-start gap-1">
                          <span className="font-medium">
                            {chapter.title || "Chapter"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {chapter.questions.length} Question
                            {chapter.questions.length !== 1 && "s"}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        {chapter.sharedAssets && chapter.sharedAssets.length > 0 && (
                          <div className="mb-6 space-y-4">
                            {chapter.sharedAssets.map((group) => (
                              <div key={group.id} className="space-y-2">
                                <div className="space-y-2">
                                  {group.pages.map((page) =>
                                    page.mediaType.startsWith("image/") ? (
                                      <img
                                        key={page.id}
                                        src={page.dataUrl}
                                        alt="Kapitelbild"
                                        loading="lazy"
                                        className="w-full max-h-80 rounded-md border object-contain"
                                      />
                                    ) : null
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  This Material is relevant for Question{" "}
                                  {formatQuestionNumbers(group.questionNumbers)}.
                                </p>
                              </div>
                            ))}
                            <div className="border-b mb-4" />
                          </div>
                        )}
                        <div className="space-y-4">
                          {chapter.questions.map((q, idx) => (
                            <Card key={q.id}>
                              <CardHeader>
                                <CardTitle className="text-sm font-semibold">
                                  {idx + 1}.{" "}
                                  {q.text || "(Fragetext nicht verfügbar)"}
                                </CardTitle>
                                {q.ref && (
                                  <p className="text-xs text-muted-foreground">
                                    Ref: {q.ref}
                                  </p>
                                )}
                              </CardHeader>
                              <CardContent className="space-y-2">
                                {q.assets && q.assets.length > 0 && (
                                  <div className="space-y-2 mb-2">
                                    {q.assets.map((asset) =>
                                      asset.mediaType.startsWith("image/") ? (
                                        <img
                                          key={asset.id}
                                          src={asset.dataUrl}
                                          alt="Fragebild"
                                          loading="lazy"
                                          className="max-h-64 w-full rounded-md border object-contain"
                                        />
                                      ) : null
                                    )}
                                  </div>
                                )}

                                {q.answers.length === 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    No answer choices found.
                                  </p>
                                )}

                                {q.answers.length > 0 && (
                                  <RadioGroup
                                    value={
                                      userAnswers[q.id] != null
                                        ? String(userAnswers[q.id])
                                        : ""
                                    }
                                    onValueChange={(val) =>
                                      setAnswer(
                                        q.id,
                                        val ? Number(val) : null
                                      )
                                    }
                                    className="space-y-2"
                                  >
                                    {q.answers.map((a) => {
                                      const selected = isSelected(
                                        q.id,
                                        a.id
                                      );
                                      const isCorrect = a.isCorrect === true;

                                      let feedback: string | null = null;
                                      if (showSolutions) {
                                        if (isCorrect && selected) {
                                          feedback = "Correct!";
                                        } else if (isCorrect && !selected) {
                                          feedback =
                                            "Correct (not selected)";
                                        } else if (!isCorrect && selected) {
                                          feedback = "Wrong!";
                                        }
                                      }

                                      return (
                                        <div
                                          key={a.id}
                                          className="flex items-start gap-2 rounded-md border px-3 py-2"
                                        >
                                          <RadioGroupItem
                                            value={String(a.id)}
                                            id={`q${q.id}-a${a.id}`}
                                            className="mt-1"
                                          />
                                          <div className="flex-1 space-y-1">
                                            <label
                                              htmlFor={`q${q.id}-a${a.id}`}
                                              className="flex items-center gap-2 flex-wrap cursor-pointer"
                                            >
                                              <span className="text-sm">{a.text}</span>
                                              {showSolutions && (
                                                <>
                                                  {feedback && (
                                                    <Badge
                                                      variant="secondary"
                                                      className={`text-[10px] ${showSolutions && selected && isCorrect
                                                        ? "bg-green-400 text-black"
                                                        : showSolutions && selected && !isCorrect
                                                          ? "bg-red-400 text-black"
                                                          : ""
                                                        }`}
                                                    >
                                                      {feedback}
                                                    </Badge>
                                                  )}
                                                </>
                                              )}
                                            </label>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </RadioGroup>
                                )}
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
