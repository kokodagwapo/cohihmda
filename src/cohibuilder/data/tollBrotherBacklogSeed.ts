/**
 * Toll Brothers backlog import (839 rows) — generated from the official spreadsheet.
 * Regenerate: parse the xlsx with the same column mapping as `parseBuilderImportFile` and write `tollBrotherBacklogSeed.json`.
 */
import type { BuilderImportRow } from './builderImportFields';
import raw from './tollBrotherBacklogSeed.json';

export const tollBrotherBacklogImportRows: BuilderImportRow[] = raw as BuilderImportRow[];
