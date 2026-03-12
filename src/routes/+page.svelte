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

  interface JudgeResult {
    model: { id: string; name: string; color: string };
    text: string;
    vote: string;
  }

  const MAX_FILE_BYTES = 80_000;
  const ACCEPTED = ".txt,.md,.csv,.json";

  let topic = $state("");
  let turns = $state(20);
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
    turns > 0 ? Math.min((messages.length / turns) * 100, 100) : 0,
  );

  // UI state
  let showFiles = $state(false);

  // ── Judging phase ─────────────────────────────────────────────────────────
  let naturallyEnded = $state(false);
  let judgingAnnouncing = $state(false);
  let judgingPhase = $state(false);
  let judgeModels = $state<{ id: string; name: string; color: string }[]>([]);
  let judgeResults = $state<JudgeResult[]>([]);
  let currentJudgeIndex = $state(-1);
  let judgeStreamingText = $state("");

  // Winner modal
  let winner = $state<{ id: string; name: string; color: string } | null>(null);
  let winnerVoteCount = $state(0);
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

  // ── Judge logic ───────────────────────────────────────────────────────────
  async function runJudging() {
    // 1. Brief announcement modal
    judgingAnnouncing = true;
    await new Promise((r) => setTimeout(r, 2800));
    judgingAnnouncing = false;

    // 2. Pick 3 judges (exclude agentA and agentB, shuffle for variety)
    const allModels = MODEL_OPTIONS.flatMap((g) => g.options);
    const eligible = allModels.filter(
      (m) => m.id !== agentA && m.id !== agentB,
    );
    const shuffled = [...eligible].sort(() => Math.random() - 0.5);
    judgeModels = shuffled.slice(0, 3);

    judgingPhase = true;
    judgeResults = [];

    const agentAInfo = getModelInfo(agentA);
    const agentBInfo = getModelInfo(agentB);

    // Build transcript (skip moderator messages)
    const transcript = messages
      .filter((m) => m.agentId !== "moderator")
      .map((m) => `[${m.agentName}]: ${m.text}`)
      .join("\n\n---\n\n");

    // 3. Stream each judge's verdict sequentially
    for (let i = 0; i < judgeModels.length; i++) {
      const judge = judgeModels[i];
      currentJudgeIndex = i;
      judgeStreamingText = "";

      // Scroll to judges panel
      await tick();
      const judgesEl = document.getElementById("judges-panel");
      judgesEl?.scrollIntoView({ behavior: "smooth", block: "start" });

      let fullText = "";
      try {
        const response = await fetch("/api/judge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            judgeId: judge.id,
            agentAName: agentAInfo.name,
            agentBName: agentBInfo.name,
            topic,
            transcript,
          }),
        });

        if (response.ok && response.body) {
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
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "token") {
                  fullText += data.text;
                  judgeStreamingText = fullText;
                }
              } catch {
                // ignore malformed chunks
              }
            }
          }
        }
      } catch {
        // If judge call fails, skip gracefully
      }

      // Parse vote from the final text
      const voteMatch = fullText.match(/^\*{0,2}VOTE:\s*(.+?)[\s*]*$/im);
      const voteName = voteMatch?.[1]?.trim() ?? "";
      const vote =
        voteName.toLowerCase().includes(agentAInfo.name.toLowerCase())
          ? agentA
          : agentBInfo.name.toLowerCase().includes(voteName.toLowerCase()) ||
              voteName.toLowerCase().includes(agentBInfo.name.toLowerCase())
            ? agentB
            : agentA; // fallback to A if unparseable

      judgeResults = [
        ...judgeResults,
        { model: judge, text: fullText, vote },
      ];
      currentJudgeIndex = -1;
      judgeStreamingText = "";

      // Small pause between judges
      if (i < judgeModels.length - 1) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    // 4. Tally votes
    const votesForA = judgeResults.filter((r) => r.vote === agentA).length;
    const votesForB = judgeResults.filter((r) => r.vote === agentB).length;
    const winnerInfo =
      votesForA > votesForB ? getModelInfo(agentA) : getModelInfo(agentB);
    winner = winnerInfo;
    winnerVoteCount = Math.max(votesForA, votesForB);

    // 5. Show winner modal then fire confetti
    await new Promise((r) => setTimeout(r, 800));
    showWinnerModal = true;
    await tick();
    launchConfetti();
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
    judgingPhase = false;
    judgingAnnouncing = false;
    judgeModels = [];
    judgeResults = [];
    currentJudgeIndex = -1;
    judgeStreamingText = "";
    winner = null;
    winnerVoteCount = 0;
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

      if (judgeResults.length > 0) {
        content += "\n\n---\n\n## Judges' Deliberation\n\n";
        content += judgeResults
          .map((r, i) => {
            const votedFor = getModelInfo(r.vote);
            const deliberation = r.text.replace(/\n?\*{0,2}VOTE:\s*.+$/im, "").trim();
            return `### 🧑‍⚖️ Judge ${i + 1} · ${r.model.name}\n\n> **Voted:** ${votedFor.name}\n\n${deliberation}`;
          })
          .join("\n\n---\n\n");

        const votesA = judgeResults.filter((r) => r.vote === agentA).length;
        const votesB = judgeResults.filter((r) => r.vote === agentB).length;
        content += "\n\n---\n\n## Final Verdict\n\n";
        content += `| Model | Votes |\n|---|---|\n| ${agentAInfo.name} | ${votesA} |\n| ${agentBInfo.name} | ${votesB} |\n\n`;
        if (winner) {
          content += `🏆 **Winner: ${winner.name}** (${winnerVoteCount} of ${judgeModels.length} judges)\n`;
        }
      }

      mime = "text/markdown";
      ext = "md";
    } else {
      content = `DEBATE: ${topic}\nExported: ${date}\n${"─".repeat(40)}\n\n`;
      content += messages
        .map((m) => `[${m.agentName}]\n${m.text}`)
        .join("\n\n");

      if (judgeResults.length > 0) {
        content += `\n\n${"═".repeat(40)}\nJUDGES' DELIBERATION\n\n`;
        content += judgeResults
          .map((r, i) => {
            const votedFor = getModelInfo(r.vote);
            const deliberation = r.text.replace(/\n?\*{0,2}VOTE:\s*.+$/im, "").trim();
            return `[Judge ${i + 1} — ${r.model.name}]\nVoted: ${votedFor.name}\n\n${deliberation}`;
          })
          .join(`\n\n${"─".repeat(40)}\n\n`);

        const votesA = judgeResults.filter((r) => r.vote === agentA).length;
        const votesB = judgeResults.filter((r) => r.vote === agentB).length;
        content += `\n\n${"═".repeat(40)}\nFINAL VERDICT\n${agentAInfo.name}: ${votesA} vote${votesA !== 1 ? "s" : ""}\n${agentBInfo.name}: ${votesB} vote${votesB !== 1 ? "s" : ""}`;
        if (winner) {
          content += `\nWinner: ${winner.name}`;
        }
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
      // Reset judging state for fresh debate
      naturallyEnded = false;
      judgingPhase = false;
      judgingAnnouncing = false;
      judgeModels = [];
      judgeResults = [];
      currentJudgeIndex = -1;
      judgeStreamingText = "";
      winner = null;
      winnerVoteCount = 0;
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
            const aiCount = messages.filter(
              (m) => m.agentId !== "moderator",
            ).length;
            if (aiCount < turns) {
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
          } else if (data.type === "done") {
            done = true;
            running = false;
            naturallyEnded = true;
            typingAgentName = "";
            // Kick off the judging panel automatically
            runJudging();
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

<!-- Judging announcement modal -->
{#if judgingAnnouncing}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md"
    transition:fade={{ duration: 500 }}
  >
    <div
      class="flex flex-col items-center gap-5 text-center px-8"
      in:scale={{ start: 0.82, duration: 700 }}
    >
      <div class="text-7xl" style="filter: drop-shadow(0 0 24px #7c6af7aa)">
        ⚖️
      </div>
      <p
        class="text-2xl font-black uppercase tracking-[0.25em] text-[--color-muted]"
      >
        The Judges Are
      </p>
      <p
        class="text-4xl font-black uppercase tracking-[0.3em]"
        style="color: #c084fc; text-shadow: 0 0 40px #7c6af799"
      >
        Deliberating…
      </p>
      <div class="flex gap-2 mt-2">
        <span
          class="w-2 h-2 rounded-full bg-[#7c6af7] animate-bounce [animation-delay:0ms]"
        ></span>
        <span
          class="w-2 h-2 rounded-full bg-[#7c6af7] animate-bounce [animation-delay:180ms]"
        ></span>
        <span
          class="w-2 h-2 rounded-full bg-[#7c6af7] animate-bounce [animation-delay:360ms]"
        ></span>
      </div>
    </div>
  </div>
{/if}

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

      <!-- Vote tally -->
      <p class="text-sm uppercase tracking-widest text-[--color-muted]">
        {winnerVoteCount} of {judgeModels.length} judges voted in favour
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
          autofocus
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
          >{turns}</span
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

  <!-- ── Judges Panel ─────────────────────────────────────────────────────── -->
  {#if judgingPhase}
    <div
      id="judges-panel"
      class="flex flex-col gap-4"
      in:fade={{ duration: 400 }}
    >
      <!-- Section header -->
      <div class="flex items-center gap-3 mt-2">
        <div class="flex-1 h-px bg-[--color-border]"></div>
        <span
          class="text-[11px] font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-full border"
          style="color: #c084fc; border-color: #7c6af740; background: #7c6af708"
          >🎤 The Judges</span
        >
        <div class="flex-1 h-px bg-[--color-border]"></div>
      </div>

      <!-- Judge cards -->
      {#each judgeModels as judge, i}
        {@const result = judgeResults[i]}
        {@const isStreaming = currentJudgeIndex === i}
        {@const isPending = !result && !isStreaming}

        <div
          class="rounded-2xl border overflow-hidden bg-[--color-panel] transition-all duration-300"
          style="border-color: {result || isStreaming
            ? judge.color + '40'
            : 'var(--color-border)'}"
          in:fade={{ duration: 300, delay: i * 80 }}
        >
          <!-- Judge header -->
          <div
            class="flex items-center gap-3 px-3 py-3 sm:px-5 border-b"
            style="border-color: {result || isStreaming
              ? judge.color + '25'
              : 'var(--color-border-subtle)'}; background: {result ||
            isStreaming
              ? judge.color + '08'
              : 'transparent'}"
          >
            <!-- Avatar -->
            <div
              class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all"
              class:ring-2={isStreaming}
              style="background: {judge.color}18; color: {judge.color}; border: 1px solid {judge.color}30; {isStreaming
                ? 'box-shadow: 0 0 0 2px ' + judge.color + '60'
                : ''}"
            >
              {judge.name[0]}
            </div>
            <div class="flex flex-col min-w-0">
              <span class="text-sm font-semibold" style="color: {judge.color}"
                >{judge.name}</span
              >
              <span class="text-[10px] text-[--color-muted]"
                >Judge #{i + 1}</span
              >
            </div>

            <div class="ml-auto flex items-center gap-2">
              {#if isStreaming}
                <span
                  class="text-[10px] font-bold uppercase tracking-wider text-[--color-muted] flex items-center gap-1.5"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full animate-pulse"
                    style="background: {judge.color}"
                  ></span>
                  Deliberating
                </span>
              {:else if result}
                <!-- Vote badge -->
                {@const votedFor = getModelInfo(result.vote)}
                <span
                  class="text-[11px] font-bold px-3 py-1 rounded-full"
                  style="background: {votedFor.color}20; color: {votedFor.color}; border: 1px solid {votedFor.color}35"
                >
                  Voted: {votedFor.name}
                </span>
              {:else if isPending}
                <span
                  class="text-[10px] text-[--color-muted] uppercase tracking-wider"
                  >Waiting…</span
                >
              {/if}
            </div>
          </div>

          <!-- Judge body -->
          <div class="px-3 py-3 sm:px-5 sm:py-4 text-[14px] sm:text-[15px] leading-relaxed sm:leading-[1.72] text-[#d4d4e8]">
            {#if result}
              <!-- Strip the VOTE line from display -->
              <div class="message-content">
                {@html formatMessage(
                  result.text.replace(/\n?\*{0,2}VOTE:\s*.+$/im, "").trim(),
                )}
              </div>
            {:else if isStreaming}
              <div class="message-content">
                {@html formatMessage(judgeStreamingText.replace(/\n?\*{0,2}VOTE:\s*.+$/im, "").trim())}<span
                  class="inline-block w-[2px] h-[0.9em] ml-[2px] align-text-bottom rounded-sm animate-pulse"
                  style="background: {judge.color}"
                ></span>
              </div>
            {:else}
              <!-- Pending placeholder -->
              <div class="flex items-center gap-2 text-[--color-muted]">
                <span
                  class="w-1.5 h-1.5 rounded-full bg-[--color-border] animate-pulse"
                ></span>
                <span class="text-sm">Waiting to deliberate…</span>
              </div>
            {/if}
          </div>
        </div>
      {/each}

      <!-- Vote tally (shown once all judges done) -->
      {#if judgeResults.length === judgeModels.length && judgeModels.length > 0}
        {@const votesA = judgeResults.filter((r) => r.vote === agentA).length}
        {@const votesB = judgeResults.filter((r) => r.vote === agentB).length}
        {@const infoA = getModelInfo(agentA)}
        {@const infoB = getModelInfo(agentB)}
        <div
          class="flex items-center justify-center gap-6 py-4 rounded-2xl border bg-[--color-panel]"
          style="border-color: var(--color-border)"
          in:fade={{ duration: 400 }}
        >
          <div class="flex flex-col items-center gap-1">
            <span
              class="text-3xl font-black tabular-nums"
              style="color: {infoA.color}">{votesA}</span
            >
            <span
              class="text-[11px] font-semibold uppercase tracking-widest"
              style="color: {infoA.color}99">{infoA.name}</span
            >
          </div>
          <span class="text-[--color-border] text-2xl font-light">—</span>
          <div class="flex flex-col items-center gap-1">
            <span
              class="text-3xl font-black tabular-nums"
              style="color: {infoB.color}">{votesB}</span
            >
            <span
              class="text-[11px] font-semibold uppercase tracking-widest"
              style="color: {infoB.color}99">{infoB.name}</span
            >
          </div>
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