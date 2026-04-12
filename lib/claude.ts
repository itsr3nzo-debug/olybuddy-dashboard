// Claude API wrapper — model stratification (Haiku for routine, Sonnet for complex)
// Uses native fetch, no SDK dependency (matches twilio.ts pattern)

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const API_URL = "https://api.anthropic.com/v1/messages";

type ModelTier = "haiku" | "sonnet" | "auto";

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeOptions {
  model?: ModelTier;
  maxTokens?: number;
  temperature?: number;
}

interface ClaudeResult {
  response: string;
  model: string;
  tokens: { input: number; output: number };
  durationMs: number;
}

// Model IDs — update when new versions release
const MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6-20260401",
};

// Keywords that trigger Sonnet (complex queries needing better reasoning)
const COMPLEX_PATTERNS = [
  /complain|complaint|unhappy|angry|furious|terrible/i,
  /negotiate|discount|reduce|lower.*price|too.*expensive/i,
  /emergency|urgent|flood|leak|burst|fire/i,
  /schedule.*multiple|reschedule.*and|cancel.*and.*book/i,
  /quote.*for.*and.*and/i, // multi-item quotes
  /legal|insurance|liability|guarantee|warranty/i,
];

function detectComplexity(message: string): ModelTier {
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(message)) return "sonnet";
  }
  return "haiku";
}

function resolveModel(tier: ModelTier, latestMessage: string): string {
  if (tier === "auto") {
    const detected = detectComplexity(latestMessage);
    return MODELS[detected as keyof typeof MODELS] || MODELS.haiku;
  }
  if (tier === "haiku" || tier === "sonnet") {
    return MODELS[tier];
  }
  return MODELS.haiku;
}

export async function generateResponse(
  systemPrompt: string,
  messages: ClaudeMessage[],
  options: ClaudeOptions = {}
): Promise<ClaudeResult> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const latestMessage = messages[messages.length - 1]?.content || "";
  const modelTier = options.model || "auto";
  const modelId = resolveModel(modelTier, latestMessage);
  const maxTokens = options.maxTokens || 1024;
  const temperature = options.temperature ?? 0.7;

  const startTime = Date.now();

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[claude] API error ${response.status}: ${errorBody}`);
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const elapsed = Date.now() - startTime;

  const text =
    data.content?.[0]?.type === "text"
      ? data.content[0].text
      : "I apologise, I couldn't process that request. Please try again.";

  return {
    response: text,
    model: modelId,
    tokens: {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
    },
    durationMs: elapsed,
  };
}
