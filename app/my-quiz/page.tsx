"use client";

import AddQuizQuestionForm from "@/components/add-quiz-question-form";
import QuestionsPanel from "@/components/question-panel";
import { useI18n } from "@/components/i18n-provider";

export default function MyQuiz() {
  const { t } = useI18n();
  return (
    <main className="container mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-6">{t("myQuiz.title")}</h1>
      <QuestionsPanel />
    </main>
  );
}
