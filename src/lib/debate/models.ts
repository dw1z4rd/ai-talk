export const MODEL_OPTIONS = [
  {
    group: "Ollama — Cloud",
    options: [
      {
        id: "minimax-m2.5:cloud",
        name: "MiniMax M2.5",
        color: "#EF4444",
      },
      {
        id: "nemotron-3-super-cloud",
        name: "Nemotron 3 Super",
        color: "#FF7000",
      },
      {
        id: "kimi-k2.5:cloud",
        name: "Kimi K2.5",
        color: "#F59E0B",
      },
      {
        id: "kimi-k2:1t-cloud",
        name: "Kimi K2 1T",
        color: "#A78BFA",
      },
      {
        id: "kimi-k2-thinking:cloud",
        name: "Kimi K2 Thinking",
        color: "#11A1CC",
      },
      {
        id: "qwen3-vl:235b-cloud",
        name: "Qwen3-VL 235B",
        color: "#10B981",
      },
      {
        id: "qwen3-next:80b-cloud",
        name: "Qwen3-Next 80B",
        color: "#8B5CF6",
      },
      {
        id: "glm-4.6:cloud",
        name: "GLM-4.6",
        color: "#8B5CF6",
      },
    ],
  },
];

export interface ModelOption {
  id: string;
  name: string;
  color: string;
}

export interface ChatMessage {
  agentId: string;
  agentName: string;
  color: string;
  text: string;
}

export interface ContextFile {
  name: string;
  content: string;
}

export function getModelInfo(id: string): ModelOption {
  for (const group of MODEL_OPTIONS) {
    const found = group.options.find((o) => o.id === id);
    if (found) return found;
  }
  return { id, name: id, color: "#7c6af7" };
}

/** Resolves a dimension winner ID to a display-friendly object.
 *  The "tie" sentinel (set when absolute scores are equal) shows as "Draw". */
export function getWinnerInfo(id: string): ModelOption {
  if (id === "tie") return { id: "tie", name: "Draw", color: "#6b7280" };
  return getModelInfo(id);
}
