<script lang="ts">
  import { flyInFromLeft, flyOutToRight, popIn, popOut } from "$lib/transitions";
  import { fade } from "svelte/transition";
  import { tick } from "svelte";

  interface Props {
    showWinnerModal: boolean;
    winner: { id: string; name: string; color: string } | null;
    winnerScore: number;
    finalScorecard: any;
  }

  let {
    showWinnerModal = $bindable(false),
    winner,
    winnerScore,
    finalScorecard,
  }: Props = $props();

  let confettiCanvas = $state<HTMLCanvasElement | null>(null);

  $effect(() => {
    if (showWinnerModal && confettiCanvas) {
      launchConfetti();
    }
  });

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
</script>

{#if showWinnerModal}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    in:fade={{ duration: 280 }}
    out:fade={{ duration: 180 }}
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
      in:popIn
      out:popOut
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
        {finalScorecard
          ? `${winnerScore} round wins`
          : `Score: ${winnerScore?.toFixed(1)}`}
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
