import { useMemo } from "react";
import {
  Download,
  FileSpreadsheet,
  FileImage,
  FileText,
  Presentation,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { ExportData } from "@/utils/exportUtils";
import {
  exportDataAsExcel,
  exportElementAsImage,
  exportElementAsPdf,
  exportElementAsPpt,
} from "@/utils/exportUtils";

type ExportMenuProps = {
  title: string;
  targetRef: React.RefObject<HTMLElement> | HTMLElement;
  getExportData?: () => ExportData | Promise<ExportData>;
  disabled?: boolean;
};

export function ExportMenu({
  title,
  targetRef,
  getExportData,
  disabled,
}: ExportMenuProps) {
  const { toast } = useToast();

  const safeTitle = useMemo(() => title || "export", [title]);

  const handleExportData = async (): Promise<ExportData | undefined> => {
    if (!getExportData) return undefined;
    return await getExportData();
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
      } else if (type === "ppt") {
        const data = await handleExportData();
        await exportElementAsPpt(targetRef, safeTitle, data);
      } else if (type === "pdf") {
        await exportElementAsPdf(targetRef, safeTitle);
      } else if (type === "png") {
        await exportElementAsImage(targetRef, "png", safeTitle);
      } else if (type === "jpeg") {
        await exportElementAsImage(targetRef, "jpeg", safeTitle);
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-track="export_menu_open"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={disabled}
          aria-label="Export"
        >
          <Download className="w-4 h-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem data-track="export_excel" onClick={() => handleExport("excel")}>
          <FileSpreadsheet className="w-4 h-4 mr-2" />
          Excel
        </DropdownMenuItem>
        <DropdownMenuItem data-track="export_pdf" onClick={() => handleExport("pdf")}>
          <FileText className="w-4 h-4 mr-2" />
          PDF
        </DropdownMenuItem>
        <DropdownMenuItem data-track="export_ppt" onClick={() => handleExport("ppt")}>
          <Presentation className="w-4 h-4 mr-2" />
          PowerPoint
        </DropdownMenuItem>
        <DropdownMenuItem data-track="export_png" onClick={() => handleExport("png")}>
          <FileImage className="w-4 h-4 mr-2" />
          PNG
        </DropdownMenuItem>
        <DropdownMenuItem data-track="export_jpeg" onClick={() => handleExport("jpeg")}>
          <FileImage className="w-4 h-4 mr-2" />
          JPEG
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
