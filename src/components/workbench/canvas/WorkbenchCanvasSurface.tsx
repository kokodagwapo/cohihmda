import type { ReactNode } from "react";

export type WorkbenchCanvasSurfaceProps = {
  canvasContentWidth: number;
  canvasContentHeight: number;
  /** Comma-separated widget titles for e2e canvas state probes */
  widgetTitleSummary?: string;
  children: ReactNode;
};

/** Freeform canvas grid wrapper (resize handles + item layer). */
export function WorkbenchCanvasSurface({
  canvasContentWidth,
  canvasContentHeight,
  widgetTitleSummary,
  children,
}: WorkbenchCanvasSurfaceProps) {
  return (
    <>
      <style>{`
            .canvas-freeform .react-resizable-handle {
              opacity: 0;
              z-index: 20;
              width: 14px;
              height: 14px;
            }
            .canvas-freeform .canvas-item:hover .react-resizable-handle {
              opacity: 1;
            }
            .canvas-freeform .react-resizable-handle-se::after,
            .canvas-freeform .react-resizable-handle-sw::after,
            .canvas-freeform .react-resizable-handle-ne::after,
            .canvas-freeform .react-resizable-handle-nw::after {
              right: 2px;
              bottom: 2px;
              width: 7px;
              height: 7px;
              border-right-width: 2px;
              border-bottom-width: 2px;
              border-color: rgba(100, 116, 139, 0.6);
            }
          `}</style>
      <div
        data-testid="canvas-widget-titles"
        aria-label={widgetTitleSummary ?? ""}
        className="relative"
        style={{
          width: canvasContentWidth,
          minHeight: canvasContentHeight,
        }}
      >
        {children}
      </div>
    </>
  );
}
