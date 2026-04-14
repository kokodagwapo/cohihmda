/**
 * OpenAI Chat Completions compatibility helper.
 *
 * Handles token parameter differences across model families:
 * - gpt-5 / o-series prefer `max_completion_tokens`
 * - older chat-completions models accept `max_tokens`
 *
 * If the first attempt fails with an unsupported token parameter error,
 * retries once with the alternate parameter.
 */

export async function postOpenAIChatCompletions(
  apiKey: string,
  bodyBase: Record<string, unknown>,
  maxTokens?: number,
): Promise<Response> {
  const model = String(bodyBase.model || "");
  const prefersCompletionTokens = /^(gpt-5|o3|o4)/i.test(model);

  const post = (body: Record<string, unknown>) =>
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

  const withTokenParam = (useCompletionTokens: boolean): Record<string, unknown> => {
    if (maxTokens == null) return { ...bodyBase };
    return {
      ...bodyBase,
      ...(useCompletionTokens
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
    };
  };

  let response = await post(withTokenParam(prefersCompletionTokens));
  if (response.ok) return response;

  let errMsg = "";
  try {
    const err = (await response.json()) as { error?: { message?: string } };
    errMsg = err.error?.message || "";
  } catch {
    // Ignore parse errors; return original response below.
  }

  const unsupportedMaxTokens =
    /unsupported parameter:\s*'max_tokens'/i.test(errMsg);
  const unsupportedMaxCompletionTokens =
    /unsupported parameter:\s*'max_completion_tokens'/i.test(errMsg);

  if (!unsupportedMaxTokens && !unsupportedMaxCompletionTokens) {
    // Return first response as-is for caller to handle.
    return response;
  }

  // Retry once with alternate token parameter.
  response = await post(
    withTokenParam(unsupportedMaxTokens ? true : false),
  );
  return response;
}

