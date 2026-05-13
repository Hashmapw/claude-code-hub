export interface LegacySearchTermParams {
  searchTerm?: string;
  query?: string;
  keyword?: string;
}

export function resolveLegacySearchTerm(params?: LegacySearchTermParams): string | undefined {
  for (const candidate of [params?.searchTerm, params?.query, params?.keyword]) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}
