"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { Laptop, Moon, Sun, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/components/i18n-provider";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locales";
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
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const [themeMounted, setThemeMounted] = useState(false);
  // Avoid hydration mismatch: next-themes reads the persisted theme on the client,
  // but SSR must render a deterministic value.
  const currentTheme = (
    (themeMounted ? theme : "system") ?? "system"
  ) as "light" | "dark" | "system";
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
    setThemeMounted(true);
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
          const list = (profData.profiles || []) as ProfileInfo[];
          setProfiles(list.filter((p) => p.selectable));
        } else {
          setProfiles([]);
        }
      } else {
        setMessage({ type: "error", text: t("settings.beookConfig.loadError") });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: t("settings.beookConfig.loadException") });
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
        setMessage({ type: "success", text: t("settings.beookConfig.saveSuccess") });
        setResolvedDbPath(data.resolved.dbPath);
        setResolvedImgPath(data.resolved.imgPath);

        // Refresh profiles after saving beookDir (in case it changed)
        const profRes = await fetch("/api/profiles");
        const profData = await profRes.json();
        if (profRes.ok && profData.success) {
          const list = (profData.profiles || []) as ProfileInfo[];
          setProfiles(list.filter((p) => p.selectable));
        } else {
          setProfiles([]);
        }
      } else {
        setMessage({ type: "error", text: t("settings.beookConfig.saveError") });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: t("settings.beookConfig.saveException") });
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
        setMessage({ type: "success", text: t("settings.beookConfig.resetSuccess") });

        const profRes = await fetch("/api/profiles");
        const profData = await profRes.json();
        if (profRes.ok && profData.success) {
          const list = (profData.profiles || []) as ProfileInfo[];
          setProfiles(list.filter((p) => p.selectable));
        } else {
          setProfiles([]);
        }
      } else {
        setMessage({ type: "error", text: t("settings.beookConfig.resetError") });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: t("settings.beookConfig.resetException") });
    } finally {
      setSaving(false);
    }
  }

  async function runMiscDecrypt() {
    setMiscDecryptStatus(t("settings.miscDecrypt.running"));
    try {
      const res = await fetch("/api/decrypt/misc");
      const data = await res.json();

      if (!res.ok || !data.ok) {
        console.error("Misc decrypt error:", data);
        setMiscDecryptStatus(t("settings.miscDecrypt.failed"));
        return;
      }

      setMiscDecryptStatus(
        `${t("settings.miscDecrypt.users")}: ${data.userDecryptedRows}/${data.userProcessedRows} | ` +
          `${t("settings.miscDecrypt.properties")}: ${data.propertyDecryptedRows}/${data.propertyProcessedRows}`
      );
    } catch (err) {
      console.error(err);
      setMiscDecryptStatus(t("settings.miscDecrypt.error"));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-2">
          <Label>{t("settings.theme")}</Label>
          <Select value={currentTheme} onValueChange={setTheme}>
            <SelectTrigger className="w-[220px]">
              <div className="flex items-center gap-2">
                {currentTheme === "light" ? (
                  <Sun className="h-4 w-4" />
                ) : currentTheme === "dark" ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Laptop className="h-4 w-4" />
                )}
                <span>{t(`theme.${currentTheme}`)}</span>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="light">
                  <span className="flex items-center gap-2">
                    <Sun className="h-4 w-4" />
                    {t("theme.light")}
                  </span>
                </SelectItem>
                <SelectItem value="dark">
                  <span className="flex items-center gap-2">
                    <Moon className="h-4 w-4" />
                    {t("theme.dark")}
                  </span>
                </SelectItem>
                <SelectItem value="system">
                  <span className="flex items-center gap-2">
                    <Laptop className="h-4 w-4" />
                    {t("theme.system")}
                  </span>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2">
          <Label>{t("settings.language")}</Label>
          <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            <SelectTrigger className="w-[220px]">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                <span>{t(`languages.${locale}`)}</span>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {SUPPORTED_LOCALES.map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    <span className="flex items-center gap-2">
                      {t(`languages.${loc}`)}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.beookConfig.title")}</CardTitle>
          <CardDescription>
            {t("settings.beookConfig.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("settings.beookConfig.loading")}</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="beookDir">{t("settings.beookConfig.folderLabel")}</Label>
                <Input
                  id="beookDir"
                  value={beookDir}
                  onChange={(e) => setBeookDir(e.target.value)}
                  placeholder="C:/Users/${username}/AppData/Roaming/ionesoft/beook"
                  disabled={saving}
                />
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
                  {saving ? t("settings.beookConfig.saving") : t("settings.beookConfig.save")}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetToDefault}
                  disabled={saving || loading}
                >
                  {t("settings.beookConfig.resetToDefault")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.miscDecrypt.title")}</CardTitle>
          <CardDescription>
            {t("settings.miscDecrypt.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={runMiscDecrypt}>
              {t("settings.miscDecrypt.button")}
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
