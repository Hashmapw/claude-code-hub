"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiFetch, getBasePath } from "@/lib/utils/base-path";

interface MyUsageHeaderProps {
  onLogout?: () => Promise<void> | void;
  keyName?: string;
  userName?: string;
}

export function MyUsageHeader({ onLogout, keyName, userName }: MyUsageHeaderProps) {
  const t = useTranslations("myUsage.header");

  const handleLogout = async () => {
    if (onLogout) {
      await onLogout();
      return;
    }

    await apiFetch("/auth/logout", { method: "POST" });
    const basePath = getBasePath();
    const loginPath = basePath ? `${basePath}/login` : "/login";
    window.location.href = loginPath;
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold leading-tight">
            {userName ? t("welcome", { name: userName }) : t("title")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="text-foreground font-medium">{t("keyLabel")}:</span>
            <span>{keyName ?? "—"}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-foreground font-medium">{t("userLabel")}:</span>
            <span>{userName ?? "—"}</span>
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
          <LogOut className="h-4 w-4" />
          {t("logout")}
        </Button>
      </div>
    </div>
  );
}
