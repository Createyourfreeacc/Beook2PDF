"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function ContentPage() {
  const [miscDecryptStatus, setMiscDecryptStatus] = useState<string | null>(null);

  async function runMiscDecrypt() {
    setMiscDecryptStatus("Running misc decryption...");
    try {
      const res = await fetch("/api/decrypt/misc");
      const data = await res.json();

      if (!res.ok || !data.ok) {
        console.error("Misc decrypt error:", data);
        setMiscDecryptStatus("Misc decrypt failed");
        return;
      }

      setMiscDecryptStatus(
        `Users: ${data.userDecryptedRows}/${data.userProcessedRows} | ` +
          `Properties: ${data.propertyDecryptedRows}/${data.propertyProcessedRows}`
      );
    } catch (err) {
      console.error(err);
      setMiscDecryptStatus("Misc decrypt error");
    }
  }

  return (
    <div className="space-y-4">
      <p>
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam sed ante
        cursus, feugiat libero id, efficitur leo. Honestly I should just add a
        manual install dir setting here.
      </p>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={runMiscDecrypt}>
          Decrypt misc data (users &amp; properties)
        </Button>

        {miscDecryptStatus && (
          <span className="text-xs text-muted-foreground">
            {miscDecryptStatus}
          </span>
        )}
      </div>
    </div>
  );
}
