/**
 * HTTP-shaped errors thrown by services. Kept free of Next.js imports so the
 * worker process can load services without pulling in request-only modules.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "error",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what = "Resource") => new ApiError(404, `${what} not found`, "not_found");
export const badRequest = (message: string, details?: unknown) => new ApiError(400, message, "bad_request", details);
export const conflict = (message: string) => new ApiError(409, message, "conflict");
