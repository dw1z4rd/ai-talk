<script lang="ts">
  import Nav from "$lib/Nav.svelte";
  import { fade, scale } from "svelte/transition";
  import { tick } from "svelte";

  const MODEL_OPTIONS = [
    {
      group: "Ollama — Cloud",
      options: [
        {
          id: "deepseek-v3.1:671b-cloud",
          name: "DeepSeek V3.1",
          color: "#4B8BF5",
        },
        { id: "deepseek-v3.2-cloud", name: "DeepSeek V3.2", color: "#3B7BFF" },
        {
          id: "devstral-small-2:24b-cloud",
          name: "Devstral Small 2",
          color: "#FF7000",
        },
        {
          id: "kimi-k2:1t-cloud",
          name: "Kimi K2 1T",
          color: "#A78BFA",
        },
        {
          id: "gpt-oss:120b-cloud",
          name: "GPT-OSS 120B",
          color: "#FF6B35",
        },
        {
          id: "qwen3-vl:235b-cloud",
          name: "Qwen3-VL 235B",
          color: "#10B981",
        },
        {
          id: "glm-4.6:cloud",
          name: "GLM-4.6",
          color: "#8B5CF6",
        },
      ],
    },
  ];

  function getModelInfo(id: string) {
    for (const group of MODEL_OPTIONS) {
      const found = group.options.find((o) => o.id === id);
      if (found) return found;
    }
    return { id, name: id, color: "#7c6af7" };
  }

  interface ChatMessage {
    agentId: string;
    agentName: string;
    color: string;
    text: string;
  }

  interface ContextFile {
    name: string;
    content: string;
  }

  const MAX_FILE_BYTES = 80_000;
  const ACCEPTED = ".txt,.md,.csv,.json";

  let topic = $state("");
  let turns = $state(4);
  let messages = $state<ChatMessage[]>([]);
  let running = $state(false);
  let isPaused = $state(false);
  let moderatorInput = $state("");
  let done = $state(false);
  let errorMsg = $state("");
  let chatEl = $state<HTMLElement | null>(null);
  let abortController = $state<AbortController | null>(null);
  let agentA = $state("kimi-k2:1t-cloud");
  let agentB = $state("deepseek-v3.2-cloud");
  let leftAgentId = $state("kimi-k2:1t-cloud");
  let typingAgentName = $state("");
  let typingAgentColor = $state("");
  let streamingMessage = $state<ChatMessage | null>(null);

  // Files
  let contextFiles = $state<ContextFile[]>([]);
  let dragging = $state(false);
  let fileError = $state("");

  // Derived progress
  let progress = $derived(
    turns > 0 ? Math.min((messages.length / (turns * 2)) * 100, 100) : 0,
  );

  // UI state
  let showFiles = $state(false);

  // ── Live Judge Phase ─────────────────────────────────────────────────────────
  let naturallyEnded = $state(false);
  let showLiveJudgePanel = $state(false); // Show live judge panel during/after debate
  
  // Live judge system state
  let liveJudgeResults = $state<any[]>([]); // Accumulated per-turn judge results (for adaptive pressure display)
  let pairwiseRounds = $state<any[]>([]); // Pairwise comparison rounds
  let finalScorecard = $state<any>(null); // Final pairwise scorecard
  let narrativeVerdict = $state<any>(null); // Full-debate narrative verdict
  let finalJudgePanel = $state<any>(null); // Final panel state
  let currentLeader = $state<any>(null); // Current leader based on win tallies
  let momentumLeader = $state<any>(null); // Momentum leader
  let frameControlLeader = $state<any>(null); // Frame control leader

  // Winner modal
  let winner = $state<{ id: string; name: string; color: string } | null>(null);
  let winnerScore = $state(0);
  let showWinnerModal = $state(false);
  let confettiCanvas = $state<HTMLCanvasElement | null>(null);

  // ── Confetti ──────────────────────────────────────────────────────────────
  function launchConfetti() {
    if (!confettiCanvas) return;
    const canvas = confettiCanvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const palette = [
      "#7c6af7",
      "#c084fc",
      "#fbbf24",
      "#34d399",
      "#f87171",
      "#60a5fa",
      "#f472b6",
      "#a3e635",
      "#fb923c",
      winner?.color ?? "#ffffff",
    ];

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      color: string;
      size: number;
      angle: number;
      spin: number;
      shape: "rect" | "circle";
      opacity: number;
    }

    const particles: Particle[] = [];
    for (let i = 0; i < 220; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * 300,
        vx: (Math.random() - 0.5) * 5,
        vy: 2 + Math.random() * 6,
        color: palette[Math.floor(Math.random() * palette.length)],
        size: 7 + Math.random() * 9,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.22,
        shape: Math.random() > 0.45 ? "rect" : "circle",
        opacity: 1,
      });
    }

    let frame = 0;
    function animate() {
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      let alive = 0;
      for (const p of particles) {
        if (p.opacity <= 0) continue;
        alive++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;
        p.angle += p.spin;
        if (p.y > canvas.height * 0.7) p.opacity -= 0.018;

        ctx!.save();
        ctx!.globalAlpha = Math.max(0, p.opacity);
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.angle);
        ctx!.fillStyle = p.color;
        if (p.shape === "rect") {
          ctx!.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx!.beginPath();
          ctx!.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.restore();
      }
      frame++;
      if (alive > 0 && frame < 400) {
        requestAnimationFrame(animate);
      }
    }
    requestAnimationFrame(animate);
  }

  // ── Live Judge logic ───────────────────────────────────────────────────────
  async function runLiveJudging() {
    try {
      // Winner is already set via SSE events (finalScorecard / judgeResult).
      // Use finalScorecard if available, otherwise fall back to current leader from streaming.
      const scorecardData = finalScorecard ?? null;
      let winnerId: string | null = null;

      if (scorecardData?.overallWinner) {
        winnerId = scorecardData.overallWinner;
      } else if (currentLeader?.agentId) {
        winnerId = currentLeader.agentId;
      }

      // Also try to fetch judge panel for momentum/frame control
      try {
        const response = await fetch("/api/judge");
        if (response.ok) {
          const data = await response.json();
          finalJudgePanel = data.panelState;

          if (finalJudgePanel?.momentumTracker) {
            const momentumEntries: [string, number][] = Object.entries(finalJudgePanel.momentumTracker.currentMomentum || {});
            if (momentumEntries.length > 0) {
              const leaderEntry = momentumEntries.reduce((a, b) => a[1] > b[1] ? a : b);
              momentumLeader = { agentId: leaderEntry[0], momentum: leaderEntry[1] };
            }
          }
          frameControlLeader = finalJudgePanel?.frameControlTracker?.dominantFrame
            ? { agentId: finalJudgePanel.frameControlTracker.dominantFrame }
            : null;
        }
      } catch {
        // Panel fetch failed — winner still determined from SSE events
      }

      if (winnerId) {
        winner = getModelInfo(winnerId);
        // Show win tally as score if available, otherwise total from currentLeader
        const tally = scorecardData?.winTallies?.[winnerId];
        winnerScore = tally ? tally.total : (currentLeader?.score ?? 0);

        await new Promise((r) => setTimeout(r, 800));
        showWinnerModal = true;
        await tick();
        launchConfetti();
      }
    } catch (error) {
      console.error('Failed to run live judging:', error);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function applyInline(text: string): string {
    return text
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/`([^`\n]+)`/g, "<code>$1</code>");
  }

  function formatMessage(raw: string): string {
    const text = escapeHtml(raw);
    const blocks = text.split(/\n{2,}/);

    return blocks
      .map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return "";

        const lines = trimmed.split("\n");

        if (lines.every((l) => /^[-*•] /.test(l.trimStart()))) {
          const items = lines
            .map(
              (l) =>
                `<li>${applyInline(l.replace(/^[-*•] /, "").trim())}</li>`,
            )
            .join("");
          return `<ul>${items}</ul>`;
        }

        if (lines.every((l) => /^\d+[.)]\s/.test(l.trimStart()))) {
          const items = lines
            .map(
              (l) =>
                `<li>${applyInline(l.replace(/^\d+[.)]\s/, "").trim())}</li>`,
            )
            .join("");
          return `<ol>${items}</ol>`;
        }

        return `<p>${lines.map(applyInline).join("<br>")}</p>`;
      })
      .filter(Boolean)
      .join("");
  }

  function swapAgents() {
    [agentA, agentB] = [agentB, agentA];
  }

  function resetConversation() {
    messages = [];
    done = false;
    errorMsg = "";
    naturallyEnded = false;
    showLiveJudgePanel = false;
    liveJudgeResults = [];
    pairwiseRounds = [];
    finalScorecard = null;
    narrativeVerdict = null;
    finalJudgePanel = null;
    currentLeader = null;
    momentumLeader = null;
    frameControlLeader = null;
    winner = null;
    winnerScore = 0;
    showWinnerModal = false;
  }

  function buildContext(): string | undefined {
    if (contextFiles.length === 0) return undefined;
    return contextFiles
      .map((f) => `--- ${f.name} ---\n${f.content}`)
      .join("\n\n");
  }

  async function readFile(file: File): Promise<void> {
    if (contextFiles.find((f) => f.name === file.name)) return;
    if (file.size > MAX_FILE_BYTES) {
      fileError = `"${file.name}" is too large (max 80 KB).`;
      return;
    }
    const content = await file.text();
    contextFiles = [...contextFiles, { name: file.name, content }];
    fileError = "";
  }

  async function onFileInput(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    for (const file of Array.from(input.files ?? [])) await readFile(file);
    input.value = "";
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragging = false;
    for (const file of Array.from(e.dataTransfer?.files ?? []))
      await readFile(file);
  }

  function removeFile(name: string) {
    contextFiles = contextFiles.filter((f) => f.name !== name);
  }

  function exportDebate(format: "md" | "txt") {
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = topic
      .slice(0, 60)
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();

    let content: string;
    let mime: string;
    let ext: string;

    const agentAInfo = getModelInfo(agentA);
    const agentBInfo = getModelInfo(agentB);

    if (format === "md") {
      content = `# Debate: ${topic}\n\n_Exported ${date}_\n\n---\n\n`;
      content += messages
        .map((m) => `### ${m.agentName}\n\n${m.text}`)
        .join("\n\n---\n\n");

      if (pairwiseRounds.length > 0) {
        content += "\n\n---\n\n## Live Judge Analysis\n\n";
        content += pairwiseRounds
          .map((round) => {
            const logicWinnerName = getModelInfo(round.logicWinner).name;
            const tacticsWinnerName = getModelInfo(round.tacticsWinner).name;
            const rhetoricWinnerName = getModelInfo(round.rhetoricWinner).name;
            return `### Round ${round.roundNumber} · T${round.prevTurn.turnNumber} (${round.prevTurn.agentName}) vs T${round.curTurn.turnNumber} (${round.curTurn.agentName})\n\n` +
                   `**Logic:** ${logicWinnerName} · **Tactics:** ${tacticsWinnerName} · **Rhetoric:** ${rhetoricWinnerName}\n\n` +
                   `**Logic Analysis:**\n\n> ${round.logicDelta}\n\n` +
                   (round.languageWarning ? `> ⚠ ${round.languageWarning}\n\n` : '');
          })
          .join("---\n\n");
      }

      if (finalScorecard?.winTallies) {
        content += "\n\n---\n\n## Scorecard\n\n";
        content += Object.entries(finalScorecard.winTallies)
          .map(([id, t]: [string, any]) => `**${t.agentName}**: Logic ${t.logic} · Tactics ${t.tactics} · Rhetoric ${t.rhetoric} · Total ${t.total}`)
          .join('\n\n');
        if (currentLeader) {
          content += `\n\n🏆 **Winner: ${currentLeader.agentName}** (${currentLeader.score} round wins)\n`;
        }
      }

      if (narrativeVerdict?.text) {
        content += "\n\n---\n\n## Narrative Verdict\n_Arc-level: rewards cumulative thesis coherence_\n\n";
        content += narrativeVerdict.text + "\n";
        if (narrativeVerdict.favouredAgentId) {
          content += `\n**Verdict: ${getModelInfo(narrativeVerdict.favouredAgentId).name}**\n`;
        }
        if (!narrativeVerdict.agreesWithScorecard) {
          content += `\n> ⚡ Narrative verdict disagrees with the round-by-round scorecard.\n`;
          if (narrativeVerdict.conflictResolution) {
            content += `\n> **Why they diverged:** ${narrativeVerdict.conflictResolution}\n`;
          }
        }
      }

      const scoredResults = liveJudgeResults.filter((r: any) => r.absoluteScores);
      if (scoredResults.length > 0) {
        content += "\n\n---\n\n## Per-Turn Absolute Scores\n_Turn-by-turn: Logic/40 · Rhetoric/30 · Tactics/30_\n\n";
        content += "| Turn | Agent | Logic/40 | Rhetoric/30 | Tactics/30 | Score |\n";
        content += "|------|-------|----------|-------------|------------|-------|\n";
        scoredResults.forEach((r: any) => {
          const s = r.absoluteScores;
          content += `| T${r.turnNumber} | ${getModelInfo(r.agentId).name} | ${s.logicalCoherence} | ${s.rhetoricalForce} | ${s.tacticalEffectiveness} | ${s.overallScore} |\n`;
        });
      }

      mime = "text/markdown";
      ext = "md";
    } else {
      content = `DEBATE: ${topic}\nExported: ${date}\n${"─".repeat(40)}\n\n`;
      content += messages
        .map((m) => `[${m.agentName}]\n${m.text}`)
        .join("\n\n");

      if (pairwiseRounds.length > 0) {
        content += `\n\n${"═".repeat(40)}\nPAIRWISE SCORECARD\n\n`;
        content += pairwiseRounds
          .map((round) => {
            return `[Round ${round.roundNumber}  T${round.prevTurn.turnNumber}:${round.prevTurn.agentName} vs T${round.curTurn.turnNumber}:${round.curTurn.agentName}]\n` +
                   `Logic: ${getModelInfo(round.logicWinner).name}  Tactics: ${getModelInfo(round.tacticsWinner).name}  Rhetoric: ${getModelInfo(round.rhetoricWinner).name}\n${round.logicDelta}`;
          })
          .join(`\n\n${"─".repeat(40)}\n\n`);

        if (finalScorecard?.winTallies) {
          content += `\n\n${"═".repeat(40)}\nFINAL TALLY\n`;
          Object.entries(finalScorecard.winTallies).forEach(([id, t]: [string, any]) => {
            content += `${t.agentName}: Logic ${t.logic}  Tactics ${t.tactics}  Rhetoric ${t.rhetoric}  Total ${t.total}\n`;
          });
        }
        if (currentLeader) {
          content += `Winner: ${currentLeader.agentName} (${currentLeader.score} wins)\n`;
        }
        content += "\n";
      }

      if (narrativeVerdict?.text) {
        content += `${"═".repeat(40)}\nNARRATIVE VERDICT\n\n${narrativeVerdict.text}\n`;
        if (narrativeVerdict.favouredAgentId) {
          content += `\nVerdict: ${getModelInfo(narrativeVerdict.favouredAgentId).name}\n`;
        }
        content += "\n";
      }

      const scoredResultsTxt = liveJudgeResults.filter((r: any) => r.absoluteScores);
      if (scoredResultsTxt.length > 0) {
        content += `${"═".repeat(40)}\nPER-TURN SCORES\n\n`;
        scoredResultsTxt.forEach((r: any) => {
          const s = r.absoluteScores;
          content += `T${r.turnNumber}  ${getModelInfo(r.agentId).name}  Logic:${s.logicalCoherence}/40  Rhetoric:${s.rhetoricalForce}/30  Tactics:${s.tacticalEffectiveness}/30  Score:${s.overallScore}\n`;
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

  function pauseConversation() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    running = false;
    isPaused = true;
    typingAgentName = "";

    if (streamingMessage) {
      messages = [...messages, streamingMessage];
      streamingMessage = null;
    }
  }

  function stopConversation() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    running = false;
    done = true;
    isPaused = false;
    typingAgentName = "";
    streamingMessage = null;
    // naturallyEnded stays false — user manually stopped, no judging
  }

  function onTopicKeydown(e: KeyboardEvent) {
    if (
      e.key === "Enter" &&
      (e.ctrlKey || e.metaKey) &&
      !running &&
      !isPaused &&
      topic.trim()
    ) {
      e.preventDefault();
      startConversation();
    }
  }

  function onModeratorKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && moderatorInput.trim()) {
      e.preventDefault();
      const text = moderatorInput.trim();
      moderatorInput = "";
      messages = [
        ...messages,
        {
          agentId: "moderator",
          agentName: "Moderator",
          color: "#ff4b4b",
          text,
        },
      ];
      startConversation(true);
    }
  }

  async function startConversation(resume = false) {
    if (!resume) {
      messages = [];
      leftAgentId = agentA;
      // Reset live judge state for fresh debate
      naturallyEnded = false;
      showLiveJudgePanel = false;
      liveJudgeResults = [];
      pairwiseRounds = [];
      finalScorecard = null;
      narrativeVerdict = null;
      finalJudgePanel = null;
      currentLeader = null;
      momentumLeader = null;
      frameControlLeader = null;
      winner = null;
      winnerScore = 0;
      showWinnerModal = false;
    }
    done = false;
    isPaused = false;
    errorMsg = "";
    running = true;
    typingAgentName = "";
    typingAgentColor = "";
    streamingMessage = null;
    abortController = new AbortController();
    showLiveJudgePanel = true;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          turns,
          context: buildContext(),
          agentA,
          agentB,
          messages: resume ? messages : undefined,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        errorMsg = `Server error: ${response.status}`;
        running = false;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === "token") {
            if (!streamingMessage) {
              streamingMessage = {
                agentId: data.agentId,
                agentName: data.agentName,
                color: data.color,
                text: data.text,
              };
              typingAgentName = "";
              typingAgentColor = "";
            } else {
              streamingMessage = {
                agentId: streamingMessage.agentId,
                agentName: streamingMessage.agentName,
                color: streamingMessage.color,
                text: streamingMessage.text + data.text,
              };
            }
            await tick(); // Ensure DOM updates after state change
            setTimeout(
              () =>
                chatEl?.scrollTo({
                  top: chatEl.scrollHeight,
                  behavior: "smooth",
                }),
              20,
            );
          } else if (data.type === "message") {
            streamingMessage = null;
            typingAgentName = "";
            typingAgentColor = "";
            messages = [
              ...messages,
              {
                agentId: data.agentId,
                agentName: data.agentName,
                color: data.color,
                text: data.text,
              },
            ];
            await tick(); // Ensure DOM updates after state change
            const aiCount = messages.filter(
              (m) => m.agentId !== "moderator",
            ).length;
            if (aiCount < turns * 2 - 1) {  // Changed from turns * 2 to turns * 2 - 1
              const nextId = data.agentId === agentA ? agentB : agentA;
              const next = getModelInfo(nextId);
              typingAgentName = next.name;
              typingAgentColor = next.color;
            }
            setTimeout(
              () =>
                chatEl?.scrollTo({
                  top: chatEl.scrollHeight,
                  behavior: "smooth",
                }),
              50,
            );
          } else if (data.type === "judgeResult") {
            // Accumulate live judge results (kept for display/export)
            liveJudgeResults = [...liveJudgeResults, {
              turnNumber: data.turnNumber,
              agentId: data.agentId,
              scores: data.scores,
              momentumShift: data.momentumShift,
              frameControlShift: data.frameControlShift,
              tacticalAnalysis: data.tacticalAnalysis,
              reasoning: data.reasoning,
              absoluteScores: data.absoluteScores ?? null,
            }];

            // Accumulate pairwise rounds for display
            if (data.pairwiseRound) {
              pairwiseRounds = [...pairwiseRounds, data.pairwiseRound];
            }

            // Update live leader from pairwise scorecard win tallies (preferred)
            // or fall back to score totals if no scorecard yet
            if (data.scorecard && Object.keys(data.scorecard.winTallies || {}).length > 0) {
              const tallies: [string, any][] = Object.entries(data.scorecard.winTallies);
              const topTally = tallies.sort((a: [string, any], b: [string, any]) => b[1].total - a[1].total)[0];
              if (topTally && topTally[1].total > 0) {
                const info = getModelInfo(topTally[0]);
                currentLeader = {
                  agentId: topTally[0],
                  agentName: topTally[1].agentName || info.name,
                  score: topTally[1].total,
                  winTallies: data.scorecard.winTallies
                };
              }
            } else {
              // Fallback: use score totals before first pairwise round
              const scoreTotals: Record<string, number> = {};
              for (const r of liveJudgeResults) {
                scoreTotals[r.agentId] = (scoreTotals[r.agentId] || 0) + (r.scores?.overallScore ?? 50);
              }
              const topScorer = Object.entries(scoreTotals).sort((a, b) => b[1] - a[1])[0];
              if (topScorer) {
                const info = getModelInfo(topScorer[0]);
                currentLeader = { agentId: topScorer[0], agentName: info.name, score: topScorer[1] };
              }
            }

            const momentumTotals: Record<string, number> = {};
            for (const r of liveJudgeResults) {
              momentumTotals[r.agentId] = (momentumTotals[r.agentId] || 0) + (r.momentumShift ?? 0);
            }
            const topMomentum = Object.entries(momentumTotals).sort((a, b) => b[1] - a[1])[0];
            momentumLeader = topMomentum ? { agentId: topMomentum[0], momentum: topMomentum[1] } : null;

          } else if (data.type === "narrativeVerdict") {
            narrativeVerdict = {
              text: data.text,
              favouredAgentId: data.favouredAgentId,
              agreesWithScorecard: data.agreesWithScorecard,
              conflictResolution: data.conflictResolution ?? null,
              scorecardInternallyConsistent: data.scorecardInternallyConsistent,
              convergence: data.convergence ?? null,
            };

          } else if (data.type === "finalScorecard") {
            finalScorecard = data.scorecard;
            // Update leader from final scorecard
            if (data.scorecard?.winTallies) {
              const tallies: [string, any][] = Object.entries(data.scorecard.winTallies);
              const topTally = tallies.sort((a: [string, any], b: [string, any]) => b[1].total - a[1].total)[0];
              if (topTally) {
                const info = getModelInfo(topTally[0]);
                currentLeader = {
                  agentId: topTally[0],
                  agentName: topTally[1].agentName || info.name,
                  score: topTally[1].total,
                  winTallies: data.scorecard.winTallies
                };
              }
            }
          } else if (data.type === "done") {
            done = true;
            running = false;
            naturallyEnded = true;
            typingAgentName = "";
            // Kick off the final live judge analysis
            runLiveJudging();
          } else if (data.type === "error") {
            errorMsg = data.message || "An AI failed to respond.";
            running = false;
            typingAgentName = "";
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        // User manually stopped
      } else {
        errorMsg = `Connection error: ${String(err)}`;
      }
    } finally {
      running = false;
      typingAgentName = "";
      streamingMessage = null;
    }
  }
</script>

<!-- Winner modal -->
{#if showWinnerModal}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    transition:fade={{ duration: 300 }}
  >
    <!-- Confetti canvas (sits behind modal content) -->
    <canvas
      bind:this={confettiCanvas}
      class="absolute inset-0 w-full h-full pointer-events-none"
    ></canvas>

    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black/85 backdrop-blur-sm"></div>

    <!-- Content -->
    <div
      class="relative z-10 flex flex-col items-center gap-6 text-center px-8"
      in:scale={{ start: 0.7, duration: 500 }}
    >
      <!-- Glow + name -->
      <div class="relative">
        <div
          class="absolute inset-0 blur-3xl opacity-50 rounded-full scale-150"
          style="background: {winner?.color}"
        ></div>
        <h2
          class="relative font-black uppercase leading-none"
          style="font-size: clamp(3.5rem, 12vw, 8rem); color: white; letter-spacing: -0.02em; text-shadow: 0 0 60px {winner?.color}99"
        >
          {winner?.name}
        </h2>
        <p
          class="font-black uppercase tracking-[0.15em] mt-1"
          style="font-size: clamp(2rem, 7vw, 4.5rem); color: {winner?.color}; text-shadow: 0 0 40px {winner?.color}66"
        >
          WINS!
        </p>
      </div>

      <!-- Score -->
      <p class="text-sm uppercase tracking-widest text-[--color-muted]">
        {finalScorecard ? `${winnerScore} round wins` : `Score: ${winnerScore?.toFixed(1)}`}
      </p>

      <!-- Close -->
      <button
        onclick={() => (showWinnerModal = false)}
        class="mt-2 px-10 py-3 rounded-xl font-bold text-sm text-white transition-all cursor-pointer hover:brightness-110 active:scale-95"
        style="background: {winner?.color}; box-shadow: 0 0 32px {winner?.color}55"
      >
        Close
      </button>
    </div>
  </div>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="w-full max-w-2xl flex flex-col gap-6"
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => e.preventDefault()}
>
  <!-- Header -->
  <header class="text-center flex flex-col items-center gap-2">
    <div class="relative">
      <div
        class="absolute inset-0 blur-2xl opacity-30 bg-[#7c6af7] rounded-full scale-150"
      ></div>
      <h1
        class="relative font-display text-5xl sm:text-6xl font-bold tracking-tight"
      >
        <span class="text-white">AI </span><span
          class="text-transparent bg-clip-text bg-gradient-to-r from-[#7c6af7] to-[#c084fc]"
          >Debate</span
        >
      </h1>
    </div>
    <p class="text-sm text-[--color-muted] tracking-wide">
      two AIs, one topic, no mercy
    </p>
    <Nav />
  </header>

  <!-- Setup card -->
  <div
    class="flex flex-col gap-6 bg-[--color-panel] border border-[--color-border] rounded-2xl p-4 sm:p-7"
  >
    <!-- Topic -->
    <div class="flex flex-col gap-1.5">
      <label
        for="topic"
        class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted]"
        >Topic</label
      >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="topic"
        type="text"
        bind:value={topic}
        onkeydown={onTopicKeydown}
        placeholder="What should they debate?"
        disabled={running}
        autofocus
        class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-4 text-base text-white placeholder:text-[--color-muted] outline-none transition-all focus:border-[--color-accent] focus:shadow-[0_0_0_3px_#7c6af722] disabled:opacity-40 disabled:cursor-not-allowed"
      />
    </div>

    <!-- Agents row -->
    <div class="grid grid-cols-[1fr_36px_1fr] items-end gap-2">
      <div class="flex flex-col gap-1.5">
        <label
          for="agentA"
          class="text-[11px] font-semibold uppercase tracking-widest flex items-center gap-1.5"
          style="color: {getModelInfo(agentA).color}"
        >
          <span
            class="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style="background: {getModelInfo(agentA).color}"
          ></span>
          Agent A
        </label>
        <select
          id="agentA"
          bind:value={agentA}
          disabled={running}
          class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-sm text-white outline-none transition-all focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
          style="border-left: 2px solid {getModelInfo(agentA).color}"
        >
          {#each MODEL_OPTIONS as group}
            <optgroup label={group.group}>
              {#each group.options as opt}
                <option value={opt.id}>{opt.name}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </div>

      <button
        type="button"
        onclick={swapAgents}
        disabled={running}
        title="Swap agents"
        class="h-[42px] flex items-center justify-center rounded-xl bg-[--color-surface] border border-[--color-border] hover:border-[--color-accent] hover:text-[--color-accent] text-[--color-muted] text-base transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        >⇄</button
      >

      <div class="flex flex-col gap-1.5">
        <label
          for="agentB"
          class="text-[11px] font-semibold uppercase tracking-widest flex items-center gap-1.5 justify-end"
          style="color: {getModelInfo(agentB).color}"
        >
          Agent B
          <span
            class="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style="background: {getModelInfo(agentB).color}"
          ></span>
        </label>
        <select
          id="agentB"
          bind:value={agentB}
          disabled={running}
          class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-sm text-white outline-none transition-all focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
          style="border-right: 2px solid {getModelInfo(agentB).color}"
        >
          {#each MODEL_OPTIONS as group}
            <optgroup label={group.group}>
              {#each group.options as opt}
                <option value={opt.id}>{opt.name}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </div>
    </div>

    <!-- Bottom row: turns + context toggle + actions -->
    <div class="flex items-center gap-3 flex-wrap">
      <div
        class="flex items-center gap-2 bg-[--color-surface] border border-[--color-border] rounded-xl px-3 py-2"
      >
        <label
          for="turns"
          class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted] whitespace-nowrap"
          >Turns</label
        >
        <input
          id="turns"
          type="number"
          bind:value={turns}
          min="2"
          max="30"
          disabled={running}
          class="w-12 bg-transparent text-sm text-white outline-none disabled:opacity-40 disabled:cursor-not-allowed text-center"
        />
      </div>

      <button
        type="button"
        onclick={() => {
          showFiles = !showFiles;
        }}
        class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest px-3 py-2 rounded-xl border transition-all cursor-pointer
{showFiles
          ? 'border-[--color-accent] text-[--color-accent] bg-[#7c6af7]/5'
          : 'border-[--color-border] text-[--color-muted] hover:border-[--color-muted] bg-[--color-surface]'}"
      >
        <svg
          class="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M15.172 7l-6.586 6.586a2 2 0 1 0 2.828 2.828l6.414-6.586a4 4 0 0 0-5.656-5.656l-6.415 6.585a6 6 0 1 0 8.486 8.486L20.5 13"
          />
        </svg>
        Files {#if contextFiles.length > 0}<span
            class="ml-0.5 bg-[--color-accent] text-white rounded-full px-1.5 py-0 text-[10px] leading-4"
            >{contextFiles.length}</span
          >{/if}
      </button>

      <div class="flex-1"></div>

      {#if running}
        <button
          type="button"
          onclick={pauseConversation}
          class="flex items-center gap-2 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
        >
          Pause
        </button>
        <button
          type="button"
          onclick={stopConversation}
          class="flex items-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"
          ></span>
          Stop
        </button>
      {:else if isPaused}
        <button
          type="button"
          onclick={() => startConversation(true)}
          class="bg-[--color-accent] hover:bg-[--color-accent-hover] text-white font-semibold text-sm px-7 py-2.5 rounded-xl transition-all cursor-pointer shadow-[0_0_24px_#7c6af740] hover:shadow-[0_0_32px_#7c6af760]"
          >Resume debate</button
        >
        <button
          type="button"
          onclick={stopConversation}
          class="flex items-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
        >
          Stop
        </button>
      {:else}
        <button
          type="button"
          onclick={() => {
            if (!running && topic.trim()) startConversation();
          }}
          disabled={!topic.trim()}
          class="bg-[--color-accent] hover:bg-[--color-accent-hover] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm px-7 py-2.5 rounded-xl transition-all cursor-pointer shadow-[0_0_24px_#7c6af740] hover:shadow-[0_0_32px_#7c6af760]"
          >Start debate</button
        >
      {/if}
    </div>

    {#if isPaused}
      <div
        class="flex flex-col gap-1.5 pt-2 border-t border-[--color-border-subtle]"
      >
        <label
          for="moderatorInput"
          class="text-[11px] font-semibold uppercase tracking-widest text-[#ff4b4b]"
          >Moderator Intervention</label
        >
        <input
          id="moderatorInput"
          type="text"
          bind:value={moderatorInput}
          onkeydown={onModeratorKeydown}
          placeholder="Add a point, sub-topic, or rebuttal..."
          class="w-full bg-[--color-surface] border border-[#ff4b4b]/30 rounded-xl px-4 py-3 text-sm text-white placeholder:text-[--color-muted] outline-none transition-all focus:border-[#ff4b4b] focus:shadow-[0_0_0_3px_#ff4b4b22]"
        />
        <p class="text-xs text-[--color-muted]">
          Hit <span class="text-white font-semibold">Enter</span> to inject message
          and resume debate
        </p>
      </div>
    {/if}

    {#if errorMsg}
      <div
        class="flex items-start gap-3 bg-red-950/50 border border-red-900/50 rounded-xl px-4 py-3 text-sm text-red-400"
      >
        <svg
          class="w-4 h-4 flex-shrink-0 mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
          />
        </svg>
        {errorMsg}
      </div>
    {/if}

    <!-- Context files (collapsible) -->
    {#if showFiles}
      <div
        class="flex flex-col gap-2 pt-1 border-t border-[--color-border-subtle]"
      >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <label
          for="file-input"
          class="flex items-center justify-center gap-2.5 border border-dashed rounded-xl px-5 py-3.5 cursor-pointer transition-all
{dragging
            ? 'border-[--color-accent] bg-[#7c6af7]/5'
            : 'border-[--color-border] hover:border-[--color-muted]'}"
          ondragover={(e) => {
            e.preventDefault();
            dragging = true;
          }}
          ondragleave={() => {
            dragging = false;
          }}
          ondrop={onDrop}
        >
          <svg
            class="w-4 h-4 text-[--color-muted] flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M12 16v-8m0 0-3 3m3-3 3 3M4 16v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"
            />
          </svg>
          <span class="text-sm text-[--color-muted-fg]"
            >Drop files or <span class="text-[--color-accent]">browse</span
            ></span
          >
          <span class="text-xs text-[--color-muted]"
            >.txt · .md · .csv · .json · 80 KB max</span
          >
          <input
            id="file-input"
            type="file"
            accept={ACCEPTED}
            multiple
            class="sr-only"
            onchange={onFileInput}
            disabled={running}
          />
        </label>
        {#if fileError}<p class="text-xs text-red-400">{fileError}</p>{/if}
        {#if contextFiles.length > 0}
          <div class="flex flex-wrap gap-2">
            {#each contextFiles as file (file.name)}
              <div
                class="flex items-center gap-2 bg-[--color-surface] border border-[--color-border] rounded-lg pl-3 pr-2 py-1.5"
              >
                <svg
                  class="w-3 h-3 text-[--color-muted] flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"
                  />
                </svg>
                <span
                  class="text-xs text-[--color-muted-fg] max-w-[140px] truncate"
                  >{file.name}</span
                >
                <span class="text-[10px] text-[--color-muted]"
                  >{(file.content.length / 1024).toFixed(1)}KB</span
                >
                <button
                  onclick={() => removeFile(file.name)}
                  disabled={running}
                  class="text-[--color-muted] hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer ml-0.5"
                  aria-label="Remove {file.name}"
                >
                  <svg
                    class="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Chat -->
  <div
    class="flex flex-col rounded-2xl border border-[--color-border] overflow-hidden bg-[--color-panel]"
  >
    <!-- Sticky progress bar -->
    {#if running || (done && messages.length > 0)}
      <div
        class="flex items-center gap-3 px-6 py-3 border-b border-[--color-border-subtle] bg-[--color-panel]/80 backdrop-blur-sm sticky top-0 z-10"
      >
        <div
          class="flex-1 h-1 bg-[--color-border] rounded-full overflow-hidden"
        >
          <div
            class="h-full rounded-full transition-all duration-500"
            style="width: {progress}%; background: linear-gradient(to right, #7c6af7, #c084fc)"
          ></div>
        </div>
        <span
          class="text-[11px] font-semibold tabular-nums text-[--color-muted] whitespace-nowrap"
          >{messages.length}<span class="text-[--color-border] mx-0.5">/</span
          >{turns * 2}</span
        >
        {#if done}
          <span
            class="text-[11px] uppercase tracking-widest text-[--color-muted]"
            >done</span
          >
        {/if}
      </div>
    {/if}

    <!-- Chat body -->
    <div
      bind:this={chatEl}
      class="flex flex-col overflow-y-auto scroll-smooth"
      style="min-height: 24rem; max-height: 68vh"
    >
      <!-- Empty state -->
      {#if messages.length === 0 && !running}
        <div
          class="flex flex-col items-center justify-center gap-8 flex-1 py-16 px-6"
        >
          <div class="flex items-center gap-8">
            <div class="flex flex-col items-center gap-2.5">
              <div
                class="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shadow-lg"
                style="background: linear-gradient(135deg, {getModelInfo(
                  agentA,
                ).color}22, {getModelInfo(agentA)
                  .color}08); color: {getModelInfo(agentA)
                  .color}; border: 1px solid {getModelInfo(agentA).color}30"
              >
                {getModelInfo(agentA).name[0]}
              </div>
              <span
                class="text-xs font-semibold text-center max-w-[100px] leading-snug"
                style="color: {getModelInfo(agentA).color}"
                >{getModelInfo(agentA).name}</span
              >
            </div>

            <div class="flex flex-col items-center gap-1">
              <span
                class="text-[11px] font-bold uppercase tracking-[0.4em] text-[--color-muted]"
                >vs</span
              >
              <div class="flex gap-1">
                <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
                <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
                <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
              </div>
            </div>

            <div class="flex flex-col items-center gap-2.5">
              <div
                class="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shadow-lg"
                style="background: linear-gradient(135deg, {getModelInfo(
                  agentB,
                ).color}22, {getModelInfo(agentB)
                  .color}08); color: {getModelInfo(agentB)
                  .color}; border: 1px solid {getModelInfo(agentB).color}30"
              >
                {getModelInfo(agentB).name[0]}
              </div>
              <span
                class="text-xs font-semibold text-center max-w-[100px] leading-snug"
                style="color: {getModelInfo(agentB).color}"
                >{getModelInfo(agentB).name}</span
              >
            </div>
          </div>
          {#if topic.trim()}
            <div class="max-w-sm text-center">
              <p
                class="text-xs uppercase tracking-widest text-[--color-muted] mb-2"
              >
                Topic
              </p>
              <p
                class="text-base text-[--color-muted-fg] font-medium leading-snug"
              >
                "{topic}"
              </p>
            </div>
          {/if}
          <p class="text-sm text-[--color-muted] text-center">
            Hit <span class="text-white font-semibold">Start debate</span> to begin
            · Ctrl+Enter
          </p>
        </div>
      {/if}

      <!-- Messages -->
      {#each messages as msg, i (i)}
        {@const isModerator = msg.agentId === "moderator"}
        {@const isLeft = !isModerator && msg.agentId === leftAgentId}
        {#if isModerator}
          <div
            class="flex flex-col items-center gap-2 px-6 py-6 border-t border-[--color-border-subtle]"
            style="animation: fadeSlide 0.2s ease both; animation-delay: {Math.min(
              i * 20,
              100,
            )}ms"
          >
            <span
              class="text-[10px] font-bold uppercase tracking-widest text-[#ff4b4b] bg-[#ff4b4b]/10 px-3 py-1 rounded-full border border-[#ff4b4b]/20"
              >Moderator Intervened</span
            >
            <p
              class="text-[14.5px] leading-relaxed text-white text-center max-w-[95%] sm:max-w-[80%] italic"
            >
              "{msg.text}"
            </p>
          </div>
        {:else}
          <div
            class="group flex gap-3 px-3 py-3 sm:px-6 sm:py-4 border-t border-[--color-border-subtle] {isLeft
              ? ''
              : 'sm:flex-row-reverse'}"
            style="animation: fadeSlide 0.2s ease both; animation-delay: {Math.min(
              i * 20,
              100,
            )}ms"
          >
            <!-- Avatar -->
            <div class="flex-shrink-0 flex flex-col items-center gap-1.5">
              <div
                class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold"
                style="background: linear-gradient(135deg, {msg.color}22, {msg.color}0a); color: {msg.color}; border: 1px solid {msg.color}28"
              >
                {msg.agentName[0]}
              </div>
              <span
                class="text-[10px] tabular-nums text-[--color-border] group-hover:text-[--color-muted] transition-colors"
                >#{i + 1}</span
              >
            </div>
            <!-- Bubble -->
            <div
              class="flex flex-col gap-1.5 min-w-0 {isLeft
                ? 'items-start'
                : 'items-start sm:items-end'}"
              style="max-width: calc(100% - 3rem)"
            >
              <span
                class="text-[10px] font-bold uppercase tracking-widest"
                style="color: {msg.color}">{msg.agentName}</span
              >
              <div
                class="message-content text-[14px] sm:text-[15px] leading-relaxed sm:leading-[1.72] text-[#d4d4e8] px-3 py-3 sm:px-5 sm:py-4 rounded-2xl {isLeft
                  ? 'rounded-tl-sm border-l-2'
                  : 'rounded-tr-sm border-r-2'}"
                style="background-color: {msg.color}09; border-color: {msg.color}30; border-top: 1px solid {msg.color}1a; border-bottom: 1px solid {msg.color}1a; {isLeft
                  ? ''
                  : 'border-left: 1px solid ' + msg.color + '1a'}"
              >
                {@html formatMessage(msg.text)}
              </div>
            </div>
          </div>
        {/if}
      {/each}

      <!-- Live stream / typing indicator -->
      {#if running}
        {#if streamingMessage}
          {@const isLeft = streamingMessage.agentId === leftAgentId}
          <div
            class="flex gap-3 px-3 py-3 sm:px-6 sm:py-4 border-t border-[--color-border-subtle] {isLeft
              ? ''
              : 'sm:flex-row-reverse'}"
            style="animation: fadeSlide 0.15s ease both"
          >
            <div class="flex-shrink-0 flex flex-col items-center gap-1.5">
              <div
                class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ring-2 ring-offset-1 ring-offset-[--color-panel] transition-all"
                style="background: linear-gradient(135deg, {streamingMessage.color}22, {streamingMessage.color}0a); color: {streamingMessage.color}; border: 1px solid {streamingMessage.color}28; ring-color: {streamingMessage.color}"
              >
                {streamingMessage.agentName[0]}
              </div>
              <span class="text-[10px] tabular-nums text-[--color-muted]"
                >#{messages.length + 1}</span
              >
            </div>
            <div
              class="flex flex-col gap-1.5 min-w-0 {isLeft
                ? 'items-start'
                : 'items-start sm:items-end'}"
              style="max-width: calc(100% - 3rem)"
            >
              <span
                class="text-[10px] font-bold uppercase tracking-widest"
                style="color: {streamingMessage.color}"
                >{streamingMessage.agentName}</span
              >
              <div
                class="message-content text-[14px] sm:text-[15px] leading-relaxed sm:leading-[1.72] text-[#d4d4e8] px-3 py-3 sm:px-5 sm:py-4 rounded-2xl {isLeft
                  ? 'rounded-tl-sm border-l-2'
                  : 'rounded-tr-sm border-r-2'}"
                style="background-color: {streamingMessage.color}09; border-color: {streamingMessage.color}30; border-top: 1px solid {streamingMessage.color}1a; border-bottom: 1px solid {streamingMessage.color}1a; {isLeft
                  ? ''
                  : 'border-left: 1px solid ' +
                    streamingMessage.color +
                    '1a'}"
              >
                {@html formatMessage(streamingMessage.text)}<span
                  class="inline-block w-[2px] h-[0.9em] ml-[2px] align-text-bottom rounded-sm animate-pulse"
                  style="background: {streamingMessage.color}"
                ></span>
              </div>
            </div>
          </div>
        {:else}
          <div
            class="flex items-center gap-3 px-6 py-4 {messages.length > 0
              ? 'border-t border-[--color-border-subtle]'
              : ''}"
          >
            {#if typingAgentName}
              <div
                class="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0 ring-1"
                style="background: {typingAgentColor}15; color: {typingAgentColor}; ring-color: {typingAgentColor}30"
              >
                {typingAgentName[0]}
              </div>
            {/if}
            <div class="flex gap-1 items-center">
              <span
                class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms]"
                style="background: {typingAgentColor ||
                  'var(--color-muted)'}"
              ></span>
              <span
                class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:160ms]"
                style="background: {typingAgentColor ||
                  'var(--color-muted)'}"
              ></span>
              <span
                class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:320ms]"
                style="background: {typingAgentColor ||
                  'var(--color-muted)'}"
              ></span>
            </div>
            {#if typingAgentName}
              <span
                class="text-xs text-[--color-muted]"
                style="color: {typingAgentColor}AA"
                >{typingAgentName} is thinking…</span
              >
            {/if}
          </div>
        {/if}
      {/if}

      {#if done}
        <div
          class="flex items-center gap-3 px-6 py-4 border-t border-[--color-border-subtle]"
        >
          <div class="flex-1 h-px bg-[--color-border-subtle]"></div>
          <span
            class="text-[11px] uppercase tracking-widest text-[--color-muted]"
            >Debate ended · {messages.filter((m) => m.agentId !== "moderator")
              .length} turns</span
          >
          <div class="flex-1 h-px bg-[--color-border-subtle]"></div>
        </div>
      {/if}
    </div>
  </div>

  <!-- ── Live Judge Panel ─────────────────────────────────────────────────────── -->
  {#if showLiveJudgePanel}
    <div
      id="live-judge-panel"
      class="flex flex-col gap-4"
      in:fade={{ duration: 400 }}
    >
      <!-- Section header -->
      <div class="flex items-center gap-3 mt-2">
        <div class="flex-1 h-px bg-[--color-border]"></div>
        <span
          class="text-[11px] font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-full border"
          style="color: #c084fc; border-color: #7c6af740; background: #7c6af708"
          >⚖️ Live Judge Analysis</span
        >
        <div class="flex-1 h-px bg-[--color-border]"></div>
      </div>

      <!-- Scorecard — win tallies -->
      {#if currentLeader?.winTallies}
        {@const tallies = currentLeader.winTallies}
        <div
          class="rounded-2xl border overflow-hidden bg-[--color-panel]"
          style="border-color: #7c6af740"
          in:fade={{ duration: 300 }}
        >
          <div
            class="flex items-center gap-3 px-4 py-3 border-b"
            style="border-color: #7c6af725; background: #7c6af708"
          >
            <span class="text-sm font-bold" style="color: #c084fc">Scorecard</span>
            <span class="text-[10px] text-[--color-muted] ml-1">turn-by-turn · per-round argument quality</span>
          </div>
          <div class="px-4 py-3 flex flex-col gap-2">
            {#each Object.entries(tallies) as [agentId, tally]}
              {@const info = getModelInfo(agentId)}
              {@const isLeader = agentId === currentLeader.agentId}
              <div class="flex items-center gap-3">
                <div
                  class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style="background: {info.color}18; color: {info.color}; border: 1px solid {info.color}28"
                >
                  {info.name[0]}
                </div>
                <span class="text-sm font-medium flex-1 {isLeader ? '' : 'text-[--color-muted-fg]'}" style="{isLeader ? `color: ${info.color}` : ''}">
                  {tally.agentName}
                </span>
                <div class="flex items-center gap-3 text-xs">
                  <span title="Logic wins" class="flex flex-col items-center">
                    <span class="text-[--color-muted] text-[10px]">Logic</span>
                    <span style="color: {tally.logic > 0 ? '#34d399' : '#6b7280'}">{tally.logic}</span>
                  </span>
                  <span title="Tactics wins" class="flex flex-col items-center">
                    <span class="text-[--color-muted] text-[10px]">Tactics</span>
                    <span style="color: {tally.tactics > 0 ? '#60a5fa' : '#6b7280'}">{tally.tactics}</span>
                  </span>
                  <span title="Rhetoric wins" class="flex flex-col items-center">
                    <span class="text-[--color-muted] text-[10px]">Rhetoric</span>
                    <span style="color: {tally.rhetoric > 0 ? '#f472b6' : '#6b7280'}">{tally.rhetoric}</span>
                  </span>
                  <span title="Total wins" class="flex flex-col items-center border-l border-[--color-border] pl-3">
                    <span class="text-[--color-muted] text-[10px]">Total</span>
                    <span class="font-bold" style="color: {info.color}">{tally.total}</span>
                  </span>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {:else if currentLeader}
        <!-- Fallback leader display before first pairwise round -->
        {@const leaderInfo = getModelInfo(currentLeader.agentId)}
        <div
          class="rounded-2xl border overflow-hidden bg-[--color-panel]"
          style="border-color: #7c6af740"
          in:fade={{ duration: 300 }}
        >
          <div class="px-4 py-3 flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0"
              style="background: {leaderInfo.color}15; color: {leaderInfo.color}"
            >{leaderInfo.name[0]}</div>
            <div>
              <div class="text-sm font-semibold" style="color: {leaderInfo.color}">{leaderInfo.name}</div>
              <div class="text-[10px] text-[--color-muted]">Early leader — pairwise scoring starts Turn 2</div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Language warning -->
      {#if pairwiseRounds.some(r => r.languageWarning)}
        <div class="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-xs text-yellow-400" in:fade>
          {pairwiseRounds.find(r => r.languageWarning)?.languageWarning}
        </div>
      {/if}

      <!-- Recent pairwise rounds -->
      {#if pairwiseRounds.length > 0}
        <div class="flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-[--color-muted-fg] px-1">
            Recent Rounds
          </h3>
          {#each pairwiseRounds.slice(-3).reverse() as round (round.roundNumber)}
            {@const logicWinnerInfo = getModelInfo(round.logicWinner)}
            {@const tacticsWinnerInfo = getModelInfo(round.tacticsWinner)}
            {@const rhetoricWinnerInfo = getModelInfo(round.rhetoricWinner)}
            <div
              class="rounded-xl border bg-[--color-panel] p-3"
              style="border-color: #7c6af720"
              in:fade={{ duration: 200 }}
            >
              <!-- Round header -->
              <div class="flex items-center gap-2 mb-3">
                <span class="text-[10px] font-bold uppercase tracking-widest text-[--color-muted]">Round {round.roundNumber}</span>
                <span class="text-[10px] text-[--color-muted]">·</span>
                <span class="text-[10px] text-[--color-muted]">T{round.prevTurn.turnNumber} ({round.prevTurn.agentName}) vs T{round.curTurn.turnNumber} ({round.curTurn.agentName})</span>
                {#if round.isFallback}
                  <span class="ml-auto text-[10px] text-yellow-500">fallback</span>
                {/if}
              </div>

              <!-- Winner chips -->
              <div class="grid grid-cols-3 gap-2 mb-3">
                <div class="flex flex-col gap-1">
                  <span class="text-[10px] text-[--color-muted] uppercase tracking-wide">Logic</span>
                  <span class="text-xs font-semibold truncate" style="color: {logicWinnerInfo.color}">{logicWinnerInfo.name}</span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-[10px] text-[--color-muted] uppercase tracking-wide">Tactics</span>
                  <span class="text-xs font-semibold truncate" style="color: {tacticsWinnerInfo.color}">{tacticsWinnerInfo.name}</span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-[10px] text-[--color-muted] uppercase tracking-wide">Rhetoric</span>
                  <span class="text-xs font-semibold truncate" style="color: {rhetoricWinnerInfo.color}">{rhetoricWinnerInfo.name}</span>
                </div>
              </div>

              <!-- Logic delta (2-3 sentences) -->
              <div class="pt-2 border-t border-[--color-border]">
                <p class="text-[11px] text-[--color-muted-fg] leading-relaxed">{round.logicDelta}</p>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Per-turn absolute scores -->
      {#if liveJudgeResults.some(r => r.absoluteScores)}
        {@const scoredTurns = liveJudgeResults.filter(r => r.absoluteScores)}
        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-[--color-muted-fg] px-1">Turn Scores</h3>
          <div class="rounded-xl border bg-[--color-panel] overflow-hidden" style="border-color: #7c6af720">
            <div class="grid text-[10px] font-semibold uppercase tracking-wide text-[--color-muted] px-3 py-2 border-b border-[--color-border]" style="grid-template-columns: 2.5rem 1fr 3rem 3rem 3rem 3rem">
              <span>Turn</span>
              <span>Agent</span>
              <span class="text-center">Logic</span>
              <span class="text-center">Rhet.</span>
              <span class="text-center">Tact.</span>
              <span class="text-center">Score</span>
            </div>
            {#each scoredTurns as r (r.turnNumber)}
              {@const info = getModelInfo(r.agentId)}
              {@const s = r.absoluteScores}
              <div class="grid items-center px-3 py-2 border-b border-[--color-border] last:border-0 text-xs gap-1" style="grid-template-columns: 2.5rem 1fr 3rem 3rem 3rem 3rem">
                <span class="text-[--color-muted] text-[11px]">T{r.turnNumber}</span>
                <span class="font-medium truncate" style="color: {info.color}">{info.name}</span>
                <span class="text-center font-mono text-[11px]" title="Logic: {s.logicalCoherence}/40">{s.logicalCoherence}<span class="text-[--color-muted]">/40</span></span>
                <span class="text-center font-mono text-[11px]" title="Rhetoric: {s.rhetoricalForce}/30">{s.rhetoricalForce}<span class="text-[--color-muted]">/30</span></span>
                <span class="text-center font-mono text-[11px]" title="Tactics: {s.tacticalEffectiveness}/30">{s.tacticalEffectiveness}<span class="text-[--color-muted]">/30</span></span>
                <span class="text-center font-mono text-[11px] font-semibold" style="color: {info.color}">{s.overallScore}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Narrative verdict (shown after debate completes) -->
      {#if narrativeVerdict}
        <div
          class="rounded-2xl border overflow-hidden bg-[--color-panel]"
          style="border-color: {narrativeVerdict.agreesWithScorecard ? '#7c6af740' : '#f59e0b40'}"
          in:fade={{ duration: 500 }}
        >
          <div
            class="flex items-center gap-3 px-4 py-3 border-b"
            style="border-color: {narrativeVerdict.agreesWithScorecard ? '#7c6af725' : '#f59e0b25'}; background: {narrativeVerdict.agreesWithScorecard ? '#7c6af708' : '#f59e0b08'}"
          >
            <div class="flex flex-col">
              <span class="text-sm font-bold" style="color: {narrativeVerdict.agreesWithScorecard ? '#c084fc' : '#fbbf24'}">
                {narrativeVerdict.agreesWithScorecard ? 'Narrative Verdict' : '⚡ Narrative Arc Diverges'}
              </span>
              <span class="text-[10px] text-[--color-muted]">arc-level · cumulative thesis coherence</span>
            </div>
            {#if narrativeVerdict.favouredAgentId}
              {@const favouredInfo = getModelInfo(narrativeVerdict.favouredAgentId)}
              <span class="ml-auto text-xs font-semibold" style="color: {favouredInfo.color}">→ {favouredInfo.name}</span>
            {/if}
          </div>
          <div class="px-4 py-4">
            <p class="text-sm text-[--color-muted-fg] leading-relaxed whitespace-pre-line">{narrativeVerdict.text}</p>
          </div>
          {#if narrativeVerdict.conflictResolution}
            <div class="px-4 pb-4 pt-0">
              <div class="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                {#if narrativeVerdict.scorecardInternallyConsistent === false}
                  <p class="text-[11px] font-semibold text-amber-400 mb-1">Why they diverged · scorecard internally split</p>
                {:else}
                  <p class="text-[11px] font-semibold text-amber-400 mb-1">Why they diverged</p>
                {/if}
                <p class="text-[11px] text-[--color-muted-fg] leading-relaxed">{narrativeVerdict.conflictResolution}</p>
              </div>
            </div>
          {/if}
          {#if narrativeVerdict.convergence?.detected}
            {@const conv = narrativeVerdict.convergence}
            <div class="px-4 pb-4 pt-0">
              <div class="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2.5">
                <p class="text-[11px] font-semibold text-sky-400 mb-1">
                  ⚠ Positional convergence detected
                  {#if conv.convergenceTurnRange} · {conv.convergenceTurnRange}{/if}
                </p>
                {#if conv.positionalGapDescription}
                  <p class="text-[11px] text-[--color-muted-fg] leading-relaxed mb-1">{conv.positionalGapDescription}</p>
                {/if}
                <p class="text-[11px] text-[--color-muted] leading-relaxed">
                  Remaining disagreement: <span class="text-sky-300/80">{conv.remainingDisagreementType}</span>
                  · Motion viability: <span class="text-sky-300/80">{conv.motionViability === 'degenerate_convergence' ? 'degenerate — opposition collapsed' : conv.motionViability}</span>
                </p>
              </div>
            </div>
          {/if}
        </div>
      {/if}

    </div>
  {/if}

  <!-- Export -->
  {#if messages.length > 0}
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
        onclick={resetConversation}
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
  {/if}
</div>

<style>
  .message-content :global(p) {
    margin-bottom: 0.6em;
    line-height: inherit;
  }
  .message-content :global(p:last-child) {
    margin-bottom: 0;
  }
  .message-content :global(strong) {
    color: #f0f0fa;
    font-weight: 620;
  }
  .message-content :global(em) {
    font-style: italic;
    opacity: 0.88;
  }
  .message-content :global(code) {
    font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace;
    font-size: 0.84em;
    background: rgba(255, 255, 255, 0.07);
    padding: 0.1em 0.38em;
    border-radius: 0.3em;
    border: 1px solid rgba(255, 255, 255, 0.09);
  }
  .message-content :global(ul),
  .message-content :global(ol) {
    padding-left: 1.35em;
    margin-bottom: 0.6em;
    display: flex;
    flex-direction: column;
    gap: 0.28em;
  }
  .message-content :global(ul) {
    list-style: disc;
  }
  .message-content :global(ol) {
    list-style: decimal;
  }
  .message-content :global(ul:last-child),
  .message-content :global(ol:last-child) {
    margin-bottom: 0;
  }
  .message-content :global(li) {
    line-height: 1.6;
  }
  .message-content :global(li::marker) {
    opacity: 0.5;
  }
</style>