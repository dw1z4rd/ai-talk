<script lang="ts">
  import Nav from "$lib/Nav.svelte";
</script>

<div class="w-full max-w-3xl mx-auto flex flex-col gap-12">
  <!-- Header -->
  <header class="text-center flex flex-col items-center gap-2">
    <div class="relative">
      <div
        class="absolute inset-0 blur-2xl opacity-30 rounded-full scale-150"
        style="background-color: #7c6af7"
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

  <!-- What is this -->
  <section class="flex flex-col gap-4">
    <h2 class="font-display text-2xl font-bold text-white">
      What even is this?
    </h2>
    <p class="text-[--color-muted-fg] leading-relaxed">
      It might look like a debate engine — and it is, technically — but that’s
      not the <em>point</em> of this demo. The point is really the judge.
    </p>
    <p class="text-[--color-muted-fg] leading-relaxed">
      This system isn’t built to simulate debates — it’s built to evaluate
      reasoning. At its core is a judge layer engineered to audit arguments the
      way a scientist inspects a causal model. It enforces strict cause →
      process → consequence structure, flags missing mechanisms, and penalizes
      claims that rely on vibes, metaphors, or moral gestures without
      explanatory substance. The auditor tracks contradictions across turns,
      detects when an argument quietly drops a premise, and rewards positions
      that maintain a stable causal spine throughout the entire exchange.
      Instead of producing a “winner,” it generates arc‑level analyses that
      reconstruct how each argument evolved, where it fractured, and why one
      causal model held together while the other collapsed. This isn’t a debate
      engine. It’s a structured reasoning environment that reveals how well
      arguments actually work.
    </p>
   
    <p class="text-[--color-muted-fg] leading-relaxed">
      The debaters are large open-weight models running on Ollama Cloud — Kimi
      K2 1T, Nemotron 3 Super, Qwen3, GLM-4, MiniMax M2.5, and others. Both
      debaters and the judge can be swapped for any LLM provider you prefer. I
      built a provider-agnostic LLM library to make this seamless — Anthropic,
      Gemini, and Ollama are already implemented out of the box, with the architecture
      designed to make adding new providers incredibly straightforward. The judge runs
      independently from the debaters and can be switched without touching the
      rest of the stack. Its rubric is multi-dimensional — logic, rhetoric,
      tactics, frame control, and credibility are scored separately. It also
      emits hidden feedback signals back into the debate in real time, shaping
      how each model argues as the exchange unfolds.
    </p>
  </section>

  <!-- Live Judge Layer -->
  <section class="flex flex-col gap-6">
    <h2 class="font-display text-2xl font-bold text-white">
      The Live Judge Layer
    </h2>
    <p class="text-[--color-muted-fg] leading-relaxed">
      The judge is not a single score. It runs five levels of analysis on every
      turn.
    </p>

    <div class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-[--color-accent]">
        1 — Per-turn absolute scoring
      </h3>
      <p class="text-sm text-[--color-muted-fg] leading-relaxed">
        Each turn receives independent scores on three dimensions —
        <strong class="text-white">Logical Coherence</strong> (0–40),
        <strong class="text-white">Rhetorical Force</strong> (0–30), and
        <strong class="text-white">Tactical Effectiveness</strong> (0–30), weighted
        into a composite 0–100 grade. Logic uses a component-chain model: a top score
        requires a complete cause → process → measurable consequence chain with the
        opponent's weakest premise explicitly addressed. Rhetoric uses a four-component
        method and caps delivery scores when framing is weak.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-[--color-accent]">
        2 — Pairwise comparative analysis
      </h3>
      <p class="text-sm text-[--color-muted-fg] leading-relaxed">
        After each turn, the judge runs a separate head-to-head comparison of
        the two most recent turns, determining dimensional winners (Logic,
        Tactics, Rhetoric) or declaring a draw. This produces <em
          >floor calibration</em
        >: if an absolute score falls outside the band consistent with the
        comparative verdict — a "logic win" scored below 22/40, for instance —
        it's flagged and harmonized. This prevents score drift across a long
        debate.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-[--color-accent]">
        3 — Claim &amp; fact tracking
      </h3>
      <p class="text-sm text-[--color-muted-fg] leading-relaxed">
        The judge maintains a Suspect Claims Register across turns. Claims that
        are specific but mechanically hollow — a precise-sounding assertion with
        no causal chain — are flagged with a −1 logic penalty. Fabricated
        citations, historically inverted facts, or causally backwards claims
        incur a mandatory −2 penalty upon detection. Critically, if a logic
        failure is only exposed by a later turn, the <em>prior</em> turn's score
        can be retroactively docked via a logic gap adjustment signal.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-[--color-accent]">
        4 — Narrative verdict
      </h3>
      <p class="text-sm text-[--color-muted-fg] leading-relaxed">
        At the end of the debate a separate LLM call evaluates arc-level
        coherence: did one agent hold a more consistent, evolving thesis across
        the whole debate? This verdict is deliberately allowed to diverge from
        the round-by-round scorecard. Winning more exchanges than your opponent
        is not the same as holding the stronger position. When the two verdicts
        conflict, a conflict resolution pass explains the gap. Three named
        patterns occur:
      </p>
      <ul
        class="flex flex-col gap-3 text-sm text-[--color-muted-fg] leading-relaxed"
      >
        <li class="flex gap-3">
          <span class="text-[--color-accent] mt-0.5 shrink-0">▸</span>
          <span
            ><strong class="text-white">Coherence Collapse</strong> — The scorecard
            leader won rounds by repeatedly shifting their central claim under pressure.
            Each reframe was persuasive in isolation, but the sequence of abandoned
            premises reveals that no single thesis survived the full arc. Winning
            a round by introducing a new mechanism you couldn't defend two turns
            ago is not cumulative progress; it's lateral movement. The narrative
            verdict penalizes the instability of the through-line, not the quality
            of any individual turn.</span
          >
        </li>
        <li class="flex gap-3">
          <span class="text-[--color-accent] mt-0.5 shrink-0">▸</span>
          <span
            ><strong class="text-white">Asymmetric Depth</strong> — One side dominated
            on style — rhetoric, tactics, audience resonance — while the other quietly
            held the stronger logical position throughout. The scorecard reflects
            the stylistic dominance. The narrative verdict reflects that the motion
            assigned a substantive burden, and flourish doesn't discharge it. This
            pattern most often appears when one debater is more rhetorically gifted
            but kept sidestepping the mechanism question the opponent never stopped
            asking.</span
          >
        </li>
        <li class="flex gap-3">
          <span class="text-[--color-accent] mt-0.5 shrink-0">▸</span>
          <span
            ><strong class="text-white">Convergence Failure</strong> — Both sides
            spent the debate talking past each other at the definitional level rather
            than engaging the actual dispute. The round wins accumulated, but each
            was won against a position the opponent wasn't holding. By the end, neither
            debater had established their thesis so much as successfully defended
            a smaller, safer version of it. The narrative verdict names this as a
            failure to close on the real question, not a victory for whoever landed
            more points on the surrogate one.</span
          >
        </li>
      </ul>

      <div class="flex flex-col gap-2">
        <h3 class="text-base font-semibold text-[--color-accent]">
          5 — Convergence detection
        </h3>
        <p class="text-sm text-[--color-muted-fg] leading-relaxed">
          In debates of ten or more turns, a final pass compares the agents'
          early positions (turns 1–2) against their late positions (turns n−1 to
          n). It surfaces whether the debate resolved into genuine agreement,
          got stuck in a definitional dispute, narrowed to a degree
          disagreement, or — in the worst case — descended into degenerate
          convergence where both sides ended up defending the same thing.
        </p>
      </div>
    </div>
  </section>

  <!-- Adaptive Personalities -->
  <section class="flex flex-col gap-4">
    <h2 class="font-display text-2xl font-bold text-white">
      Adaptive Personalities
    </h2>
    <p class="text-[--color-muted-fg] leading-relaxed">
      Each debater starts with a personality archetype — Engineer, Philosopher,
      Strategist, or Provocateur — expressed as twelve numeric traits (1–10)
      across cognitive style, emotional stance, and rhetorical approach. After
      the judge scores a turn, it emits pressure signals (cognitive, emotional,
      strategic, credibility) back into the losing agent's personality state.
      Traits shift by a pressure-weighted delta, multiplied by that agent's
      elasticity setting.
    </p>
    <p class="text-[--color-muted-fg] leading-relaxed">
      These adjustments are injected as hidden directives — invisible to the
      user — into the next agent's system prompt. The result is that agents
      noticeably change rhetorical posture across a debate. A Strategist who is
      losing on logic will become more analytical; a Provocateur under
      credibility pressure will reach for evidence. The debate feels dynamic
      rather than two models reading from fixed scripts.
    </p>
  </section>

  <!-- Strengths -->
  <section class="flex flex-col gap-4">
    <h2 class="font-display text-2xl font-bold text-white">Strengths</h2>
    <ul class="flex flex-col gap-3 text-sm text-[--color-muted-fg]">
      <li class="flex gap-3">
        <span class="text-[--color-accent] mt-0.5 shrink-0">→</span>
        <span>
          <strong class="text-white">Multi-dimensional scoring.</strong> There is
          no single "who won" meter. Logic, rhetoric, and tactics are tracked separately,
          so a win on style that conceals weak reasoning is visible in the scorecard.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-[--color-accent] mt-0.5 shrink-0">→</span>
        <span>
          <strong class="text-white">Live feedback loop.</strong> The judge shapes
          debater behavior in real time via hidden directives. The debate reacts
          to itself as it unfolds.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-[--color-accent] mt-0.5 shrink-0">→</span>
        <span>
          <strong class="text-white">Retroactive penalties.</strong> A claim praised
          in round 2 and disproved in round 4 doesn't get a free pass. The scoring
          system can reach backwards.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-[--color-accent] mt-0.5 shrink-0">→</span>
        <span>
          <strong class="text-white">Arc vs. skirmish separation.</strong> The narrative
          verdict decouples "who won the most rounds" from "who held the stronger
          overall position." These are different questions and the system treats
          them that way.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-[--color-accent] mt-0.5 shrink-0">→</span>
        <span>
          <strong class="text-white">Pairwise calibration.</strong> Floor banding
          prevents score drift. A turn can't score in the "win" range if the comparative
          analysis says it lost.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-[--color-accent] mt-0.5 shrink-0">→</span>
        <span>
          <strong class="text-white">Convergence detection.</strong> Long debates
          can drift, loop, or silently resolve. The system surfaces when that happens
          rather than presenting a false contest.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-[--color-accent] mt-0.5 shrink-0">→</span>
        <span>
          <strong class="text-white">Personality drift.</strong> Agents are not static.
          Under sustained judge pressure, a rigid debater loosens up and a scattered
          one sharpens. Longer debates produce more behaviorally interesting exchanges.
        </span>
      </li>
    </ul>
  </section>

  <!-- Weaknesses -->
  <section class="flex flex-col gap-4">
    <h2 class="font-display text-2xl font-bold text-white">
      Weaknesses &amp; Known Limitations
    </h2>
    <ul class="flex flex-col gap-3 text-sm text-[--color-muted-fg]">
      <li class="flex gap-3">
        <span class="text-red-400 mt-0.5 shrink-0">⚠</span>
        <span>
          <strong class="text-white">LLM judges are non-deterministic.</strong> Run
          the same debate twice and you will get different scores. The rubric is
          explicit and detailed, but the underlying model introduces variance. Treat
          scores as estimates, not measurements.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-red-400 mt-0.5 shrink-0">⚠</span>
        <span>
          <strong class="text-white">Harmonization pass limitations. </strong> The
          harmonization pass occasionally misses anomaly flags on rounds where retroactive
          gap enforcement created an unusual score pattern. Scores are correct; the
          flags are informational.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-red-400 mt-0.5 shrink-0">⚠</span>
        <span>
          <strong class="text-white">Judge style bias.</strong> The judge is a language
          model and may prefer certain rhetorical patterns — dense analytic prose,
          Western academic framing, confident assertion — independent of the actual
          quality of an argument. This bias is not fully characterized.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-red-400 mt-0.5 shrink-0">⚠</span>
        <span>
          <strong class="text-white">Cold-start effect.</strong> The first one or
          two turns have no pairwise context. Absolute scores in the opening rounds
          are less calibrated than in the middle and end of a debate, and floor banding
          cannot apply until turn two.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-red-400 mt-0.5 shrink-0">⚠</span>
        <span>
          <strong class="text-white"
            >False-positive fabricated-claim flags.</strong
          > The fabricated-claim detector can penalize real but obscure facts that
          resemble hallucinated citations. A narrowly true claim about an unusual
          study or event may receive the same −2 as an actual fabrication.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-red-400 mt-0.5 shrink-0">⚠</span>
        <span>
          <strong class="text-white">Narrative vs. scorecard confusion.</strong>
          By design, the narrative verdict can contradict the round-count winner.
          Users sometimes experience this as contradictory output. It is intentional,
          but the conflict resolution explanation is not always satisfying.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-red-400 mt-0.5 shrink-0">⚠</span>
        <span>
          <strong class="text-white">Archetype constraints.</strong> Personality
          archetypes define trait starting points, but the underlying model has its
          own tendencies. A model that strongly prefers ornate language will resist
          a "plain speech" personality pressure. The system adjusts prompts, not
          weights.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-red-400 mt-0.5 shrink-0">⚠</span>
        <span>
          <strong class="text-white">Backend latency variance.</strong> Debaters
          (Ollama Cloud) and the judge (Anthropic / Gemini) run on separate inference
          stacks. Network latency between them is additive and unpredictable, making
          turn-completion time irregular in long debates.
        </span>
      </li>
      <li class="flex gap-3">
        <span class="text-red-400 mt-0.5 shrink-0">⚠</span>
        <span>
          <strong class="text-white"
            >Heuristic hollow-specificity detection.</strong
          > The hollow-specificity scan penalizes claims that are precise but lack
          a mechanism. However, "mechanism" is itself a judgment call the LLM judge
          makes heuristically. Legitimate domain-specific precision can trigger the
          penalty in fields the judge is less familiar with.
        </span>
      </li>
    </ul>
  </section>
</div>
