/**
 * LLM Service — Anthropic Claude
 * Uses the Anthropic Messages API with server-sent events (SSE) streaming.
 * Converts the internal message/tool format to Claude's native schema.
 */
import AppConfig from "./config.server";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";


const _promptsFile = resolve(dirname(fileURLToPath(import.meta.url)), "../prompts/prompts.json");

// ── Prompts cache ─────────────────────────────────────────────────────────────
// Read and parse prompts.json exactly once (on first use) and cache the result.
// Reading from disk on every request adds unnecessary I/O under load.
// Validation runs at startup so a missing/malformed file fails fast.
let _cachedPrompts = null;

/** Validates that prompts.json exists and is parseable at server startup. */
function validatePromptsFile() {
  try {
    const raw = readFileSync(_promptsFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed?.systemPrompts) {
      throw new Error('prompts.json is missing the "systemPrompts" key.');
    }
    _cachedPrompts = parsed;
    console.log(`[claude] Loaded ${Object.keys(parsed.systemPrompts).length} system prompt(s) from prompts.json`);
  } catch (err) {
    throw new Error(
      `[startup] Failed to load prompts.json at ${_promptsFile}: ${err.message}\n` +
      'Ensure the file exists and contains valid JSON with a "systemPrompts" object.'
    );
  }
}

// Run validation immediately at module load time (server startup)
validatePromptsFile();

/** Return cached prompts — loads from disk only if cache is empty. */
function loadSystemPrompts() {
  if (!_cachedPrompts) validatePromptsFile(); // safety: should already be set
  return _cachedPrompts;
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION  = "2023-06-01";

/**
 * Creates a Claude service instance.
 * @param {string} apiKey - Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
 */
export function createClaudeService(apiKey = process.env.ANTHROPIC_API_KEY) {
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY. Set it in your environment.");
  }

  const streamConversation = async ({
    messages,
    promptType = AppConfig.api.defaultPromptType,
    tools,
    storeKnowledgeSummary,
  }, streamHandlers) => {
    // Build system prompt — store knowledge prepended when available
    let systemPrompt = getSystemPrompt(promptType);
    if (storeKnowledgeSummary) {
      systemPrompt = storeKnowledgeSummary + "\n\n" + systemPrompt;
    }

    const model = process.env.ANTHROPIC_MODEL || AppConfig.api.defaultModel;

    // ── Prompt caching setup ─────────────────────────────────────────────
    // 1. System prompt: passed as an array block so we can attach
    //    cache_control. Claude caches everything up to each breakpoint
    //    for ~5 minutes; cached tokens cost 90% less.
    const systemBlock = [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    ];

    // 2. Conversation history: build Claude messages, then stamp a cache
    //    breakpoint on the last "already-seen" message (second-to-last).
    //    The final message is always the fresh user input — never cached.
    const claudeMessages = toClaudeMessages(messages);
    if (claudeMessages.length >= 2) {
      const prev = claudeMessages[claudeMessages.length - 2];
      if (typeof prev.content === "string") {
        // Convert bare string to a content array so we can attach cache_control.
        prev.content = [{ type: "text", text: prev.content, cache_control: { type: "ephemeral" } }];
      } else if (Array.isArray(prev.content) && prev.content.length > 0) {
        prev.content[prev.content.length - 1].cache_control = { type: "ephemeral" };
      }
    }

    const requestBody = {
      model,
      max_tokens: AppConfig.api.maxTokens,
      system: systemBlock,
      messages: claudeMessages,
      stream: true,
      ...(tools && tools.length > 0 ? { tools: toClaudeTools(tools) } : {}),
    };

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta":    "prompt-caching-2024-07-31",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      const err = new Error(
        `[Anthropic Error]: [${response.status} ${response.statusText}] ${errText}`
      );
      err.status = response.status;
      throw err;
    }

    // ── Parse the SSE stream ─────────────────────────────────────────────
    // Claude sends:  event: <type>\ndata: <json>\n\n
    // The JSON payload always carries a `type` field matching the event name,
    // so we only need to parse `data:` lines.
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";

    // Content blocks indexed by position (text blocks and tool_use blocks).
    const contentBlocks = {};
    let stopReason = "end_turn";

    const handleClaudeEvent = (event) => {
      switch (event.type) {
        case "message_start":
          break;

        case "content_block_start": {
          const { type, id, name } = event.content_block;
          contentBlocks[event.index] = {
            type,
            id:        id   || null,
            name:      name || null,
            text:      "",
            inputJson: "",
          };
          break;
        }

        case "content_block_delta": {
          const blk = contentBlocks[event.index];
          if (!blk) break;
          if (event.delta.type === "text_delta") {
            blk.text += event.delta.text;
            if (streamHandlers.onText) streamHandlers.onText(event.delta.text);
          } else if (event.delta.type === "input_json_delta") {
            blk.inputJson += event.delta.partial_json;
          }
          break;
        }

        case "content_block_stop":
          break;

        case "message_delta":
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
          break;

        case "message_stop":
          break;

        case "error": {
          const msg = event.error?.message || JSON.stringify(event.error);
          const apiErr = new Error(`[Anthropic Stream Error]: ${msg}`);
          apiErr.status = event.error?.type;
          throw apiErr;
        }

        default:
          break;
      }
    };

    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) return;
      const raw = trimmed.slice(5).trim();
      if (!raw || raw === "[DONE]") return;
      let event;
      try { event = JSON.parse(raw); } catch { return; }
      handleClaudeEvent(event);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer  = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    }
    if (lineBuffer.trim()) processLine(lineBuffer);

    // ── Assemble normalised message content ──────────────────────────────
    const messageContent = [];
    let toolUseCount = 0;

    const sortedEntries = Object.entries(contentBlocks).sort(([a], [b]) => +a - +b);
    for (const [, blk] of sortedEntries) {
      if (blk.type === "text" && blk.text) {
        messageContent.push({ type: "text", text: blk.text });
      } else if (blk.type === "tool_use") {
        toolUseCount++;
        let input = {};
        try { input = JSON.parse(blk.inputJson || "{}"); } catch {}
        messageContent.push({ type: "tool_use", id: blk.id, name: blk.name, input });
      }
    }

    const finalMessage = {
      role:        "assistant",
      content:     messageContent,
      stop_reason: toolUseCount > 0 ? "tool_use" : stopReason,
    };

    if (streamHandlers.onMessage)      streamHandlers.onMessage(finalMessage);
    if (streamHandlers.onContentBlock) {
      for (const block of messageContent) {
        if (block.type === "text") streamHandlers.onContentBlock(block);
      }
    }
    if (streamHandlers.onToolUse) {
      for (const block of messageContent) {
        if (block.type === "tool_use") await streamHandlers.onToolUse(block);
      }
    }

    return finalMessage;
  };

  const getSystemPrompt = (promptType) => {
    const systemPrompts = loadSystemPrompts();
    return systemPrompts.systemPrompts[promptType]?.content ||
      systemPrompts.systemPrompts[AppConfig.api.defaultPromptType].content;
  };

  return { streamConversation, getSystemPrompt };
}

export default { createClaudeService };

// ── Message conversion ───────────────────────────────────────────────────────

/**
 * Convert internal message history to Claude's messages array format.
 * The internal format already uses Claude-native block types (text, tool_use,
 * tool_result), so the conversion is straightforward.
 */
function toClaudeMessages(messages = []) {
  const result = [];

  for (const message of messages) {
    const { role, content } = message;

    if (typeof content === "string") {
      if (content.trim()) result.push({ role, content });
      continue;
    }

    if (!Array.isArray(content)) {
      const str = String(content ?? "").trim();
      if (str) result.push({ role, content: str });
      continue;
    }

    const claudeContent = content
      .filter(blk => blk && typeof blk === "object")
      .map(blk => {
        if (blk.type === "text") {
          return blk.text ? { type: "text", text: blk.text } : null;
        }
        if (blk.type === "tool_use") {
          return { type: "tool_use", id: blk.id, name: blk.name, input: blk.input || {} };
        }
        if (blk.type === "tool_result") {
          return {
            type:        "tool_result",
            tool_use_id: blk.tool_use_id,
            content:     normalizeToolResultContent(blk.content),
          };
        }
        return null;
      })
      .filter(Boolean);

    if (claudeContent.length > 0) result.push({ role, content: claudeContent });
  }

  return result;
}

/** Normalise tool result content to a string (Claude's preferred format). */
function normalizeToolResultContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter(b => b?.type === "text" && b.text)
      .map(b => b.text)
      .join("\n");
    return text || JSON.stringify(content);
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  return String(content ?? "");
}

// ── Tool conversion ──────────────────────────────────────────────────────────

/**
 * Convert MCP-style tool definitions to Claude's tools format.
 * Claude accepts standard JSON Schema for input_schema.
 */
function toClaudeTools(tools) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(tool => ({
    name:         tool.name,
    description:  tool.description,
    input_schema: sanitizeClaudeSchema(tool.input_schema),
  }));
}

function sanitizeClaudeSchema(schema) {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }

  const result = { type: schema.type || "object" };

  if (schema.description) result.description = schema.description;
  if (Array.isArray(schema.enum)) result.enum = schema.enum;

  if (schema.properties && typeof schema.properties === "object") {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, sanitizeClaudeSchema(v)])
    );
  }

  if (schema.items) result.items = sanitizeClaudeSchema(schema.items);

  if (result.type === "object" && Array.isArray(schema.required) && result.properties) {
    const validKeys = Object.keys(result.properties);
    const req = schema.required.filter(k => typeof k === "string" && validKeys.includes(k));
    if (req.length > 0) result.required = req;
  }

  if (result.type === "object" && !result.properties) result.properties = {};

  return result;
}
