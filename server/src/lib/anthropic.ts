/**
 * Shared Anthropic client and call helpers.
 *
 * Improvements over the previous per-call ad-hoc usage:
 *  - Prompt caching: large static instruction blocks live in the `system` field and
 *    are cached, so they are not re-billed on every call.
 *  - Structured output via tool use: JSON responses are returned through a forced
 *    tool call, which is guaranteed parseable — this removes the brittle
 *    `extractJson()` (first-`{` to last-`}`) heuristic and its silent fallbacks.
 *  - Truncation guards: every helper throws on `stop_reason === 'max_tokens'` so a
 *    half-written legal document is never persisted as if it were complete.
 */

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-sonnet-4-6';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 4,
  timeout: 120_000,
});

/** Wrap static instruction text as a cached system block (≈90% input-token savings on repeats). */
export function systemCached(text: string): Anthropic.Messages.TextBlockParam[] {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

export interface JsonCallOpts {
  /** Static, cacheable system/instruction text. */
  system: string;
  /** Dynamic, case-specific prompt. */
  prompt: string;
  /** JSON schema describing the tool input the model must return. */
  schema: Record<string, unknown>;
  maxTokens: number;
  label: string;
  toolName?: string;
}

/** Get a structured JSON result via a forced tool call. Guaranteed valid JSON or throws. */
export async function generateJSON<T>(opts: JsonCallOpts): Promise<T> {
  const toolName = opts.toolName ?? 'result';
  const start = Date.now();
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens,
    system: systemCached(opts.system),
    tools: [{ name: toolName, description: 'Return the structured result for this task.', input_schema: opts.schema as Anthropic.Messages.Tool.InputSchema }],
    tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content: opts.prompt }],
  });
  console.log(`[claude] fn=${opts.label} ms=${Date.now() - start} stop=${resp.stop_reason} in=${resp.usage?.input_tokens} out=${resp.usage?.output_tokens} cacheRead=${resp.usage?.cache_read_input_tokens ?? 0}`);
  if (resp.stop_reason === 'max_tokens') {
    throw new Error(`${opts.label} truncated at max_tokens (out=${resp.usage?.output_tokens}) — raise the cap or reduce input`);
  }
  const toolBlock = resp.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
  if (!toolBlock) throw new Error(`${opts.label}: model did not return a tool_use block`);
  return toolBlock.input as T;
}

export interface HtmlCallOpts {
  system: string;
  prompt: string;
  maxTokens: number;
  label: string;
}

/** Get a raw-HTML document. Strips accidental code fences; throws on truncation. */
export async function generateHTML(opts: HtmlCallOpts): Promise<string> {
  const start = Date.now();
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens,
    system: systemCached(opts.system),
    messages: [{ role: 'user', content: opts.prompt }],
  });
  console.log(`[claude] fn=${opts.label} ms=${Date.now() - start} stop=${resp.stop_reason} in=${resp.usage?.input_tokens} out=${resp.usage?.output_tokens} cacheRead=${resp.usage?.cache_read_input_tokens ?? 0}`);
  if (resp.stop_reason === 'max_tokens') {
    throw new Error(`${opts.label} truncated at max_tokens (out=${resp.usage?.output_tokens}) — document too long for the current cap`);
  }
  const block = resp.content[0];
  if (!block || block.type !== 'text') throw new Error(`${opts.label}: unexpected non-text response`);
  return block.text.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}
