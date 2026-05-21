/** Authenticated fullscreen Cohi chat landing at site root. */
export function isChatHomePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === "/";
}

/** Resume a unified conversation on the chat home route. */
export function buildUnifiedChatResumePath(
  conversationId: string,
  chatType: string,
): string {
  const params = new URLSearchParams({
    resume: conversationId,
    mode: chatType,
  });
  return `/?${params.toString()}`;
}