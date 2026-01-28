export type SavedViewVisibility = 'private' | 'shared' | 'public';

export type SavedViewsTab = 'my' | 'shared' | 'public' | 'suggested';

export type SavedViewLocation = {
  path: string;
  hash?: string;
  search?: string;
};

export type SavedViewFilters = Record<string, unknown>;

export type SavedView = {
  id: string;
  name: string;
  description?: string;
  filters: SavedViewFilters;
  location?: SavedViewLocation;
  scope?: string;
  sort_state?: Record<string, unknown>;
  visible_columns?: Record<string, unknown>;
  visibility?: SavedViewVisibility;
  shared_roles?: string[];
  shared_users?: string[];
  share_token?: string;
  is_public?: boolean;
  is_owner?: boolean;
  created_at: string;
  updated_at: string;
};

export type SavedViewApplyResult = {
  appliedFilters: string[];
  skippedFilters: string[];
  warnings: string[];
};
