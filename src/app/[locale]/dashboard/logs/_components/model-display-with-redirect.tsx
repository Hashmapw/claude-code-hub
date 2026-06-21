"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { type MouseEvent, useCallback } from "react";
import { toast } from "sonner";
import { ModelVendorIcon } from "@/components/customs/model-vendor-icon";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import { resolveModelAuditDisplay } from "@/lib/utils/model-audit-display";
import type { BillingModelSource } from "@/types/system-config";

interface ModelDisplayWithRedirectProps {
  originalModel: string | null;
  currentModel: string | null;
  actualResponseModel?: string | null;
  billingModelSource: BillingModelSource;
  onRedirectClick?: () => void;
}

export function ModelDisplayWithRedirect({
  originalModel,
  currentModel,
  actualResponseModel = null,
  billingModelSource,
  onRedirectClick,
}: ModelDisplayWithRedirectProps) {
  const tCommon = useTranslations("common");
  const tAudit = useTranslations("dashboard.logs.details.modelAudit");

  const audit = resolveModelAuditDisplay({
    originalModel,
    model: currentModel,
    actualResponseModel,
    billingModelSource,
  });
  const isRedirected = audit.hasRedirect;
  // primaryBillingModel 已在 helper 里按 billingModelSource 选完并做了 null fallback,
  // 和详情面板保持一致;避免历史数据某个字段缺失时 UI 显示 "-"。
  const billingModel = audit.primaryBillingModel;

  const handleCopyModel = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (!billingModel) return;
      void copyTextToClipboard(billingModel).then((ok) => {
        if (ok) toast.success(tCommon("copySuccess"));
      });
    },
    [billingModel, tCommon]
  );

  // 代理是否已对客户端隐藏了模型重定向(客户端收到的是请求的原始模型名)。
  const clientMasked = audit.clientReturnedRequestModel;
  // 二级行要展示的"真实应答模型":优先用解析出的 actualResponseModel,
  // 隐藏重定向时回退到重定向后的 currentModel,确保真实模型始终可见。
  const secondaryBaseModel =
    audit.secondaryActualModel ?? (clientMasked ? (actualResponseModel ?? currentModel) : null);
  const showSecondaryLine =
    Boolean(secondaryBaseModel) && (audit.hasActualMismatch || clientMasked);
  // 隐藏重定向时,在真实应答模型后面加 `%`,表示已对客户端返回了请求的模型名。
  const secondaryModelText = secondaryBaseModel
    ? `${secondaryBaseModel}${clientMasked ? "%" : ""}`
    : null;

  const secondaryLine =
    showSecondaryLine && secondaryModelText ? (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="flex items-center gap-1 text-xs text-muted-foreground truncate cursor-help"
              aria-label={
                clientMasked
                  ? tAudit("clientMaskedAriaLabel", { model: secondaryBaseModel ?? "" })
                  : tAudit("secondaryLineAriaLabel", { model: secondaryBaseModel ?? "" })
              }
            >
              <span aria-hidden>{tAudit("arrowPrefix")}</span>
              <span className="truncate">{secondaryModelText}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs max-w-xs">
              {clientMasked ? tAudit("clientMaskedTooltip") : tAudit("mismatchTooltip")}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : null;

  if (!isRedirected) {
    return (
      <div className="flex flex-col min-w-0 gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {billingModel ? <ModelVendorIcon modelId={billingModel} /> : null}
          <span
            className="truncate max-w-full cursor-pointer hover:underline"
            onClick={handleCopyModel}
          >
            {billingModel || "-"}
          </span>
        </div>
        {secondaryLine}
      </div>
    );
  }

  // 计费模型 + 重定向标记（只显示图标）
  return (
    <div className="flex flex-col min-w-0 gap-0.5">
      <div className="flex items-center gap-1.5 min-w-0">
        {billingModel ? <ModelVendorIcon modelId={billingModel} /> : null}
        <span className="truncate cursor-pointer hover:underline" onClick={handleCopyModel}>
          {billingModel}
        </span>
        <Badge
          variant="outline"
          className="cursor-pointer text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300 px-1 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onRedirectClick?.();
          }}
        >
          <ArrowRight className="h-3 w-3" />
        </Badge>
      </div>
      {secondaryLine}
    </div>
  );
}
