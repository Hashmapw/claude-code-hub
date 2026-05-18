"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateErrorRuleAction } from "@/lib/api-client/v1/actions/error-rules";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/utils/error-messages";
import type { ErrorOverrideResponse, ErrorRule } from "@/repository/error-rules";
import { OverrideSection } from "./override-section";
import { RegexTester } from "./regex-tester";

type ErrorRuleCategory =
  | "prompt_limit"
  | "content_filter"
  | "pdf_limit"
  | "thinking_error"
  | "parameter_error"
  | "invalid_request"
  | "cache_limit"
  | "stream_prefix_block";

const ERROR_RULE_CATEGORIES: ErrorRuleCategory[] = [
  "prompt_limit",
  "content_filter",
  "pdf_limit",
  "thinking_error",
  "parameter_error",
  "invalid_request",
  "cache_limit",
  "stream_prefix_block",
];

function isStreamPrefixBlock(category: string): boolean {
  return category === "stream_prefix_block";
}

interface EditRuleDialogProps {
  rule: ErrorRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditRuleDialog({ rule, open, onOpenChange }: EditRuleDialogProps) {
  const t = useTranslations("settings");
  const tErrors = useTranslations("errors");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [enableOverride, setEnableOverride] = useState(false);
  const [overrideResponse, setOverrideResponse] = useState("");
  const [overrideStatusCode, setOverrideStatusCode] = useState<string>("");
  const isStreamPrefixBlockRule = isStreamPrefixBlock(category);

  // Update form when rule changes
  useEffect(() => {
    if (rule) {
      setPattern(rule.pattern);
      setCategory(rule.category || "");
      setDescription(rule.description || "");
      // Enable override if rule has override response or status code
      const hasOverride = !!rule.overrideResponse || !!rule.overrideStatusCode;
      setEnableOverride(hasOverride);
      setOverrideResponse(
        rule.overrideResponse ? JSON.stringify(rule.overrideResponse, null, 2) : ""
      );
      setOverrideStatusCode(rule.overrideStatusCode?.toString() || "");
    }
  }, [rule]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pattern.trim()) {
      toast.error(
        t(
          isStreamPrefixBlockRule
            ? "errorRules.dialog.streamPrefixPatternRequired"
            : "errorRules.dialog.patternRequired"
        )
      );
      return;
    }

    if (!category.trim()) {
      toast.error(t("errorRules.dialog.categoryRequired"));
      return;
    }

    // Validate regex pattern (only for regex rules; stream_prefix_block stores fallback keywords).
    if (!isStreamPrefixBlockRule && rule.matchType === "regex") {
      try {
        new RegExp(pattern.trim());
      } catch {
        toast.error(t("errorRules.dialog.invalidRegex"));
        return;
      }
    }

    // Parse and validate override response JSON (only when override is enabled)
    let parsedOverrideResponse: ErrorOverrideResponse | null = null;
    let parsedStatusCode: number | null = null;

    if (enableOverride) {
      if (overrideResponse.trim()) {
        try {
          parsedOverrideResponse = JSON.parse(overrideResponse.trim());
        } catch {
          toast.error(t("errorRules.dialog.invalidJson"));
          return;
        }
      }

      // Parse override status code
      if (overrideStatusCode.trim()) {
        const code = parseInt(overrideStatusCode.trim(), 10);
        if (Number.isNaN(code) || code < 400 || code > 599) {
          toast.error(t("errorRules.dialog.invalidStatusCode"));
          return;
        }
        parsedStatusCode = code;
      }
    }

    setIsSubmitting(true);

    try {
      const result = await updateErrorRuleAction(rule.id, {
        pattern: pattern.trim(),
        category: category as ErrorRuleCategory,
        matchType: isStreamPrefixBlockRule ? "contains" : rule.matchType,
        description: description.trim(),
        overrideResponse: parsedOverrideResponse,
        overrideStatusCode: parsedStatusCode,
      });

      if (result.ok) {
        toast.success(t("errorRules.editSuccess"));
        onOpenChange(false);
      } else {
        toast.error(
          result.errorCode
            ? getErrorMessage(tErrors, result.errorCode, result.errorParams)
            : result.error
        );
      }
    } catch {
      toast.error(t("errorRules.editFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[var(--cch-viewport-height-80)] flex flex-col bg-card/95 backdrop-blur-xl border-border">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{t("errorRules.dialog.editTitle")}</DialogTitle>
            <DialogDescription>{t("errorRules.dialog.editDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 overflow-y-auto pr-2 flex-1">
            <div className="space-y-2">
              <Label
                htmlFor="edit-pattern"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                {t(
                  isStreamPrefixBlockRule
                    ? "errorRules.dialog.streamPrefixPatternLabel"
                    : "errorRules.dialog.patternLabel"
                )}
              </Label>
              <input
                id="edit-pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder={
                  isStreamPrefixBlockRule
                    ? t("errorRules.dialog.streamPrefixPatternPlaceholder")
                    : t("errorRules.dialog.patternPlaceholder")
                }
                required
                disabled={rule.isDefault}
                className={cn(
                  "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground font-mono",
                  "placeholder:text-muted-foreground/50",
                  "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              />
              {rule.isDefault && (
                <p className="text-xs text-muted-foreground">
                  {t("errorRules.dialog.defaultRuleHint")}
                </p>
              )}
              {!rule.isDefault && (
                <p className="text-xs text-muted-foreground">
                  {isStreamPrefixBlockRule
                    ? t("errorRules.dialog.streamPrefixPatternHint")
                    : t("errorRules.dialog.patternHint")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="edit-category"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                {t("errorRules.dialog.categoryLabel")}
              </Label>
              <Select value={category} onValueChange={setCategory} disabled={rule.isDefault}>
                <SelectTrigger id="edit-category" className="bg-muted/50 border-border">
                  <SelectValue placeholder={t("errorRules.dialog.categoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {ERROR_RULE_CATEGORIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(`errorRules.categories.${item}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("errorRules.dialog.categoryHint")}</p>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="edit-description"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                {t("errorRules.dialog.descriptionLabel")}
              </Label>
              <textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  isStreamPrefixBlockRule
                    ? t("errorRules.dialog.streamPrefixDescriptionPlaceholder")
                    : t("errorRules.dialog.descriptionPlaceholder")
                }
                rows={3}
                className={cn(
                  "w-full bg-muted/50 border border-border rounded-lg py-2.5 px-3 text-sm text-foreground",
                  "placeholder:text-muted-foreground/50 resize-none",
                  "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                )}
              />
              {isStreamPrefixBlockRule && (
                <p className="text-xs text-muted-foreground">
                  {t("errorRules.dialog.streamPrefixDescriptionHint")}
                </p>
              )}
            </div>

            <OverrideSection
              idPrefix="edit"
              enableOverride={enableOverride}
              onEnableOverrideChange={setEnableOverride}
              overrideResponse={overrideResponse}
              onOverrideResponseChange={setOverrideResponse}
              overrideStatusCode={overrideStatusCode}
              onOverrideStatusCodeChange={setOverrideStatusCode}
            />

            {pattern && !isStreamPrefixBlockRule && (
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("errorRules.dialog.regexTester")}
                </Label>
                <RegexTester pattern={pattern} />
              </div>
            )}
          </div>

          <DialogFooter className="flex-shrink-0 pt-4 border-t border-border/50">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="hover:bg-muted"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-primary hover:bg-primary/90"
            >
              {isSubmitting ? t("errorRules.dialog.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
