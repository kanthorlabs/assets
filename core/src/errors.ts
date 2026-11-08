const REASONS: Record<number, string> = { 404: "Not Found" };

export function errorResponse(status: keyof typeof REASONS): Response {
  return new Response(REASONS[status], {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
