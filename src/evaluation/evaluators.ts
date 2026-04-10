/**
 * Evaluator functions for scoring model responses.
 *
 * Evaluators are organized in cost order:
 *   1. Deterministic (free) — toolAccuracy, trajectory
 *   2. LLM-as-judge (expensive) — helpfulness, coherence, faithfulness, conciseness
 *
 * Each evaluator returns an EvaluatorScore with a name, numeric score,
 * maximum possible score, and optional reasoning text.
 */

import type { EvaluatorScore, ModelProvider, ModelResponse, TestCase } from "../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a numeric score out of a judge response.
 * Looks for patterns like "Score: 4", "Rating: 3/5", a bare digit, etc.
 */
function parseJudgeScore(text: string, maxScore: number): number | null {
  // "Score: N" or "Rating: N" (case-insensitive)
  const labeled = text.match(/(?:score|rating)\s*:\s*(\d+(?:\.\d+)?)/i);
  if (labeled) {
    const val = parseFloat(labeled[1]);
    return Number.isFinite(val) ? Math.min(val, maxScore) : null;
  }

  // "N/maxScore" pattern
  const fraction = text.match(/(\d+(?:\.\d+)?)\s*\/\s*\d+/);
  if (fraction) {
    const val = parseFloat(fraction[1]);
    return Number.isFinite(val) ? Math.min(val, maxScore) : null;
  }

  // Bare single digit on its own line or at start/end
  const bare = text.match(/(?:^|\n)\s*(\d)\s*(?:\n|$)/);
  if (bare) {
    const val = parseInt(bare[1], 10);
    return Number.isFinite(val) ? Math.min(val, maxScore) : null;
  }

  // Last resort: first standalone integer ≤ maxScore in the entire text
  const allDigits = text.match(/\b(\d+)\b/g);
  if (allDigits) {
    for (const d of allDigits) {
      const val = parseInt(d, 10);
      if (val >= 1 && val <= maxScore) return val;
    }
  }

  return null;
}

/**
 * Call a judge provider with a prompt and parse out score + reasoning.
 */
async function judgeEval(
  judgeProvider: ModelProvider,
  prompt: string,
  maxScore: number,
  evaluatorName: string,
): Promise<EvaluatorScore> {
  let raw: string;
  try {
    const response = await judgeProvider.invoke([
      { role: "user", content: prompt },
    ]);
    raw = response.content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: evaluatorName,
      score: 0,
      maxScore,
      reasoning: `Judge invocation failed: ${message}`,
    };
  }

  const score = parseJudgeScore(raw, maxScore);
  if (score === null) {
    return {
      name: evaluatorName,
      score: 0,
      maxScore,
      reasoning: `Failed to parse score from judge response: ${raw.slice(0, 200)}`,
    };
  }

  return {
    name: evaluatorName,
    score,
    maxScore,
    reasoning: raw,
  };
}

// ---------------------------------------------------------------------------
// 1. Tool Accuracy Evaluator (deterministic)
// ---------------------------------------------------------------------------

/**
 * Compare the expected tool calls with what the model actually called.
 * Score = (number of expected tools that were called) / (total expected) * 5.
 *
 * If no expected tool calls are defined, the evaluator is skipped
 * (score 0, maxScore 0).
 */
export function toolAccuracyEvaluator(
  response: ModelResponse,
  testCase: TestCase,
): EvaluatorScore {
  const name = "toolAccuracy";

  if (!testCase.expectedToolCalls || testCase.expectedToolCalls.length === 0) {
    return { name, score: 0, maxScore: 0, reasoning: "No expected tool calls defined — skipped." };
  }

  const calledNames = new Set(response.toolCalls.map((tc) => tc.name));
  const correct = testCase.expectedToolCalls.filter((t) => calledNames.has(t)).length;
  const total = testCase.expectedToolCalls.length;

  const score = total > 0 ? (correct / total) * 5 : 0;

  return {
    name,
    score: Math.round(score * 100) / 100,
    maxScore: 5,
    reasoning:
      `${correct}/${total} expected tools called. ` +
      `Expected: [${testCase.expectedToolCalls.join(", ")}]. ` +
      `Actual: [${response.toolCalls.map((tc) => tc.name).join(", ")}].`,
  };
}

// ---------------------------------------------------------------------------
// 2. Trajectory Evaluator (deterministic)
// ---------------------------------------------------------------------------

/**
 * Compare the ORDER in which tools were called against the expected sequence.
 *
 * Strict mode:
 *   - Perfect sequence match → 5
 *   - Partial credit: for each position where the actual call matches the
 *     expected call, add (5 / total) points.
 *
 * If no expected tool calls are defined, the evaluator is skipped.
 */
export function trajectoryEvaluator(
  response: ModelResponse,
  testCase: TestCase,
): EvaluatorScore {
  const name = "trajectory";

  if (!testCase.expectedToolCalls || testCase.expectedToolCalls.length === 0) {
    return { name, score: 0, maxScore: 0, reasoning: "No expected tool calls defined — skipped." };
  }

  const expected = testCase.expectedToolCalls;
  const actual = response.toolCalls.map((tc) => tc.name);

  if (expected.length === 0) {
    return { name, score: 5, maxScore: 5, reasoning: "No expected calls — perfect by default." };
  }

  // Count matching positions
  const maxLen = expected.length;
  let matchCount = 0;
  for (let i = 0; i < maxLen; i++) {
    if (actual[i] === expected[i]) {
      matchCount++;
    }
  }

  const isExact = matchCount === maxLen && actual.length === expected.length;
  const score = isExact ? 5 : Math.round((matchCount / maxLen) * 5 * 100) / 100;

  return {
    name,
    score,
    maxScore: 5,
    reasoning:
      isExact
        ? "Exact sequence match."
        : `${matchCount}/${maxLen} positions matched in order. ` +
          `Expected: [${expected.join(", ")}]. ` +
          `Actual: [${actual.join(", ")}].`,
  };
}

// ---------------------------------------------------------------------------
// 3. Helpfulness Evaluator (LLM-as-judge)
// ---------------------------------------------------------------------------

/**
 * Ask a judge model to rate how helpful the response is on a 1–5 scale.
 */
export async function helpfulnessEvaluator(
  judgeProvider: ModelProvider,
  input: string,
  response: string,
): Promise<EvaluatorScore> {
  const prompt = `You are an impartial evaluator assessing the helpfulness of an AI assistant's response.

USER INPUT:
${input}

ASSISTANT RESPONSE:
${response}

Rate the helpfulness of the assistant's response on a scale of 1 to 5 using this rubric:
1 = Not helpful — fails to address the user's request or provides incorrect information.
2 = Slightly helpful — partially addresses the request but misses key points.
3 = Moderately helpful — addresses the main request but could be more complete or accurate.
4 = Very helpful — thoroughly addresses the request with accurate, useful information.
5 = Exceptionally helpful — goes above and beyond, providing comprehensive and insightful assistance.

Respond in this exact format:
Score: <number>
Reasoning: <one or two sentences explaining your rating>`;

  return judgeEval(judgeProvider, prompt, 5, "helpfulness");
}

// ---------------------------------------------------------------------------
// 4. Coherence Evaluator (LLM-as-judge)
// ---------------------------------------------------------------------------

/**
 * Ask a judge model to rate the logical coherence and clarity of the response.
 */
export async function coherenceEvaluator(
  judgeProvider: ModelProvider,
  input: string,
  response: string,
): Promise<EvaluatorScore> {
  const prompt = `You are an impartial evaluator assessing the logical coherence and clarity of an AI assistant's response.

USER INPUT:
${input}

ASSISTANT RESPONSE:
${response}

Rate the coherence and clarity of the assistant's response on a scale of 1 to 5 using this rubric:
1 = Incoherent — the response is confusing, contradictory, or very hard to follow.
2 = Poorly structured — some logical flow but with notable gaps or contradictions.
3 = Acceptable — generally logical and clear but with some organizational issues.
4 = Well structured — clearly written with a logical flow and no notable contradictions.
5 = Excellent — exceptionally clear, well-organized, and logically consistent throughout.

Respond in this exact format:
Score: <number>
Reasoning: <one or two sentences explaining your rating>`;

  return judgeEval(judgeProvider, prompt, 5, "coherence");
}

// ---------------------------------------------------------------------------
// 5. Faithfulness Evaluator (LLM-as-judge)
// ---------------------------------------------------------------------------

/**
 * Score whether the response faithfully contains the expected facts.
 * Only runs when expectedFacts are provided; skipped otherwise.
 */
export async function faithfulnessEvaluator(
  judgeProvider: ModelProvider,
  input: string,
  response: string,
  expectedFacts: string[],
): Promise<EvaluatorScore> {
  const name = "faithfulness";

  if (!expectedFacts || expectedFacts.length === 0) {
    return { name, score: 0, maxScore: 0, reasoning: "No expected facts defined — skipped." };
  }

  const factList = expectedFacts.map((f, i) => `${i + 1}. ${f}`).join("\n");

  const prompt = `You are an impartial evaluator checking whether an AI assistant's response is faithful to a set of expected facts.

USER INPUT:
${input}

ASSISTANT RESPONSE:
${response}

EXPECTED FACTS (all should appear in the response):
${factList}

Count how many of the ${expectedFacts.length} expected fact(s) are present (directly stated or clearly implied) in the response.
Then compute: Score = (facts present / total facts) * 5, rounded to one decimal place.

Respond in this exact format:
Score: <number>
Reasoning: <brief explanation of which facts are present or missing>`;

  return judgeEval(judgeProvider, prompt, 5, name);
}

// ---------------------------------------------------------------------------
// 6. Conciseness Evaluator (LLM-as-judge)
// ---------------------------------------------------------------------------

/**
 * Rate how concise the response is relative to the complexity of the request.
 * Uses a 1–3 scale (maxScore = 3) to reflect brevity vs completeness.
 */
export async function concisenessEvaluator(
  judgeProvider: ModelProvider,
  input: string,
  response: string,
): Promise<EvaluatorScore> {
  const prompt = `You are an impartial evaluator assessing the conciseness of an AI assistant's response.

USER INPUT:
${input}

ASSISTANT RESPONSE:
${response}

Rate the conciseness of the response on a scale of 1 to 3 using this rubric:
1 = Too verbose — the response contains significant unnecessary content, repetition, or padding.
2 = Acceptable length — the response is appropriately sized for the request with minor verbosity.
3 = Optimally concise — the response is as brief as possible while remaining complete and accurate.

Respond in this exact format:
Score: <number>
Reasoning: <one sentence explaining your rating>`;

  return judgeEval(judgeProvider, prompt, 3, "conciseness");
}
