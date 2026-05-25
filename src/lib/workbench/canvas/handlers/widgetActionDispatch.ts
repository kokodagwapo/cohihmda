/**
 * Pure widget-action reducers used by WorkbenchCanvas (no React deps).
 */
export {
  applyModifyGroupOperations,
  normalizeWidgetGroupItemsList,
  WIDGET_GROUP_LAYOUT_VERSION,
  type WidgetGroupPayloadShape,
} from "./applyModifyGroupOperations";

export {
  applyModifyRegistryWidget,
  normalizeRegistryGroupItems,
  type RegistryGroupPayloadShape,
} from "./applyModifyRegistryWidget";

export {
  applyDeleteWidgetFromItems,
  DELETE_WIDGET_LAYOUT_VERSION,
  type LayoutItemLike,
} from "./applyDeleteWidgetFromItems";

export { applyConvertToSqlWidget } from "./applyConvertToSqlWidget";
export { applyCreateDashboard } from "./applyCreateDashboard";
export { applyCreateWidget, type CreateWidgetContext } from "./applyCreateWidget";
export {
  applyCreateCanvas,
  type CreateCanvasContext,
  type SectionWidgetsConfig,
} from "./applyCreateCanvas";
export {
  applyModifyWidget,
  mergeVizConfigForModify,
  type ModifyWidgetContext,
} from "./applyModifyWidget";

export type {
  WidgetActionReducerOutcome,
  WidgetActionReducerResult,
  WidgetActionReducerToast,
} from "./widgetActionReducerTypes";
