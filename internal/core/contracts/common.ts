export interface PaginationOptions {
  skip?: number;
  take?: number;
}

export interface Paged<T> {
  data: T[];
  perPage?: number;
  pageSize: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface IntrospectResult {
  active: boolean;
  sub?: string;
  username?: string | null;
  email?: string | null;
  roles?: string[] | null;
  permissions?: string[];
  client_id?: string;
  scope?: string;
  exp?: number;
  iat?: number;
  jti?: string;
  token_type?: string;
}
