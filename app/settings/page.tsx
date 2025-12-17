"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function ContentPage() {
  const [miscDecryptStatus, setMiscDecryptStatus] = useState<string | null>(null);
  const [dbPath, setDbPath] = useState<string>("");
  const [imgPath, setImgPath] = useState<string>("");
  const [resolvedDbPath, setResolvedDbPath] = useState<string>("");
  const [resolvedImgPath, setResolvedImgPath] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load current config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      setLoading(true);
      const res = await fetch("/api/config");
      const data = await res.json();

      if (res.ok && data.success) {
        setDbPath(data.config.dbPath);
        setImgPath(data.config.imgPath);
        setResolvedDbPath(data.resolved.dbPath);
        setResolvedImgPath(data.resolved.imgPath);
      } else {
        setMessage({ type: "error", text: "Failed to load config" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Error loading config" });
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    try {
      setSaving(true);
      setMessage(null);
      
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dbPath, imgPath }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setMessage({ type: "success", text: data.message || "Config saved successfully" });
        setResolvedDbPath(data.resolved.dbPath);
        setResolvedImgPath(data.resolved.imgPath);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save config" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Error saving config" });
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    try {
      setSaving(true);
      setMessage(null);
      
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setDbPath(data.config.dbPath);
        setImgPath(data.config.imgPath);
        setResolvedDbPath(data.resolved.dbPath);
        setResolvedImgPath(data.resolved.imgPath);
        setMessage({ type: "success", text: data.message || "Config reset to defaults" });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset config" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Error resetting config" });
    } finally {
      setSaving(false);
    }
  }

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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Path Configuration</CardTitle>
          <CardDescription>
            Configure the database and image paths used by the application. You can use {"${username}"} as a placeholder for the current Windows username.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading configuration...</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="dbPath">Database Path</Label>
                <Input
                  id="dbPath"
                  value={dbPath}
                  onChange={(e) => setDbPath(e.target.value)}
                  placeholder="C:/Users/${username}/AppData/Roaming/..."
                  disabled={saving}
                />
                {resolvedDbPath && (
                  <p className="text-xs text-muted-foreground">
                    Resolved: <span className="font-mono">{resolvedDbPath}</span>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="imgPath">Image Path</Label>
                <Input
                  id="imgPath"
                  value={imgPath}
                  onChange={(e) => setImgPath(e.target.value)}
                  placeholder="C:/Users/${username}/AppData/Roaming/..."
                  disabled={saving}
                />
                {resolvedImgPath && (
                  <p className="text-xs text-muted-foreground">
                    Resolved: <span className="font-mono">{resolvedImgPath}</span>
                  </p>
                )}
              </div>

              {message && (
                <div
                  className={`text-sm p-3 rounded-md ${
                    message.type === "success"
                      ? "bg-green-50 dark:bg-green-950 text-green-900 dark:text-green-100"
                      : "bg-red-50 dark:bg-red-950 text-red-900 dark:text-red-100"
                  }`}
                >
                  {message.text}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button onClick={saveConfig} disabled={saving || loading}>
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetToDefault}
                  disabled={saving || loading}
                >
                  Reset to Default
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Misc Decryption</CardTitle>
          <CardDescription>
            Decrypt user and property data from the database.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
