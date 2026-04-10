/**
 * Self-contained HTML report generator.
 *
 * Produces a fully self-contained HTML file (no external URLs) with:
 *   - Inline CSS (clean, modern look)
 *   - Model comparison table with color-coded cells
 *   - SVG bar charts for score comparison
 *   - Collapsible sections using <details>/<summary>
 *   - Responsive design
 */

import type { EvaluationResults } from "../evaluation/engine.js";
import type { ModelMetrics } from "../evaluation/metrics.js";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/** Interpolate between red (#e74c3c) and green (#2ecc71) for a 0–1 ratio. */
function scoreColor(ratio: number): string {
  // Clamp
  const r = Math.max(0, Math.min(1, ratio));

  // Red: rgb(231, 76, 60) → Green: rgb(46, 204, 113)
  const red   = Math.round(231 + (46  - 231) * r);
  const green = Math.round(76  + (204 - 76)  * r);
  const blue  = Math.round(60  + (113 - 60)  * r);

  return `rgb(${red},${green},${blue})`;
}

function textColorFor(bgRatio: number): string {
  // Use white text for dark backgrounds (low ratio), black for bright backgrounds
  return bgRatio > 0.55 ? "#1a1a2e" : "#ffffff";
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
// Inline CSS
// ---------------------------------------------------------------------------

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #f0f2f5;
    color: #2c3e50;
    line-height: 1.6;
    padding: 24px;
  }

  .container {
    max-width: 1200px;
    margin: 0 auto;
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    overflow: hidden;
  }

  .header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    color: #ffffff;
    padding: 40px 48px;
  }

  .header h1 {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 8px;
    letter-spacing: -0.5px;
  }

  .header .subtitle {
    color: rgba(255,255,255,0.65);
    font-size: 0.95rem;
  }

  .content { padding: 48px; }

  section { margin-bottom: 48px; }

  h2 {
    font-size: 1.4rem;
    font-weight: 700;
    color: #1a1a2e;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 2px solid #e8ecf0;
  }

  h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: #34495e;
    margin-bottom: 14px;
  }

  h4 {
    font-size: 0.95rem;
    font-weight: 600;
    color: #7f8c8d;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Executive summary card */
  .summary-card {
    background: linear-gradient(135deg, #f8f9ff 0%, #eef1ff 100%);
    border: 1px solid #d0d7ff;
    border-radius: 10px;
    padding: 28px 32px;
  }

  .summary-card .best-model {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1a1a2e;
    margin-bottom: 6px;
  }

  .summary-card .score-badge {
    display: inline-block;
    background: #0f3460;
    color: #ffffff;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 20px;
    margin-bottom: 16px;
  }

  .summary-card .reasoning {
    color: #555e6e;
    font-size: 0.95rem;
  }

  /* Tables */
  .table-wrapper { overflow-x: auto; margin-top: 4px; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  thead th {
    background: #f8f9fa;
    color: #5a6a7a;
    font-weight: 600;
    text-align: left;
    padding: 12px 16px;
    border-bottom: 2px solid #e2e8f0;
    white-space: nowrap;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  tbody tr { border-bottom: 1px solid #f0f4f8; }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: #f8fbff; }

  tbody td {
    padding: 12px 16px;
    vertical-align: middle;
  }

  .score-cell {
    font-weight: 600;
    border-radius: 4px;
    padding: 6px 10px !important;
    text-align: center;
  }

  /* SVG charts */
  .charts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 24px;
  }

  .chart-card {
    background: #f8f9fc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 20px 24px;
  }

  .chart-card h3 {
    margin-bottom: 16px;
    font-size: 0.95rem;
    color: #3d4a5c;
  }

  /* Collapsible details */
  details {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    margin-bottom: 12px;
    overflow: hidden;
  }

  summary {
    cursor: pointer;
    padding: 14px 20px;
    background: #f8f9fa;
    font-weight: 600;
    color: #2c3e50;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
    user-select: none;
  }

  summary:hover { background: #eef0f3; }

  summary::before {
    content: "▶";
    font-size: 0.7rem;
    color: #7f8c8d;
    transition: transform 0.2s;
    flex-shrink: 0;
  }

  details[open] > summary::before { transform: rotate(90deg); }

  .details-body { padding: 20px; }

  /* Run cards */
  .run-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
    margin-top: 12px;
  }

  .run-card {
    background: #ffffff;
    border: 1px solid #e8ecf0;
    border-radius: 8px;
    padding: 16px;
  }

  .run-card h5 {
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    color: #7f8c8d;
    margin-bottom: 10px;
    letter-spacing: 0.4px;
  }

  .run-card .meta { font-size: 0.85rem; color: #555e6e; margin-bottom: 4px; }
  .run-card .error { color: #e74c3c; font-size: 0.85rem; }

  .score-mini { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #555e6e; margin-top: 6px; }
  .score-mini .pill {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.75rem;
  }

  /* Methodology / Config */
  .meta-list { list-style: none; padding: 0; }
  .meta-list li {
    padding: 8px 0;
    border-bottom: 1px solid #f0f4f8;
    font-size: 0.9rem;
  }
  .meta-list li:last-child { border-bottom: none; }
  .meta-list strong { color: #1a1a2e; margin-right: 6px; }

  @media (max-width: 768px) {
    body { padding: 12px; }
    .content { padding: 24px; }
    .header { padding: 28px 24px; }
    .charts-grid { grid-template-columns: 1fr; }
  }
`;

// ---------------------------------------------------------------------------
// SVG bar chart generator
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  "#0f3460", "#e94560", "#533483", "#2ecc71", "#f39c12", "#3498db",
];

function svgBarChart(
  evalName: string,
  models: ModelMetrics[],
): string {
  const maxScore = maxScoreForEvaluator(evalName);
  const barHeight = 28;
  const barGap = 10;
  const labelWidth = 160;
  const chartWidth = 200;
  const totalWidth = labelWidth + chartWidth + 60;
  const totalHeight = models.length * (barHeight + barGap) + 10;

  const bars = models.map((m, i) => {
    const avg = m.avgScores[evalName] ?? 0;
    const ratio = maxScore > 0 ? avg / maxScore : 0;
    const barW = Math.round(ratio * chartWidth);
    const y = i * (barHeight + barGap) + 5;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const labelTrunc = m.label.length > 22 ? m.label.slice(0, 21) + "…" : m.label;

    return [
      `<text x="${labelWidth - 8}" y="${y + barHeight / 2 + 5}" text-anchor="end" font-size="12" fill="#555e6e" font-family="sans-serif">${escapeHtml(labelTrunc)}</text>`,
      `<rect x="${labelWidth}" y="${y}" width="${barW}" height="${barHeight}" fill="${color}" rx="4"/>`,
      `<text x="${labelWidth + barW + 6}" y="${y + barHeight / 2 + 5}" font-size="12" fill="#2c3e50" font-weight="600" font-family="sans-serif">${avg.toFixed(2)}</text>`,
    ].join("\n");
  });

  return [
    `<svg viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">`,
    ...bars,
    `</svg>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// HTML escape helper
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Section generators
// ---------------------------------------------------------------------------

function htmlHeader(results: EvaluationResults): string {
  return `
    <div class="header">
      <h1>Agent Evaluation Report</h1>
      <div class="subtitle">
        Agent: <strong>${escapeHtml(results.config.agent.name)}</strong>
        &nbsp;&middot;&nbsp;
        Generated: ${escapeHtml(results.timestamp)}
      </div>
    </div>
  `;
}

function htmlExecutiveSummary(results: EvaluationResults): string {
  const { model, reasoning } = results.bestModel;

  return `
    <section>
      <h2>Executive Summary</h2>
      <div class="summary-card">
        <div class="best-model">Best Model: ${escapeHtml(model.label)}</div>
        <div class="score-badge">Overall Score: ${model.overallScore}/100</div>
        <p class="reasoning">${escapeHtml(reasoning)}</p>
      </div>
    </section>
  `;
}

function htmlModelComparisonTable(results: EvaluationResults): string {
  const evaluatorCols = ["helpfulness", "coherence", "faithfulness", "toolAccuracy", "trajectory"];

  // Precompute min/max per evaluator for color coding
  const colStats: Record<string, { min: number; max: number }> = {};

  for (const ev of evaluatorCols) {
    const vals = results.metrics.map((m) => m.avgScores[ev] ?? 0);
    colStats[ev] = { min: Math.min(...vals), max: Math.max(...vals) };
  }

  const overallVals = results.metrics.map((m) => m.overallScore);
  const overallStats = { min: Math.min(...overallVals), max: Math.max(...overallVals) };

  const latencyVals = results.metrics.map((m) => m.avgLatencyMs);
  const costVals = results.metrics.map((m) => m.totalCost);

  function colorCell(value: number, minVal: number, maxVal: number, invert = false): string {
    const range = maxVal - minVal;
    const ratio = range > 0 ? (value - minVal) / range : 0.5;
    const colorRatio = invert ? 1 - ratio : ratio;
    const bg = scoreColor(colorRatio);
    const text = textColorFor(colorRatio);
    return `<td class="score-cell" style="background:${bg};color:${text}">${value.toFixed(2)}</td>`;
  }

  const headerCells = [
    "<th>Model</th>",
    "<th>Overall</th>",
    "<th>Helpfulness</th>",
    "<th>Coherence</th>",
    "<th>Faithfulness</th>",
    "<th>Tool Accuracy</th>",
    "<th>Trajectory</th>",
    "<th>Latency (ms)</th>",
    "<th>Cost ($)</th>",
  ].join("\n            ");

  const rows = results.metrics.map((m) => {
    const latencyMin = Math.min(...latencyVals);
    const latencyMax = Math.max(...latencyVals);
    const costMin = Math.min(...costVals);
    const costMax = Math.max(...costVals);

    return `
          <tr>
            <td><strong>${escapeHtml(m.label)}</strong></td>
            ${colorCell(m.overallScore, overallStats.min, overallStats.max)}
            ${colorCell(m.avgScores["helpfulness"] ?? 0, colStats["helpfulness"].min, colStats["helpfulness"].max)}
            ${colorCell(m.avgScores["coherence"] ?? 0, colStats["coherence"].min, colStats["coherence"].max)}
            ${colorCell(m.avgScores["faithfulness"] ?? 0, colStats["faithfulness"].min, colStats["faithfulness"].max)}
            ${colorCell(m.avgScores["toolAccuracy"] ?? 0, colStats["toolAccuracy"].min, colStats["toolAccuracy"].max)}
            ${colorCell(m.avgScores["trajectory"] ?? 0, colStats["trajectory"].min, colStats["trajectory"].max)}
            ${colorCell(m.avgLatencyMs, latencyMin, latencyMax, true)}
            <td>${m.totalCost.toFixed(6)}</td>
          </tr>`;
  }).join("\n");

  return `
    <section>
      <h2>Model Comparison</h2>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
            ${headerCells}
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function htmlScoringCharts(results: EvaluationResults): string {
  // Collect all evaluator names
  const evalNames = new Set<string>();
  for (const m of results.metrics) {
    for (const name of Object.keys(m.avgScores)) {
      evalNames.add(name);
    }
  }

  const charts = Array.from(evalNames).map((evalName) => `
      <div class="chart-card">
        <h3>${escapeHtml(evalName)}</h3>
        ${svgBarChart(evalName, results.metrics)}
      </div>
  `).join("\n");

  return `
    <section>
      <h2>Scoring Breakdown</h2>
      <div class="charts-grid">
        ${charts}
      </div>
    </section>
  `;
}

function htmlCostLatencyTable(results: EvaluationResults): string {
  // Count invocations per model
  const invocationCounts: Record<string, number> = {};
  for (const r of results.results) {
    invocationCounts[r.modelId] = (invocationCounts[r.modelId] ?? 0) + 1;
  }

  const rows = results.metrics.map((m) => {
    const count = invocationCounts[m.modelId] ?? 1;
    const costPer1K = count > 0 ? (m.totalCost / count) * 1000 : 0;

    return `
          <tr>
            <td><strong>${escapeHtml(m.label)}</strong></td>
            <td>${m.avgLatencyMs}</td>
            <td>${m.p95LatencyMs}</td>
            <td>${m.totalCost.toFixed(6)}</td>
            <td>${costPer1K.toFixed(6)}</td>
          </tr>`;
  }).join("\n");

  return `
    <section>
      <h2>Cost &amp; Latency Analysis</h2>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Avg Latency (ms)</th>
              <th>P95 Latency (ms)</th>
              <th>Total Cost ($)</th>
              <th>Cost / 1K Invocations ($)</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function htmlPerTestResults(results: EvaluationResults): string {
  // Group by test case
  const byTestCase = new Map<string, typeof results.results>();
  for (const r of results.results) {
    const group = byTestCase.get(r.testCaseId) ?? [];
    group.push(r);
    byTestCase.set(r.testCaseId, group);
  }

  const testSections = Array.from(byTestCase.entries()).map(([testCaseId, caseResults]) => {
    // Group by model
    const byModel = new Map<string, typeof caseResults>();
    for (const r of caseResults) {
      const group = byModel.get(r.modelId) ?? [];
      group.push(r);
      byModel.set(r.modelId, group);
    }

    const modelSections = Array.from(byModel.entries()).map(([modelId, runs]) => {
      const metric = results.metrics.find((m) => m.modelId === modelId);
      const label = metric?.label ?? modelId;

      const runCards = runs.map((run) => {
        if (run.error) {
          return `
              <div class="run-card">
                <h5>Run ${run.runIndex + 1}</h5>
                <div class="error">Error: ${escapeHtml(run.error)}</div>
              </div>`;
        }

        const toolCallsStr = run.response.toolCalls.length > 0
          ? run.response.toolCalls.map((tc) => escapeHtml(tc.name)).join(", ")
          : "none";

        const scorePills = Object.entries(run.scores).map(([ev, score]) => {
          const ratio = score.maxScore > 0 ? score.score / score.maxScore : 0;
          const bg = scoreColor(ratio);
          const text = textColorFor(ratio);
          return `
              <div class="score-mini">
                <span>${escapeHtml(ev)}</span>
                <span class="pill" style="background:${bg};color:${text}">${score.score}/${score.maxScore}</span>
              </div>`;
        }).join("");

        return `
              <div class="run-card">
                <h5>Run ${run.runIndex + 1}</h5>
                <div class="meta">Latency: ${run.response.latencyMs}ms</div>
                <div class="meta">Tokens: ${run.response.usage.totalTokens}</div>
                <div class="meta">Tools: ${toolCallsStr}</div>
                ${scorePills}
              </div>`;
      }).join("\n");

      return `
          <h4>${escapeHtml(label)}</h4>
          <div class="run-grid">
            ${runCards}
          </div>`;
    }).join("\n");

    return `
        <details>
          <summary>${escapeHtml(testCaseId)}</summary>
          <div class="details-body">
            ${modelSections}
          </div>
        </details>`;
  }).join("\n");

  return `
    <section>
      <h2>Per-Test Results</h2>
      ${testSections}
    </section>
  `;
}

function htmlMethodologyAndConfig(results: EvaluationResults): string {
  const { config, timestamp } = results;
  const { evaluation } = config;

  const evaluators = evaluation.evaluators.map((e) => escapeHtml(e)).join(", ");
  const judgeLabel = escapeHtml(
    evaluation.judgeModel?.label ?? evaluation.judgeModel?.modelId ?? "N/A",
  );

  const modelListItems = config.models.map((m) =>
    `<li><strong>${escapeHtml(m.label ?? m.modelId)}</strong> — ${escapeHtml(m.provider)}</li>`,
  ).join("\n");

  return `
    <section>
      <h2>Methodology</h2>
      <ul class="meta-list">
        <li><strong>Evaluators:</strong> ${evaluators}</li>
        <li><strong>Judge Model:</strong> ${judgeLabel}</li>
        <li><strong>Runs per Test:</strong> ${evaluation.runsPerTest}</li>
        <li><strong>Timestamp:</strong> ${escapeHtml(timestamp)}</li>
      </ul>
    </section>

    <section>
      <h2>Configuration</h2>
      <ul class="meta-list">
        <li><strong>Agent:</strong> ${escapeHtml(config.agent.name)}</li>
        <li>
          <strong>Models Evaluated:</strong>
          <ul style="margin-top:8px;padding-left:20px;list-style:disc">
            ${modelListItems}
          </ul>
        </li>
      </ul>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a self-contained HTML report from evaluation results.
 *
 * @param results - Full evaluation results from EvaluationEngine.
 * @returns A complete, self-contained HTML string.
 */
export function generateHtmlReport(results: EvaluationResults): string {
  const title = `Agent Evaluation Report — ${results.config.agent.name}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
${CSS}
  </style>
</head>
<body>
  <div class="container">
    ${htmlHeader(results)}
    <div class="content">
      ${htmlExecutiveSummary(results)}
      ${htmlModelComparisonTable(results)}
      ${htmlScoringCharts(results)}
      ${htmlCostLatencyTable(results)}
      ${htmlPerTestResults(results)}
      ${htmlMethodologyAndConfig(results)}
    </div>
  </div>
</body>
</html>`;
}
