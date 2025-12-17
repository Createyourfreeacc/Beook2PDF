"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ProfileInfo = {
  id: string;
  label: string;
  selectable: boolean;
  reason?: string;
};

export default function ContentPage() {
  const [miscDecryptStatus, setMiscDecryptStatus] = useState<string | null>(null);
  const [beookDir, setBeookDir] = useState<string>("");
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [resolvedDbPath, setResolvedDbPath] = useState<string>("");
  const [resolvedImgPath, setResolvedImgPath] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load current config on mount
  useEffect(() => {
    loadConfigAndProfiles();
  }, []);

  async function loadConfigAndProfiles() {
    try {
      setLoading(true);
      const res = await fetch("/api/config");
      const data = await res.json();

      if (res.ok && data.success) {
        setBeookDir(data.config.beookDir || "");
        setSelectedProfile(data.config.selectedProfile || "1");
        setResolvedDbPath(data.resolved.dbPath);
        setResolvedImgPath(data.resolved.imgPath);

        // Load profiles based on the configured beookDir
        const profRes = await fetch("/api/profiles");
        const profData = await profRes.json();
        if (profRes.ok && profData.success) {
          setProfiles(profData.profiles || []);
        } else {
          setProfiles([]);
        }
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
        body: JSON.stringify({ beookDir, selectedProfile }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setMessage({ type: "success", text: data.message || "Config saved successfully" });
        setResolvedDbPath(data.resolved.dbPath);
        setResolvedImgPath(data.resolved.imgPath);

        // Refresh profiles after saving beookDir (in case it changed)
        const profRes = await fetch("/api/profiles");
        const profData = await profRes.json();
        if (profRes.ok && profData.success) {
          setProfiles(profData.profiles || []);
        } else {
          setProfiles([]);
        }
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
        setBeookDir(data.config.beookDir);
        setSelectedProfile(data.config.selectedProfile);
        setResolvedDbPath(data.resolved.dbPath);
        setResolvedImgPath(data.resolved.imgPath);
        setMessage({ type: "success", text: data.message || "Config reset to defaults" });

        const profRes = await fetch("/api/profiles");
        const profData = await profRes.json();
        if (profRes.ok && profData.success) {
          setProfiles(profData.profiles || []);
        } else {
          setProfiles([]);
        }
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
          <CardTitle>Beook Configuration</CardTitle>
          <CardDescription>
            Point to your Beook folder (not the SQLite file). You can use {"${username}"} as a placeholder for the current Windows username.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading configuration...</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="beookDir">Beook Folder</Label>
                <Input
                  id="beookDir"
                  value={beookDir}
                  onChange={(e) => setBeookDir(e.target.value)}
                  placeholder="C:/Users/${username}/AppData/Roaming/ionesoft/beook"
                  disabled={saving}
                />
                {resolvedDbPath && (
                  <p className="text-xs text-muted-foreground">
                    DB: <span className="font-mono">{resolvedDbPath}</span>
                  </p>
                )}
                {resolvedImgPath && (
                  <p className="text-xs text-muted-foreground">
                    Images: <span className="font-mono">{resolvedImgPath}</span>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Profile</Label>
                <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                  <SelectTrigger className="w-[260px]">
                    <SelectValue placeholder="Select a Profile" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Profiles</SelectLabel>
                      {(profiles.length ? profiles : [{ id: selectedProfile || "1", label: selectedProfile || "1", selectable: true }]).map((p) => (
                        <SelectItem key={p.id} value={p.id} disabled={!p.selectable}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Profile folder <span className="font-mono">0</span> is a dummy and ignored. Profiles with an empty <span className="font-mono">ZILPUSER</span> table are disabled.
                </p>
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
