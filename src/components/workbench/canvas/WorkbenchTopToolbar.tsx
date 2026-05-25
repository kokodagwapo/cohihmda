import React, { type ChangeEventHandler, type RefObject } from "react";
import type { NavigateFunction } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Save,
  Share2,
  Mail,
  Image,
  Palette,
  ChevronDown,
  Type,
  Presentation,
  Undo2,
  Redo2,
  PlusCircle,
  Trash2,
  Copy,
  Eraser,
  StickyNote,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CohiChatDockChip } from "@/components/cohi/CohiChatDockChip";
import type { CanvasBackground } from "@/components/workbench/canvas/types";
import { DASHBOARD_SECTION_GROUPS } from "@/components/workbench/workbenchSections";
import {
  BACKGROUND_TEMPLATES,
  CANVAS_TEMPLATES,
  UPLOAD_ALLOWED_TYPES,
} from "@/components/workbench/WorkbenchCanvas";

export type WorkbenchSaveIndicator = {
  label: string;
  className: string;
  icon: React.ReactNode | null;
} | null;

export type WorkbenchCanvasTemplate = (typeof CANVAS_TEMPLATES)[number];

export interface WorkbenchTopToolbarProps {
  showReportBuilder: boolean;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isOwner: boolean;
  saveTitle: string;
  setSaveTitle: (title: string) => void;
  canvasId: string | null;
  handleSaveConfirm: () => void;
  handleSaveClick: () => void;
  isSaving: boolean;
  canvasLoading: boolean;
  saveIndicator: WorkbenchSaveIndicator;
  handleShareClick: () => void;
  navigate: NavigateFunction;
  canEdit: boolean;
  backgroundImageInputRef: RefObject<HTMLInputElement | null>;
  handleBackgroundImageChange: ChangeEventHandler<HTMLInputElement>;
  canvasBackground: CanvasBackground;
  setCanvasBackground: (background: CanvasBackground) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleFileChange: ChangeEventHandler<HTMLInputElement>;
  logoInputRef: RefObject<HTMLInputElement | null>;
  handleLogoChange: ChangeEventHandler<HTMLInputElement>;
  activeAddGroup: string;
  setActiveAddGroup: (label: string) => void;
  addDashboardSection: (sectionId: string, title: string) => void;
  addTextBlock: () => void;
  applyTemplate: (template: WorkbenchCanvasTemplate) => void;
  selectedWidgetId: string | null;
  duplicateWidget: (widgetId: string) => void;
  removeWidget: (widgetId: string) => void;
  addRichTextBlock: () => void;
  setClearConfirmOpen: (open: boolean) => void;
  hasItems: boolean;
  embeddedCohiHidden: boolean;
  showCohiPanel: boolean;
  setShowCohiPanel: (show: boolean) => void;
  setShowReportBuilder: (show: boolean) => void;
}

export function WorkbenchTopToolbar({
  showReportBuilder,
  undo,
  redo,
  canUndo,
  canRedo,
  isOwner,
  saveTitle,
  setSaveTitle,
  canvasId,
  handleSaveConfirm,
  handleSaveClick,
  isSaving,
  canvasLoading,
  saveIndicator,
  handleShareClick,
  navigate,
  canEdit,
  backgroundImageInputRef,
  handleBackgroundImageChange,
  canvasBackground,
  setCanvasBackground,
  fileInputRef,
  handleFileChange,
  logoInputRef,
  handleLogoChange,
  activeAddGroup,
  setActiveAddGroup,
  addDashboardSection,
  addTextBlock,
  applyTemplate,
  selectedWidgetId,
  duplicateWidget,
  removeWidget,
  addRichTextBlock,
  setClearConfirmOpen,
  hasItems,
  embeddedCohiHidden,
  showCohiPanel,
  setShowCohiPanel,
  setShowReportBuilder,
}: WorkbenchTopToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap xl:flex-nowrap items-center justify-between gap-2 xl:gap-1 overflow-x-auto py-1.5 px-3 border-b border-slate-200/70 dark:border-slate-700/70 bg-slate-50/80 dark:bg-slate-800/50 shrink-0 min-h-[44px] min-w-0 sticky top-0 z-20",
        showReportBuilder && "hidden",
      )}
    >
      <div className="flex items-center gap-1 flex-wrap xl:flex-nowrap shrink-0 min-w-0 flex-1">
        {!showReportBuilder && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400"
                  onClick={() => undo()}
                  disabled={!canUndo || !isOwner}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Undo (Ctrl+Z)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400"
                  onClick={() => redo()}
                  disabled={!canRedo || !isOwner}
                >
                  <Redo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Redo (Ctrl+Shift+Z)
              </TooltipContent>
            </Tooltip>
            <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 shrink-0 mx-0.5" />
            {/* Inline editable canvas name */}
            <input
              data-testid="workbench-canvas-title-input"
              type="text"
              value={saveTitle}
              onChange={(e) => isOwner && setSaveTitle(e.target.value)}
              readOnly={!isOwner}
              onBlur={() => {
                if (!saveTitle.trim()) setSaveTitle("Untitled canvas");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  (e.target as HTMLInputElement).blur();
              }}
              className={cn(
                "h-8 min-w-[120px] max-w-[260px] px-2 py-1 text-sm font-medium text-slate-700 dark:text-slate-200 bg-transparent border border-transparent rounded-md outline-none transition-colors truncate",
                isOwner
                  ? "hover:border-slate-300 dark:hover:border-slate-600 focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400/30"
                  : "cursor-default",
              )}
              placeholder="Canvas name…"
              title={isOwner ? "Click to rename this canvas" : saveTitle}
            />
            {isOwner && (
              <>
                <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 shrink-0 mx-0.5" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      data-testid="workbench-save-button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400"
                      onClick={canvasId ? handleSaveConfirm : handleSaveClick}
                      // Also disable while the canvas is still loading: clicking
                      // save before the load resolves would read `canvasId === null`
                      // and take the "new canvas" branch, which (a) opens the Save
                      // dialog unexpectedly and (b) risks overwriting the real
                      // canvas content with a blank payload once load completes.
                      disabled={isSaving || canvasLoading}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Save</TooltipContent>
                </Tooltip>
              </>
            )}
            <div className="min-w-[104px] flex items-center justify-end">
              {saveIndicator && (
                <span className={saveIndicator.className}>
                  {saveIndicator.icon}
                  {saveIndicator.label}
                </span>
              )}
            </div>
            {isOwner && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid="workbench-share-button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400"
                    onClick={handleShareClick}
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Share</TooltipContent>
              </Tooltip>
            )}
            {isOwner && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400"
                    onClick={() =>
                      navigate(
                        canvasId
                          ? `/workbench/distributions?canvas=${canvasId}`
                          : "/workbench/distributions",
                      )
                    }
                  >
                    <Mail className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Schedule distribution
                </TooltipContent>
              </Tooltip>
            )}
            {canEdit && (
              <>
                <input
                  ref={backgroundImageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleBackgroundImageChange}
                  className="hidden"
                  aria-hidden
                />
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400"
                        >
                          <Palette className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Background
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" className="w-64">
                    <div className="px-2 py-2 flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Color
                      </span>
                      <input
                        type="color"
                        value={
                          canvasBackground.type === "color"
                            ? canvasBackground.value
                            : "#ffffff"
                        }
                        onChange={(e) =>
                          setCanvasBackground({
                            type: "color",
                            value: e.target.value,
                          })
                        }
                        className="h-8 w-12 cursor-pointer rounded border border-slate-200 dark:border-slate-600 bg-transparent"
                      />
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() =>
                        backgroundImageInputRef.current?.click()
                      }
                      className="gap-2"
                    >
                      <Image className="h-4 w-4" /> Upload image
                    </DropdownMenuItem>
                    {/* AI background generation hidden until backend endpoint is implemented */}
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                      Templates
                    </div>
                    {BACKGROUND_TEMPLATES.map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        onClick={() =>
                          setCanvasBackground({
                            type: "template",
                            value: t.id,
                          })
                        }
                        className="gap-2"
                      >
                        <span
                          className="h-5 w-8 rounded border border-slate-200 dark:border-slate-600 shrink-0"
                          style={t.style}
                        />
                        {t.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={
                    UPLOAD_ALLOWED_TYPES.join(",") +
                    ",.csv,.xlsx,.xls,.pptx,.ppt"
                  }
                  onChange={handleFileChange}
                  className="hidden"
                  aria-hidden
                />
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="hidden"
                  aria-hidden
                />
                {/* Upload file button hidden – not ready for release
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400 relative" disabled={isUploading}>
                      <Upload className="h-4 w-4" />
                      {uploads.length > 0 && <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] rounded-full bg-slate-500 text-[10px] text-white flex items-center justify-center px-1">{uploads.length}</span>}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{isUploading ? 'Uploading…' : 'Upload file'}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuItem onClick={handleUploadClick} disabled={isUploading} className="gap-2">
                  <Upload className="h-4 w-4" /> Upload CSV / Excel / PDF / image…
                </DropdownMenuItem>
                {uploads.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5" /> Recent uploads
                    </div>
                    {uploads.slice(0, 10).map((u) => (
                      <DropdownMenuItem key={u.id} disabled className="gap-2 py-2 cursor-default">
                        <span className="shrink-0">{getUploadIcon(u.filename)}</span>
                        <span className="truncate flex-1" title={u.filename}>{u.filename}</span>
                        <span className="text-xs text-slate-400 shrink-0">{formatUploadTime(u.uploadedAt)}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            */}
                {/* Image-to-Dashboard button hidden until feature is ready for release
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                  onClick={() => setImageToDashboardOpen(true)}
                >
                  <Camera className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Create dashboard from image</TooltipContent>
            </Tooltip>
            */}
              </>
            )}
            {canEdit && (
              <>
                <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 shrink-0 mx-0.5" />
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 gap-1.5 px-2 text-slate-700 dark:text-slate-300"
                        >
                          <PlusCircle className="h-4 w-4" />
                          <span className="text-xs font-medium">Add</span>
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Add widget or template
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent
                    align="start"
                    className="w-[620px] p-0 overflow-hidden border-0 shadow-lg"
                  >
                    <div className="grid grid-cols-[160px_1fr] gap-0">
                      <div className="space-y-0.5 p-2.5 bg-gradient-to-b from-slate-50/90 to-slate-100/60 dark:from-slate-800/40 dark:to-slate-900/50 rounded-l-lg border-r border-slate-200/60 dark:border-slate-700/50">
                        {DASHBOARD_SECTION_GROUPS.map((group) => (
                          <button
                            key={group.label}
                            type="button"
                            onClick={() => setActiveAddGroup(group.label)}
                            className={`w-full text-left rounded-lg px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-all duration-200 ${
                              activeAddGroup === group.label
                                ? "bg-violet-100 text-violet-700 shadow-sm dark:bg-violet-500/20 dark:text-violet-300"
                                : "text-slate-500 dark:text-slate-400 hover:bg-violet-50/80 dark:hover:bg-violet-500/10 hover:text-slate-700 dark:hover:text-slate-300"
                            }`}
                          >
                            {group.label}
                          </button>
                        ))}
                      </div>
                      <div className="rounded-r-lg bg-gradient-to-br from-rose-50/50 via-white to-violet-50/50 dark:from-slate-900/60 dark:via-slate-900/40 dark:to-indigo-950/30 p-3 border border-l-0 border-slate-200/50 dark:border-slate-700/50 flex flex-col">
                        <div className="grid grid-cols-2 gap-2">
                          {(
                            DASHBOARD_SECTION_GROUPS.find(
                              (g) => g.label === activeAddGroup,
                            )?.items ?? []
                          ).map((section) => {
                            const Icon = section.icon;
                            return (
                              <DropdownMenuItem
                                key={section.id}
                                onClick={() =>
                                  addDashboardSection(
                                    section.id,
                                    section.title,
                                  )
                                }
                                className="gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-white/90 dark:hover:bg-slate-800/60 hover:shadow-sm border border-transparent hover:border-rose-200/60 dark:hover:border-violet-500/30 transition-all duration-200"
                              >
                                <Icon
                                  className={`h-4 w-4 shrink-0 ${section.iconClass ?? "text-slate-500"}`}
                                />
                                <span className="truncate">
                                  {section.title}
                                </span>
                              </DropdownMenuItem>
                            );
                          })}
                        </div>
                        <div className="mt-2.5 pt-2.5 border-t border-slate-200/60 dark:border-slate-600/50">
                          <DropdownMenuItem
                            onClick={addTextBlock}
                            className="gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-white/90 dark:hover:bg-slate-800/60 hover:text-slate-800 dark:hover:text-slate-100 border-0 focus:bg-white/90 dark:focus:bg-slate-800/60 focus:text-slate-800 dark:focus:text-slate-100 cursor-pointer"
                          >
                            <StickyNote className="h-4 w-4 shrink-0 text-amber-500/80 dark:text-amber-400/80" />
                            <span>Text block</span>
                          </DropdownMenuItem>
                        </div>
                      </div>
                    </div>
                    <div className="hidden h-px bg-slate-200/70 dark:bg-slate-700/60 my-2" />
                    <DropdownMenuLabel className="hidden text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-3">
                      Templates
                    </DropdownMenuLabel>
                    <div className="hidden grid grid-cols-2 gap-2 px-2 py-2">
                      {CANVAS_TEMPLATES.map((t) => {
                        const Icon = t.icon;
                        return (
                          <DropdownMenuItem
                            key={t.id}
                            onClick={() => applyTemplate(t)}
                            className="gap-3 rounded-lg border border-transparent bg-slate-50/60 p-2.5 transition-colors data-[highlighted]:border-slate-200 data-[highlighted]:bg-slate-100 dark:bg-slate-800/40 dark:data-[highlighted]:border-slate-700 dark:data-[highlighted]:bg-slate-800"
                          >
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="flex flex-col">
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                {t.label}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {t.description}
                              </span>
                            </span>
                          </DropdownMenuItem>
                        );
                      })}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {/* Logo button hidden – not ready for release
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 px-2 text-slate-700 dark:text-slate-300"
                  onClick={() => logoInputRef.current?.click()}
                >
                  <Image className="h-4 w-4" />
                  <span className="text-xs font-medium">Logo</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Add logo</TooltipContent>
            </Tooltip>
            */}
            {canEdit && selectedWidgetId && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => duplicateWidget(selectedWidgetId)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Duplicate selected
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                      onClick={() => removeWidget(selectedWidgetId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Delete selected
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            {/* Arrange button hidden – not ready for release
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-slate-700 dark:text-slate-300">
                      <LayoutGrid className="h-4 w-4" />
                      <span className="text-xs font-medium">Arrange</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Arrange layout</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs font-medium text-slate-500 dark:text-slate-400">Auto layout</DropdownMenuLabel>
                <DropdownMenuItem onClick={applyBestFitLayout} disabled={!hasItems} className="gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  Best fit — balanced grid
                </DropdownMenuItem>
                <DropdownMenuItem onClick={applyMasonryLayout} disabled={!hasItems} className="gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  Masonry — staggered columns
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-medium text-slate-500 dark:text-slate-400">Manual layouts</DropdownMenuLabel>
                <DropdownMenuItem onClick={applyRowLayout} disabled={!hasItems} className="gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  Single row
                </DropdownMenuItem>
                <DropdownMenuItem onClick={applyColumnLayout} disabled={!hasItems} className="gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  Single column
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            */}
            {canEdit && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={addRichTextBlock}
                    >
                      <Type className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Rich text</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                      onClick={() => setClearConfirmOpen(true)}
                      disabled={!hasItems}
                    >
                      <Eraser className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Clear canvas
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </>
        )}
        {/* --- End canvas-only tools --- */}

        {!embeddedCohiHidden && !showCohiPanel && (
          <CohiChatDockChip
            data-testid="workbench-cohi-toggle"
            onClick={() => setShowCohiPanel(true)}
            ariaLabel="Open Cohi Assistant"
            title="Cohi – Canvas assistant"
          />
        )}

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs px-3 font-semibold shrink-0 shadow-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white"
                onClick={() => setShowReportBuilder(true)}
                disabled={!hasItems}
              >
                <Presentation className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">PowerPoint Editor</span>
                <span className="xl:hidden sr-only">PowerPoint Editor</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Open the slide builder to preview, edit, and export a
              PowerPoint deck from canvas data
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {/* Per-widget export is available in each widget's context menu */}
    </div>
  );
}
