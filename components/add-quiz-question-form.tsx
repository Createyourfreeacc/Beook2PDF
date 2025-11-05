"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Plus, Trash } from "lucide-react";

export default function AddQuizQuestionForm() {
    const [question, setQuestion] = useState("");
    const [correctAnswer, setCorrectAnswer] = useState("");
    const [wrongAnswers, setWrongAnswers] = useState(["", "", ""]); // start with 3 required
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");

    const addWrongAnswer = () => {
        if (wrongAnswers.length < 30) setWrongAnswers([...wrongAnswers, ""]);
    };

    const removeWrongAnswer = (index: number) => {
        if (wrongAnswers.length > 3) {
            setWrongAnswers(wrongAnswers.filter((_, i) => i !== index));
        }
    };

    const handleChangeWrongAnswer = (index: number, value: string) => {
        const updated = [...wrongAnswers];
        updated[index] = value;
        setWrongAnswers(updated);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage("");

        const res = await fetch("/api/quiz/addQuestion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question, correctAnswer, wrongAnswers }),
        });

        const data = await res.json();
        setLoading(false);

        if (res.ok) {
            setMessage("Question added successfully!");
            setQuestion("");
            setCorrectAnswer("");
            setWrongAnswers(["", "", ""]);
        } else {
            setMessage(`Error: ${data.error}`);
        }
    };

    return (
        <Card className="max-w-xl mx-auto mt-6 p-4 shadow-lg rounded-2xl">
            <CardHeader>
                <CardTitle>Add your own quiz question</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <Label>Question</Label>
                        <div className="flex items-center gap-2 mt-2">
                            <Input value={question} onChange={(e) => setQuestion(e.target.value)} required />
                        </div>
                    </div>
                    <div>
                        <Label>Correct answer</Label>
                        <div className="flex items-center gap-2 mt-2">
                            <Input value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} required />
                        </div>
                    </div>

                    <div>
                        <Label>Wrong answers</Label>
                        {wrongAnswers.map((ans, i) => (
                            <div key={i} className="flex items-center gap-2 mt-2">
                                <Input
                                    value={ans}
                                    onChange={(e) => handleChangeWrongAnswer(i, e.target.value)}
                                    required={i < 3}
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

                    <Button type="submit" disabled={loading} className="w-full">
                        {loading ? "Saving..." : "Save Question"}
                    </Button>

                    {message && <p className="text-center mt-2">{message}</p>}
                </form>
            </CardContent>
        </Card>
    );
}
