import { useMemo, useState } from "react";
import {
  Share2,
  FileSpreadsheet,
  FileImage,
  FileText,
  Presentation,
  Link as LinkIcon,
  Lock,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import type { ExportData } from "@/utils/exportUtils";
import {
  exportDataAsExcel,
  exportElementAsImage,
  exportElementAsPdf,
  exportElementAsPpt,
} from "@/utils/exportUtils";

type ExportShareTarget = {
  type: string;
  id?: string;
  tenantId?: string;
  label?: string;
};

type ExportShareMenuProps = {
  title: string;
  targetRef: React.RefObject<HTMLElement> | HTMLElement;
  getExportData?: () => ExportData | Promise<ExportData>;
  shareTarget: ExportShareTarget;
  disabled?: boolean;
};

export function ExportShareMenu({
  title,
  targetRef,
  getExportData,
  shareTarget,
  disabled,
}: ExportShareMenuProps) {
  const { toast } = useToast();
  const [shareOpen, setShareOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [shareLoading, setShareLoading] = useState(false);

  const safeTitle = useMemo(() => title || "export", [title]);

  const handleExportData = async (): Promise<ExportData | undefined> => {
    if (!getExportData) return undefined;
    return await getExportData();
  };

  const resolveTarget = (): HTMLElement | null => {
    if (targetRef instanceof HTMLElement) return targetRef;
    return targetRef?.current ?? null;
  };

  const handleExport = async (type: "pdf" | "png" | "jpeg" | "ppt" | "excel") => {
    try {
      if (type === "excel") {
        const data = await handleExportData();
        if (!data) {
          toast({ title: "Export unavailable", description: "No data available for Excel." });
          return;
        }
        await exportDataAsExcel(data, safeTitle);
      } else {
        const el = resolveTarget();
        if (!el) {
          toast({
            title: "Export unavailable",
            description: "Content not ready. Try again in a moment.",
            variant: "destructive",
          });
          return;
        }
        if (type === "ppt") {
          const data = await handleExportData();
          await exportElementAsPpt(targetRef, safeTitle, data);
        } else if (type === "pdf") {
          await exportElementAsPdf(targetRef, safeTitle);
        } else if (type === "png") {
          await exportElementAsImage(targetRef, "png", safeTitle);
        } else if (type === "jpeg") {
          await exportElementAsImage(targetRef, "jpeg", safeTitle);
        }
      }
      toast({ title: "Downloaded", description: `Exported ${type.toUpperCase()}.` });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Export failed.",
        variant: "destructive",
      });
    }
  };

  const handleCreateShareLink = async () => {
    if (!pin || !/^\d{6,}$/.test(pin)) {
      toast({
        title: "Invalid PIN",
        description: "PIN must be at least 6 digits.",
        variant: "destructive",
      });
      return;
    }
    setShareLoading(true);
    try {
      const response = await api.request<{ url: string }>("/api/share-links", {
        method: "POST",
        body: JSON.stringify({
          targetType: shareTarget.type,
          targetId: shareTarget.id,
          tenantId: shareTarget.tenantId,
          label: shareTarget.label || safeTitle,
          pin,
            targetUrl: window.location.href,
        }),
      });
      setShareLink(response.url);
      await navigator.clipboard.writeText(response.url);
      toast({ title: "Link copied", description: "Share link copied to clipboard." });
    } catch (error) {
      toast({
        title: "Share failed",
        description: error instanceof Error ? error.message : "Could not create share link.",
        variant: "destructive",
      });
    } finally {
      setShareLoading(false);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  disabled={disabled}
                  aria-label="Export or share"
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => handleExport("excel")}>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("pdf")}>
                  <FileText className="w-4 h-4 mr-2" />
                  PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("ppt")}>
                  <Presentation className="w-4 h-4 mr-2" />
                  PowerPoint
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("png")}>
                  <FileImage className="w-4 h-4 mr-2" />
                  PNG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("jpeg")}>
                  <FileImage className="w-4 h-4 mr-2" />
                  JPEG
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShareOpen(true)}>
                  <LinkIcon className="w-4 h-4 mr-2" />
                  Share link (PIN)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs font-normal">
          Export / Share
        </TooltipContent>
      </Tooltip>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="w-[95vw] max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Lock className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              Share with PIN
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/[^\d]/g, ""))}
              placeholder="Enter 6+ digit PIN"
              inputMode="numeric"
            />
            <Button
              onClick={handleCreateShareLink}
              className="w-full"
              disabled={shareLoading}
            >
              {shareLoading ? "Creating..." : "Create share link"}
            </Button>
            {shareLink && (
              <div className="text-xs text-slate-500 break-all">
                {shareLink}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
