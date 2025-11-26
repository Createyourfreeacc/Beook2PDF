"use client";

import { useEffect, useState } from "react";
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

type QuizAnswer = {
  id: number;
  number: number;
  text: string;
  isCorrect: boolean | null; // derived from ZCORRECT_DECRYPTED
};

type QuizQuestion = {
  id: number;
  ref: string | null;
  text: string;
  answers: QuizAnswer[];
};

type QuizChapter = {
  id: number;
  title: string;
  questions: QuizQuestion[];
};

type QuizBook = {
  id: number;
  title: string;
  ref: string | null;
  chapters: QuizChapter[];
};

type QuizResponse = {
  ok: boolean;
  books: QuizBook[];
};

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
          <TabsList className="flex flex-wrap w-full justify-start">
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
                            {chapter.questions.length !== 1 && "n"}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
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
