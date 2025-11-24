import AddQuizQuestionForm from "@/components/add-quiz-question-form";
import QuestionsPanel from "@/components/question-panel";

export default function MyQuiz() {
  return (
    <main className="container mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-6">My Quiz</h1>
      <QuestionsPanel />
    </main>
  );
}