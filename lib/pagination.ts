export function paginationFrom(request: Request, defaultSize = 10) {
  const url = new URL(request.url);
  const requestedPage = Number(url.searchParams.get("page"));
  const requestedSize = Number(url.searchParams.get("pageSize"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100_000) : 1;
  const pageSize = Number.isSafeInteger(requestedSize) && requestedSize > 0 ? Math.min(requestedSize, 50) : defaultSize;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function searchFrom(request: Request) {
  return new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
}
