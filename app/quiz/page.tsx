"use client"

import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function ContentPage() {
  const [status, setStatus] = useState("Idle");

  async function handleClick() {
    setStatus("Processing...");
    try {
      const res = await fetch("/api/decryptquiz", { method: "GET" });
      const data = await res.json();

      setStatus(
        `Answers: ${data.answerDecryptedRows}/${data.answerProcessedRows} | ` +
        `Questions: ${data.questionDecryptedRows}/${data.questionProcessedRows}`
      );
    } catch (err) {
      setStatus("Error");
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 mt-10">
      <Button onClick={handleClick}>Decrypt Q/A</Button>
      <p>{status}</p>
    </div>
  );
}