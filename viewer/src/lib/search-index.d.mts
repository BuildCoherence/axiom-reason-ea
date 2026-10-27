// `search-index.json` rows (axiom/scripts/corpus-export README § Index schemas).
export interface ConstantRow {
  def_id: string;
  name: string;
  kind: string;
  type_head: string | null;
  file_id: string;
  created_at: string;
  publisher: string | null;
  decl_byte_start: number;
  signature_byte_end: number;
  declaration_role: string | null;
}

export interface TypeParam {
  index: number;
  name: string;
  type: string;
  binder: string;
}

/** A platform built-in has null file, def, kind and publisher. */
export interface TypeHeadRow {
  type_head: string;
  searchable_name: string;
  arity: number;
  params: TypeParam[];
  file_id: string | null;
  def_id: string | null;
  kind: string | null;
  publisher: string | null;
  created_at: string | null;
}

export interface UserRow {
  username: string;
  first_published_at: string | null;
}

export interface SearchIndex {
  constants: ConstantRow[];
  types: TypeHeadRow[];
  users: UserRow[];
}

export interface SearchSort {
  byName: boolean;
  desc: boolean;
}

export interface SearchFilters {
  kinds?: string[];
  author?: string;
  /** Inclusive lower bound, epoch ms. */
  after?: number | null;
  /** Exclusive upper bound, epoch ms. */
  before?: number | null;
}

export interface Page<T> {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  results: T[];
}

export declare const SEARCH_INDEX_PATH: string;
export declare const DEFAULT_SORT: string;
export declare function parseSort(raw: string): SearchSort | null;
export declare function parseDateBound(raw: string): number | null;
export declare function searchTypes(
  index: SearchIndex,
  query: string,
  filters: SearchFilters,
  sort: SearchSort,
): TypeHeadRow[];
export declare function searchConstants(
  index: SearchIndex,
  query: string,
  filters: SearchFilters,
  sort: SearchSort,
): ConstantRow[];
export declare function searchUsers(index: SearchIndex, query: string, sort: SearchSort): UserRow[];
export declare function queryTypeHead(
  index: SearchIndex,
  typeHead: string,
): { schema: TypeHeadRow | null; rows: ConstantRow[]; known: boolean };
export declare function paginate<T>(rows: T[], limit: number, offset: number): Page<T>;
