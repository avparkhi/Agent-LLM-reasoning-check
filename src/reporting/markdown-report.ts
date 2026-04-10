/**
 * Markdown report generator.
 *
 * Transforms EvaluationResults into a structured Markdown document with:
 *   - Executive Summary
 *   - Model Comparison Table
 *   - Scoring Breakdown (Unicode bar charts)
 *   - Cost & Latency Analysis
 *   - Per-Test Results (collapsible)
 *   - Methodology
 *   - Configuration
 */

import type { EvaluationResults } from "../evaluation/engine.js";
import type { ModelMetrics } from "../evaluation/metrics.js";

// ---------------------------------------------------------------------------
// Unicode bar chart helper
// ---------------------------------------------------------------------------

const FULL_BLOCK = "█";
const EMPTY_BLOCK = "░";
const BAR_WIDTH = 10;

/**
 * Render a Unicode bar for `value` out of `max` in `width` characters.
 * Example: barChart(4.2, 5) → "████████░░ 4.2/5"
 */
function barChart(value: number, max: number, width = BAR_WIDTH): string {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = FULL_BLOCK.repeat(filled) + EMPTY_BLOCK.repeat(empty);
  return `${bar} ${value.toFixed(2)}/${max}`;
}

// ---------------------------------------------------------------------------
// Table helpers
// ---------------------------------------------------------------------------

function mdTable(headers: string[], rows: string[][]): string {
  const headerRow = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataRows = rows.map((row) => `| ${row.join(" | ")} |`);
  return [headerRow, separator, ...dataRows].join("\n");
}

// ---------------------------------------------------------------------------
// Known max scores per evaluator
// ---------------------------------------------------------------------------

const EVALUATOR_MAX: Record<string, number> = {
  helpfulness: 5,
  coherence: 5,
  faithfulness: 5,
  toolAccuracy: 5,
  trajectory: 5,
  conciseness: 3,
};

function maxScoreForEvaluator(name: string): number {
  return EVALUATOR_MAX[name] ?? 5;
}

// ---------------------------------------------------------------------------
// Section generators
// ---------------------------------------------------------------------------

function executiveSummary(results: EvaluationResults): string {
  const { bestModel } = results;
  const { model, reasoning } = bestModel;

  const lines: string[] = [
    "## Executive Summary",
    "",
    `**Best Model:** ${model.label}  `,
    `**Overall Score:** ${model.overallScore}/100`,
    "",
    reasoning,
    "",
    `Based on evaluations across ${results.metrics.length} model(s) and ` +
      `${new Set(results.results.map((r) => r.testCaseId)).size} test case(s), ` +
      `${model.label} demonstrated the strongest combined performance across quality, ` +
      `latency, and cost dimensions.`,
  ];

  return lines.join("\n");
}

function modelComparisonTable(results: EvaluationResults): string {
  const headers = [
    "Model",
    "Overall",
    "Helpfulness",
    "Coherence",
    "Faithfulness",
    "Tool Accuracy",
    "Trajectory",
    "Latency (ms)",
    "Cost ($)",
  ];

  const rows = results.metrics.map((m) => [
    m.label,
    m.overallScore.toFixed(2),
    (m.avgScores["helpfulness"] ?? 0).toFixed(2),
    (m.avgScores["coherence"] ?? 0).toFixed(2),
    (m.avgScores["faithfulness"] ?? 0).toFixed(2),
    (m.avgScores["toolAccuracy"] ?? 0).toFixed(2),
    (m.avgScores["trajectory"] ?? 0).toFixed(2),
    m.avgLatencyMs.toString(),
    m.totalCost.toFixed(6),
  ]);

  return ["## Model Comparison Table", "", mdTable(headers, rows)].join("\n");
}

function scoringBreakdown(results: EvaluationResults): string {
  // Collect all evaluator names that appear in any model
  const evalNames = new Set<string>();
  for (const m of results.metrics) {
    for (const name of Object.keys(m.avgScores)) {
      evalNames.add(name);
    }
  }

  const lines: string[] = ["## Scoring Breakdown", ""];

  for (const evalName of evalNames) {
    lines.push(`### ${evalName}`);
    lines.push("");

    const maxScore = maxScoreForEvaluator(evalName);

    for (const m of results.metrics) {
      const avg = m.avgScores[evalName];
      if (avg === undefined) {
        lines.push(`**${m.label}:** _(not evaluated)_`);
      } else {
        lines.push(`**${m.label}:** \`${barChart(avg, maxScore)}\``);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function costLatencyAnalysis(results: EvaluationResults): string {
  const headers = ["Model", "Avg Latency (ms)", "P95 Latency (ms)", "Total Cost ($)", "Cost / 1K invocations ($)"];

  // Count unique invocations per model
  const invocationCounts: Record<string, number> = {};
  for (const r of results.results) {
    invocationCounts[r.modelId] = (invocationCounts[r.modelId] ?? 0) + 1;
  }

  const rows = results.metrics.map((m) => {
    const count = invocationCounts[m.modelId] ?? 1;
    const costPer1K = count > 0 ? (m.totalCost / count) * 1000 : 0;
    return [
      m.label,
      m.avgLatencyMs.toString(),
      m.p95LatencyMs.toString(),
      m.totalCost.toFixed(6),
      costPer1K.toFixed(6),
    ];
  });

  return ["## Cost & Latency Analysis", "", mdTable(headers, rows)].join("\n");
}

function perTestResults(results: EvaluationResults): string {
  // Group results by test case
  const byTestCase = new Map<string, typeof results.results>();
  for (const r of results.results) {
    const group = byTestCase.get(r.testCaseId) ?? [];
    group.push(r);
    byTestCase.set(r.testCaseId, group);
  }

  const lines: string[] = ["## Per-Test Results", ""];

  for (const [testCaseId, caseResults] of byTestCase) {
    lines.push(`<details>`);
    lines.push(`<summary><strong>${testCaseId}</strong></summary>`);
    lines.push("");

    // Group by model within this test case
    const byModel = new Map<string, typeof caseResults>();
    for (const r of caseResults) {
      const group = byModel.get(r.modelId) ?? [];
      group.push(r);
      byModel.set(r.modelId, group);
    }

    for (const [modelId, modelRuns] of byModel) {
      // Find the model label
      const metric = results.metrics.find((m) => m.modelId === modelId);
      const label = metric?.label ?? modelId;

      lines.push(`#### ${label}`);
      lines.push("");

      for (const run of modelRuns) {
        lines.push(`**Run ${run.runIndex + 1}**`);

        if (run.error) {
          lines.push(`- Error: ${run.error}`);
        } else {
          lines.push(`- Latency: ${run.response.latencyMs}ms`);
          lines.push(`- Tokens: ${run.response.usage.totalTokens} (${run.response.usage.inputTokens} in / ${run.response.usage.outputTokens} out)`);

          if (run.response.toolCalls.length > 0) {
            const toolNames = run.response.toolCalls.map((tc) => tc.name).join(", ");
            lines.push(`- Tools called: ${toolNames}`);
          }

          // Scores
          if (Object.keys(run.scores).length > 0) {
            lines.push("- Scores:");
            for (const [evalName, score] of Object.entries(run.scores)) {
              lines.push(`  - ${evalName}: ${score.score}/${score.maxScore}`);
              if (score.reasoning) {
                lines.push(`    - _${score.reasoning}_`);
              }
            }
          }
        }

        lines.push("");
      }
    }

    lines.push(`</details>`);
    lines.push("");
  }

  return lines.join("\n");
}

function methodology(results: EvaluationResults): string {
  const { config, timestamp } = results;
  const { evaluation } = config;

  const evaluators = evaluation.evaluators.join(", ");
  const judgeLabel = evaluation.judgeModel?.label ?? evaluation.judgeModel?.modelId ?? "N/A";

  const lines: string[] = [
    "## Methodology",
    "",
    `- **Evaluators:** ${evaluators}`,
    `- **Judge Model:** ${judgeLabel}`,
    `- **Runs per Test:** ${evaluation.runsPerTest}`,
    `- **Timestamp:** ${timestamp}`,
  ];

  return lines.join("\n");
}

function configuration(results: EvaluationResults): string {
  const { config } = results;

  const modelList = config.models.map((m) => `  - ${m.label ?? m.modelId} (${m.provider})`).join("\n");

  const lines: string[] = [
    "## Configuration",
    "",
    `- **Agent:** ${config.agent.name}`,
    `- **Models Evaluated:**`,
    modelList,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a Markdown report from evaluation results.
 *
 * @param results - Full evaluation results from EvaluationEngine.
 * @returns A complete Markdown string.
 */
export function generateMarkdownReport(results: EvaluationResults): string {
  const title = `# Agent Evaluation Report — ${results.config.agent.name}`;
  const generated = `_Generated: ${results.timestamp}_`;

  const sections = [
    title,
    generated,
    "",
    executiveSummary(results),
    "",
    modelComparisonTable(results),
    "",
    scoringBreakdown(results),
    "",
    costLatencyAnalysis(results),
    "",
    perTestResults(results),
    "",
    methodology(results),
    "",
    configuration(results),
  ];

  return sections.join("\n");
}
