export type QueryParams = object;

/** Appends defined query parameters without leaving an empty `?`. */
export function appendQuery(path: string, params?: QueryParams): string {
  if (!params) return path;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const value = query.toString();
  return value ? `${path}${path.includes("?") ? "&" : "?"}${value}` : path;
}
