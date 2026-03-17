<script lang="ts">
  import type { ChatMessage } from "$lib/debate/models";
  import { getModelInfo, getWinnerInfo } from "$lib/debate/models";
  import { escapeHtml, formatMessage } from "$lib/debate/formatMessage";

  interface Props {
    messages: ChatMessage[];
    topic: string;
    turns: number;
    agentA: string;
    agentB: string;
    pairwiseRounds: any[];
    finalScorecard: any;
    currentLeader: any;
    narrativeVerdict: any;
    liveJudgeResults: any[];
    scoreDeltas?: Record<number, number>;
    agentOverrides?: Record<string, { name: string; color: string }>;
    onreset: () => void;
  }

  let {
    messages,
    topic,
    turns,
    agentA,
    agentB,
    pairwiseRounds,
    finalScorecard,
    currentLeader,
    narrativeVerdict,
    liveJudgeResults,
    scoreDeltas = {},
    agentOverrides = {},
    onreset,
  }: Props = $props();

  function resolveAgent(id: string): { id: string; name: string; color: string } {
    if (id === "tie") return { id: "tie", name: "Draw", color: "#6b7280" };
    const override = agentOverrides[id];
    if (override) return { id, ...override };
    return getModelInfo(id);
  }

  function exportDebate(format: "md" | "txt") {
    const date = new Date().toISOString().slice(0, 10);
    const displayTopic = topic || "Document Analysis";
    const safeTitle = displayTopic
      .slice(0, 60)
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();

    let content: string;
    let mime: string;
    let ext: string;

    const agentAInfo = resolveAgent(agentA);
    const agentBInfo = resolveAgent(agentB);

    if (format === "md") {
      content = `# Debate: ${displayTopic}\n\n_Exported ${date}_\n\n---\n\n`;
      content += messages
        .map((m) => `### ${m.agentName}\n\n${m.text}`)
        .join("\n\n---\n\n");

      if (pairwiseRounds.length > 0) {
        content += "\n\n---\n\n## Live Judge Analysis\n\n";
        content += pairwiseRounds
          .map((round) => {
            const logicWinnerName = resolveAgent(round.logicWinner).name;
            const tacticsWinnerName = resolveAgent(round.tacticsWinner).name;
            const rhetoricWinnerName = resolveAgent(round.rhetoricWinner).name;
            let roundMd =
              `### Round ${round.roundNumber} · T${round.prevTurn.turnNumber} (${round.prevTurn.agentName}) vs T${round.curTurn.turnNumber} (${round.curTurn.agentName})\n\n` +
              `**Logic:** ${logicWinnerName} · **Tactics:** ${tacticsWinnerName} · **Rhetoric:** ${rhetoricWinnerName}\n\n` +
              `**Logic Analysis:**\n\n> ${round.logicDelta}\n\n` +
              (round.languageWarning ? `> ⚠ ${round.languageWarning}\n\n` : "");
            const dimFlags = (round.harmonizationFlags ?? []).filter(
              (f: any) => f.dimension !== "overall",
            );
            if (dimFlags.length > 0) {
              const notes = dimFlags
                .map((f: any) => {
                  const leader =
                    f.absoluteScoreLeader === "tie"
                      ? "Draw"
                      : resolveAgent(f.absoluteScoreLeader).name;
                  return `⚠ **${f.dimension.charAt(0).toUpperCase() + f.dimension.slice(1)}**: absolute scores indicate ${leader} (gap ${f.divergenceMagnitude})`;
                })
                .join(" · ");
              roundMd += `> _Score discrepancy: ${notes}_\n\n`;
            }
            return roundMd;
          })
          .join("---\n\n");
      }

      if (finalScorecard?.winTallies) {
        content += "\n\n---\n\n## Scorecard\n\n";
        content += Object.entries(finalScorecard.winTallies)
          .map(
            ([id, t]: [string, any]) =>
              `**${t.agentName}**: Logic ${t.logic} · Tactics ${t.tactics} · Rhetoric ${t.rhetoric} · Total ${t.total}`,
          )
          .join("\n\n");
        if (currentLeader) {
          content += `\n\n🏆 **Winner: ${currentLeader.agentName}** (${currentLeader.score} round wins)\n`;
        }
      }

      if (narrativeVerdict?.text) {
        content +=
          "\n\n---\n\n## Narrative Verdict\n_Arc-level: rewards cumulative thesis coherence_\n\n";
        content += narrativeVerdict.text + "\n";
        if (narrativeVerdict.favouredAgentId) {
          content += `\n**Verdict: ${resolveAgent(narrativeVerdict.favouredAgentId).name}**\n`;
        }
        if (!narrativeVerdict.agreesWithScorecard && narrativeVerdict.favouredAgentId && finalScorecard?.overallWinner && narrativeVerdict.favouredAgentId !== finalScorecard.overallWinner) {
          content += `\n> ⚡ Narrative verdict disagrees with the round-by-round scorecard.\n`;
          if (narrativeVerdict.conflictResolution) {
            const splitHeader = narrativeVerdict.scorecardInternallyConsistent === false
              ? "Why they diverged · scorecard internally split"
              : "Why they diverged";
            content += `\n> **${splitHeader}:** ${narrativeVerdict.conflictResolution}\n`;
          }
        }
        if (narrativeVerdict.convergence?.detected) {
          const conv = narrativeVerdict.convergence;
          content += `\n> ⚠ **Positional convergence detected**`;
          if (conv.convergenceTurnRange) content += ` · ${conv.convergenceTurnRange}`;
          content += `\n`;
          if (conv.positionalGapDescription) content += `\n> ${conv.positionalGapDescription}\n`;
          content += `\n> Remaining disagreement: ${conv.remainingDisagreementType} · Motion viability: ${conv.motionViability === "degenerate_convergence" ? "degenerate — opposition collapsed" : conv.motionViability}\n`;
        }
      }

      const scoredResults = liveJudgeResults.filter(
        (r: any) => r.absoluteScores,
      );
      if (scoredResults.length > 0) {
        content +=
          "\n\n---\n\n## Per-Turn Absolute Scores\n_Turn-by-turn: Logic/40 · Rhetoric/30 · Tactics/30_\n\n";
        content +=
          "| Turn | Agent | Logic/40 | Rhetoric/30 | Tactics/30 | Score |\n";
        content +=
          "|------|-------|----------|-------------|------------|-------|\n";
        scoredResults.forEach((r: any) => {
          const s = r.absoluteScores;
          // Use the live sum so any retroactive logicalCoherence patches are reflected.
          const liveTotal = s.logicalCoherence + s.rhetoricalForce + s.tacticalEffectiveness;
          const delta = scoreDeltas[r.turnNumber];
          const logicCell = delta
            ? `${s.logicalCoherence} _(${delta > 0 ? '+' : ''}${delta})_`
            : `${s.logicalCoherence}`;
          content += `| T${r.turnNumber} | ${resolveAgent(r.agentId).name} | ${logicCell} | ${s.rhetoricalForce} | ${s.tacticalEffectiveness} | ${liveTotal} |\n`;
        });
      }

      mime = "text/markdown";
      ext = "md";
    } else {
      content = `DEBATE: ${displayTopic}\nExported: ${date}\n${"─".repeat(40)}\n\n`;
      content += messages.map((m) => `[${m.agentName}]\n${m.text}`).join("\n\n");

      if (pairwiseRounds.length > 0) {
        content += `\n\n${"═".repeat(40)}\nPAIRWISE SCORECARD\n\n`;
        content += pairwiseRounds
          .map((round) => {
            let line =
              `[Round ${round.roundNumber}  T${round.prevTurn.turnNumber}:${round.prevTurn.agentName} vs T${round.curTurn.turnNumber}:${round.curTurn.agentName}]\n` +
              `Logic: ${resolveAgent(round.logicWinner).name}  Tactics: ${resolveAgent(round.tacticsWinner).name}  Rhetoric: ${resolveAgent(round.rhetoricWinner).name}\n${round.logicDelta}`;
            const dimFlags = (round.harmonizationFlags ?? []).filter(
              (f: any) => f.dimension !== "overall",
            );
            if (dimFlags.length > 0) {
              line +=
                "\nScore discrepancy: " +
                dimFlags
                  .map((f: any) => {
                    const leader =
                      f.absoluteScoreLeader === "tie"
                        ? "Draw"
                        : resolveAgent(f.absoluteScoreLeader).name;
                    return `${f.dimension} → absolute: ${leader} (gap ${f.divergenceMagnitude})`;
                  })
                  .join(", ");
            }
            return line;
          })
          .join(`\n\n${"─".repeat(40)}\n\n`);

        if (finalScorecard?.winTallies) {
          content += `\n\n${"═".repeat(40)}\nFINAL TALLY\n`;
          Object.entries(finalScorecard.winTallies).forEach(
            ([id, t]: [string, any]) => {
              content += `${t.agentName}: Logic ${t.logic}  Tactics ${t.tactics}  Rhetoric ${t.rhetoric}  Total ${t.total}\n`;
            },
          );
        }
        if (currentLeader) {
          content += `Winner: ${currentLeader.agentName} (${currentLeader.score} wins)\n`;
        }
        content += "\n";
      }

      if (narrativeVerdict?.text) {
        const arcLabel = narrativeVerdict.agreesWithScorecard ? "NARRATIVE VERDICT" : "NARRATIVE VERDICT  ⚡ ARC DIVERGES";
        content += `${"═".repeat(40)}\n${arcLabel}\n\n${narrativeVerdict.text}\n`;
        if (narrativeVerdict.favouredAgentId) {
          content += `\nVerdict: ${resolveAgent(narrativeVerdict.favouredAgentId).name}\n`;
        }
        if (!narrativeVerdict.agreesWithScorecard && narrativeVerdict.conflictResolution) {
          const splitHeader = narrativeVerdict.scorecardInternallyConsistent === false
            ? "Why they diverged (scorecard internally split)"
            : "Why they diverged";
          content += `\n${splitHeader}:\n${narrativeVerdict.conflictResolution}\n`;
        }
        if (narrativeVerdict.convergence?.detected) {
          const conv = narrativeVerdict.convergence;
          content += `\n⚠ Positional convergence detected`;
          if (conv.convergenceTurnRange) content += ` · ${conv.convergenceTurnRange}`;
          content += `\n`;
          if (conv.positionalGapDescription) content += `${conv.positionalGapDescription}\n`;
          content += `Remaining disagreement: ${conv.remainingDisagreementType} · Motion viability: ${conv.motionViability === "degenerate_convergence" ? "degenerate — opposition collapsed" : conv.motionViability}\n`;
        }
        content += "\n";
      }

      const scoredResultsTxt = liveJudgeResults.filter(
        (r: any) => r.absoluteScores,
      );
      if (scoredResultsTxt.length > 0) {
        content += `${"═".repeat(40)}\nPER-TURN SCORES\n\n`;
        scoredResultsTxt.forEach((r: any) => {
          const s = r.absoluteScores;
          const liveTotal = s.logicalCoherence + s.rhetoricalForce + s.tacticalEffectiveness;
          const delta = scoreDeltas[r.turnNumber];
          const logicStr = delta ? `${s.logicalCoherence}(${delta > 0 ? '+' : ''}${delta})` : `${s.logicalCoherence}`;
          content += `T${r.turnNumber}  ${resolveAgent(r.agentId).name}  Logic:${logicStr}/40  Rhetoric:${s.rhetoricalForce}/30  Tactics:${s.tacticalEffectiveness}/30  Score:${liveTotal}\n`;
        });
        content += "\n";
      }

      mime = "text/plain";
      ext = "txt";
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debate-${safeTitle}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportDebatePdf() {
    const date = new Date().toISOString().slice(0, 10);
    const displayTopic = topic || "Document Analysis";
    const safeTitle = displayTopic
      .slice(0, 60)
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();

    const agentColors: Record<string, string> = {};
    for (const m of messages) {
      if (!(m.agentId in agentColors)) agentColors[m.agentId] = m.color;
    }
    const agentIds = Object.keys(agentColors);
    const colorA = agentIds[0] ? agentColors[agentIds[0]] : "#7c6af7";
    const colorB = agentIds[1] ? agentColors[agentIds[1]] : "#c084fc";

    let body = "";

    for (const m of messages) {
      const isMod = m.agentId === "moderator";
      const isA = m.agentId === agentIds[0];
      const accent = isMod ? "#888" : isA ? colorA : colorB;
      const align = isMod ? "center" : isA ? "left" : "right";
      const maxW = isMod ? "100%" : "78%";
      const marginAuto = isMod
        ? "margin:0 auto"
        : isA
          ? "margin-right:auto"
          : "margin-left:auto";
      body += `<div style="max-width:${maxW};${marginAuto};margin-bottom:1.25rem;text-align:${align}">`;
      body += `<div style="font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${accent};margin-bottom:0.25rem">${escapeHtml(m.agentName)}</div>`;
      body += `<div style="font-size:0.88rem;line-height:1.65;color:#1a1a2e;background:${isMod ? "transparent" : "#f7f7fb"};border-left:${isMod ? "none" : `3px solid ${accent}`};padding:${isMod ? "0" : "0.6rem 0.8rem"};border-radius:4px">${formatMessage(m.text)}</div>`;
      body += `</div>`;
    }

    let scoreHtml = "";
    if (pairwiseRounds.length > 0) {
      scoreHtml += `<hr style="margin:2rem 0;border:none;border-top:1px solid #ddd">`;
      scoreHtml += `<h2 style="font-size:1rem;font-weight:700;margin-bottom:1rem;letter-spacing:0.05em">Live Judge Analysis</h2>`;
      for (const round of pairwiseRounds) {
        const logicW = resolveAgent(round.logicWinner).name;
        const tacW = resolveAgent(round.tacticsWinner).name;
        const rhetW = resolveAgent(round.rhetoricWinner).name;
        scoreHtml += `<div style="margin-bottom:1rem;padding:0.75rem;background:#f7f7fb;border-radius:6px;font-size:0.82rem">`;
        scoreHtml += `<div style="font-weight:700;margin-bottom:0.4rem">Round ${round.roundNumber} · T${round.prevTurn.turnNumber} (${escapeHtml(round.prevTurn.agentName)}) vs T${round.curTurn.turnNumber} (${escapeHtml(round.curTurn.agentName)})</div>`;
        scoreHtml += `<div style="margin-bottom:0.3rem"><strong>Logic:</strong> ${escapeHtml(logicW)} &nbsp;·&nbsp; <strong>Tactics:</strong> ${escapeHtml(tacW)} &nbsp;·&nbsp; <strong>Rhetoric:</strong> ${escapeHtml(rhetW)}</div>`;
        scoreHtml += `<div style="color:#555;font-style:italic">${escapeHtml(round.logicDelta)}</div>`;
        scoreHtml += `</div>`;
      }

      if (finalScorecard?.winTallies) {
        scoreHtml += `<div style="margin-bottom:1rem;padding:0.75rem;background:#eef;border-radius:6px;font-size:0.85rem"><strong>Final Tally</strong><br>`;
        Object.entries(finalScorecard.winTallies).forEach(
          ([_id, t]: [string, any]) => {
            scoreHtml += `${escapeHtml(t.agentName)}: Logic ${t.logic} &nbsp;·&nbsp; Tactics ${t.tactics} &nbsp;·&nbsp; Rhetoric ${t.rhetoric} &nbsp;·&nbsp; Total ${t.total}<br>`;
          },
        );
        if (currentLeader) {
          scoreHtml += `<strong>🏆 Winner: ${escapeHtml(currentLeader.agentName)} (${currentLeader.score} round wins)</strong>`;
        }
        scoreHtml += `</div>`;
      }
    }

    let verdictHtml = "";
    if (narrativeVerdict?.text) {
      verdictHtml += `<hr style="margin:2rem 0;border:none;border-top:1px solid #ddd">`;
      const arcDiverges = !narrativeVerdict.agreesWithScorecard;
      const verdictAccent = arcDiverges ? "#d97706" : "#7c3aed";
      verdictHtml += `<h2 style="font-size:1rem;font-weight:700;margin-bottom:0.25rem;color:${verdictAccent}">${arcDiverges ? "⚡ Narrative Arc Diverges" : "Narrative Verdict"}</h2>`;
      verdictHtml += `<p style="font-size:0.75rem;color:#888;font-style:italic;margin-bottom:0.75rem">Arc-level · cumulative thesis coherence</p>`;
      if (narrativeVerdict.convergence?.detected) {
        const conv = narrativeVerdict.convergence;
        verdictHtml += `<div style="margin-bottom:0.75rem;padding:0.6rem 0.8rem;background:#eff6ff;border-left:3px solid #38bdf8;border-radius:4px;font-size:0.8rem">`;
        verdictHtml += `<strong style="color:#0369a1">⚠ Positional convergence detected${conv.convergenceTurnRange ? ` · ${escapeHtml(conv.convergenceTurnRange)}` : ""}</strong>`;
        if (conv.positionalGapDescription) verdictHtml += `<br>${escapeHtml(conv.positionalGapDescription)}`;
        verdictHtml += `<br><span style="color:#555">Remaining disagreement: ${escapeHtml(conv.remainingDisagreementType)} · Motion viability: ${escapeHtml(conv.motionViability === "degenerate_convergence" ? "degenerate — opposition collapsed" : conv.motionViability)}</span>`;
        verdictHtml += `</div>`;
      }
      verdictHtml += `<div style="font-size:0.88rem;line-height:1.65">${formatMessage(narrativeVerdict.text)}</div>`;
      if (narrativeVerdict.favouredAgentId) {
        verdictHtml += `<p style="margin-top:0.75rem;font-weight:700">Verdict: ${escapeHtml(getModelInfo(narrativeVerdict.favouredAgentId).name)}</p>`;
      }
      if (arcDiverges && narrativeVerdict.conflictResolution) {
        const splitLabel = narrativeVerdict.scorecardInternallyConsistent === false
          ? "Why they diverged · scorecard internally split"
          : "Why they diverged";
        verdictHtml += `<div style="margin-top:0.75rem;padding:0.6rem 0.8rem;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;font-size:0.8rem">`;
        verdictHtml += `<strong style="color:#92400e">${escapeHtml(splitLabel)}</strong><br>${escapeHtml(narrativeVerdict.conflictResolution)}`;
        verdictHtml += `</div>`;
      }
    }

    let scoresHtml = "";
    const scoredRows = liveJudgeResults.filter((r: any) => r.absoluteScores);
    if (scoredRows.length > 0) {
      scoresHtml += `<hr style="margin:2rem 0;border:none;border-top:1px solid #ddd">`;
      scoresHtml += `<h2 style="font-size:1rem;font-weight:700;margin-bottom:0.75rem">Per-Turn Absolute Scores</h2>`;
      scoresHtml += `<p style="font-size:0.75rem;color:#888;margin-bottom:0.5rem">Turn-by-turn: Logic/40 · Rhetoric/30 · Tactics/30</p>`;
      scoresHtml += `<table style="width:100%;border-collapse:collapse;font-size:0.82rem">`;
      scoresHtml += `<thead><tr style="background:#eee"><th style="padding:0.35rem 0.5rem;text-align:left">Turn</th><th style="padding:0.35rem 0.5rem;text-align:left">Agent</th><th style="padding:0.35rem 0.5rem;text-align:center">Logic/40</th><th style="padding:0.35rem 0.5rem;text-align:center">Rhetoric/30</th><th style="padding:0.35rem 0.5rem;text-align:center">Tactics/30</th><th style="padding:0.35rem 0.5rem;text-align:center">Score</th></tr></thead>`;
      scoresHtml += `<tbody>`;
      scoredRows.forEach((r: any, i: number) => {
        const s = r.absoluteScores;
        const liveTotal = s.logicalCoherence + s.rhetoricalForce + s.tacticalEffectiveness;
        const delta = scoreDeltas[r.turnNumber];
        const logicCell = delta
          ? `${s.logicalCoherence} <span style="font-size:0.75em;color:${delta < 0 ? '#dc2626' : '#16a34a'}">(${delta > 0 ? '+' : ''}${delta})</span>`
          : `${s.logicalCoherence}`;
        scoresHtml += `<tr style="background:${i % 2 === 0 ? "#fff" : "#f9f9f9"}"><td style="padding:0.3rem 0.5rem">T${r.turnNumber}</td><td style="padding:0.3rem 0.5rem">${escapeHtml(getModelInfo(r.agentId).name)}</td><td style="padding:0.3rem 0.5rem;text-align:center">${logicCell}</td><td style="padding:0.3rem 0.5rem;text-align:center">${s.rhetoricalForce}</td><td style="padding:0.3rem 0.5rem;text-align:center">${s.tacticalEffectiveness}</td><td style="padding:0.3rem 0.5rem;text-align:center;font-weight:700">${liveTotal}</td></tr>`;
      });
      scoresHtml += `</tbody></table>`;
    }

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Debate: ${escapeHtml(displayTopic)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a2e; background: #fff; padding: 2.5rem 3rem; max-width: 820px; margin: 0 auto; }
  h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }
  h2 { color: #333; }
  p { margin: 0.5em 0; }
  ul, ol { padding-left: 1.5em; margin: 0.4em 0; }
  li { margin: 0.2em 0; }
  code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.85em; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  @media print {
    body { padding: 1rem; }
    @page { margin: 1.5cm 1.5cm; }
  }
</style>
</head>
<body>
<h1>Debate: ${escapeHtml(displayTopic)}</h1>
<p style="font-size:0.8rem;color:#888;margin-bottom:2rem">Exported ${date}</p>
<hr style="margin-bottom:2rem;border:none;border-top:2px solid #eee">
${body}${scoreHtml}${verdictHtml}${scoresHtml}
</body>
</html>`;

    const win = window.open("", `debate-${safeTitle}.pdf`);
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }
</script>

<div class="flex items-center gap-2">
  <span
    class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted] mr-1"
    >Export</span
  >
  <button
    onclick={() => exportDebate("md")}
    class="flex items-center gap-1.5 bg-[--color-panel] border border-[--color-border] hover:border-[--color-accent] hover:text-white text-[--color-muted-fg] text-xs font-medium px-3.5 py-2 rounded-lg transition-all cursor-pointer"
  >
    <svg
      class="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      ><path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-4-4 4m0 0-4-4m4 4V4"
      /></svg
    >
    Markdown
  </button>
  <button
    onclick={() => exportDebate("txt")}
    class="flex items-center gap-1.5 bg-[--color-panel] border border-[--color-border] hover:border-[--color-accent] hover:text-white text-[--color-muted-fg] text-xs font-medium px-3.5 py-2 rounded-lg transition-all cursor-pointer"
  >
    <svg
      class="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      ><path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-4-4 4m0 0-4-4m4 4V4"
      /></svg
    >
    Plain text
  </button>
  <button
    onclick={exportDebatePdf}
    class="flex items-center gap-1.5 bg-[--color-panel] border border-[--color-border] hover:border-[#f87171] hover:text-white text-[--color-muted-fg] text-xs font-medium px-3.5 py-2 rounded-lg transition-all cursor-pointer"
  >
    <svg
      class="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      ><path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M7 21h10a2 2 0 0 0 2-2V9.414a1 1 0 0 0-.293-.707l-5.414-5.414A1 1 0 0 0 12.586 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"
      /></svg
    >
    PDF
  </button>
  <button
    onclick={onreset}
    class="ml-auto flex items-center gap-1.5 text-[--color-muted] hover:text-red-400 text-xs font-medium px-3.5 py-2 rounded-lg border border-transparent hover:border-red-900/50 transition-all cursor-pointer"
  >
    <svg
      class="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      ><path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16"
      /></svg
    >
    Clear
  </button>
</div>
