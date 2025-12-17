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

type Profile = {
  id: string;
  name: string;
};

export default function ContentPage() {
  const [miscDecryptStatus, setMiscDecryptStatus] = useState<string | null>(null);
  const [beookPath, setBeookPath] = useState<string>("");
  const [profileId, setProfileId] = useState<string>("1");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [resolvedDbPath, setResolvedDbPath] = useState<string>("");
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
        const cfgBeookPath = String(data.config.beookPath ?? "");
        const cfgProfileId = String(data.config.profileId ?? "1");

        setBeookPath(cfgBeookPath);
        setProfileId(cfgProfileId);
        setResolvedDbPath(data.resolved.dbPath);
        await loadProfiles(cfgBeookPath, cfgProfileId);
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

  async function loadProfiles(cfgBeookPath?: string, cfgProfileId?: string) {
    try {
      const res = await fetch("/api/profiles");
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.profiles)) {
        const nextProfiles: Profile[] = data.profiles;
        setProfiles(nextProfiles);

        // Self-heal: if the currently selected profile is not a "real" profile (e.g. empty ZILPUSER),
        // pick the first available profile (prefer "1") and persist it.
        const current = String(cfgProfileId ?? profileId ?? "1");
        if (nextProfiles.length > 0 && !nextProfiles.some((p) => p.id === current)) {
          const fallback = nextProfiles.find((p) => p.id === "1")?.id ?? nextProfiles[0].id;
          setProfileId(fallback);

          const bp = String(cfgBeookPath ?? beookPath ?? "").trim();
          if (bp) {
            try {
              const saveRes = await fetch("/api/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ beookPath: bp, profileId: fallback }),
              });
              const saveData = await saveRes.json();
              if (saveRes.ok && saveData.success) {
                setResolvedDbPath(saveData.resolved.dbPath);
              }
            } catch (e) {
              console.error("Failed to persist fallback profile:", e);
            }
          }
        }
      } else {
        setProfiles([]);
      }
    } catch (err) {
      console.error(err);
      setProfiles([]);
    }
  }

  async function saveConfig() {
    try {
      setSaving(true);
      setMessage(null);
      
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beookPath, profileId }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setMessage({ type: "success", text: data.message || "Config saved successfully" });
        setResolvedDbPath(data.resolved.dbPath);
        await loadProfiles(beookPath, profileId);
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
        setBeookPath(data.config.beookPath);
        setProfileId(String(data.config.profileId ?? "1"));
        setResolvedDbPath(data.resolved.dbPath);
        setMessage({ type: "success", text: data.message || "Config reset to defaults" });
        await loadProfiles(data.config.beookPath, String(data.config.profileId ?? "1"));
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
            Point to your Beook base folder (you can use {"${username}"} as a placeholder). The app resolves the SQLite DB and assets from it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading configuration...</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="beookPath">Beook Folder</Label>
                <Input
                  id="beookPath"
                  value={beookPath}
                  onChange={(e) => setBeookPath(e.target.value)}
                  placeholder="C:/Users/${username}/AppData/Roaming/ionesoft/beook"
                  disabled={saving}
                />
              </div>

              <div className="space-y-2">
                <Label>Profile</Label>
                <Select
                  value={profileId}
                  onValueChange={(v) => setProfileId(v)}
                  disabled={saving || loading || profiles.length === 0}
                >
                  <SelectTrigger className="w-[260px]">
                    <SelectValue placeholder="Select a Profile" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Profiles</SelectLabel>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
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
