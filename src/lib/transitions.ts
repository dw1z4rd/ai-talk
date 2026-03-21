import { cubicOut, cubicIn, backOut, expoOut, expoIn } from "svelte/easing";

export function flyInFromTop(
  node: Element,
  {
    duration = 340,
    delay = 0,
    easing = expoOut,
    distance,
  }: {
    duration?: number;
    delay?: number;
    easing?: (t: number) => number;
    distance?: number;
  } = {},
) {
  // 1. Grab the element's computed styles
  const style = getComputedStyle(node);
  const parsedOpacity = parseFloat(style.opacity);
  const targetOpacity = parsedOpacity === 0 ? 1 : parsedOpacity;
  const transform = style.transform === "none" ? "" : style.transform;

  // 2. Calculate the distance to the viewport top (or use explicit short distance)
  const nodeRect = node.getBoundingClientRect();
  const startY = distance !== undefined ? -distance : -nodeRect.top;
  return {
    delay,
    duration,
    easing,
    css: (t: number, u: number) => `
      transform: ${transform} translateY(${u * startY}px);
      opacity: ${targetOpacity * t};
    `,
  };
}

export function flyOutToBottom(
  node: Element,
  {
    duration = 270,
    delay = 0,
    easing = expoIn,
    distance,
  }: {
    duration?: number;
    delay?: number;
    easing?: (t: number) => number;
    distance?: number;
  } = {},
) {
  const style = getComputedStyle(node);
  const parsedOpacity = parseFloat(style.opacity);
  const targetOpacity = parsedOpacity === 0 ? 1 : parsedOpacity;
  const transform = style.transform === "none" ? "" : style.transform;

  // Capture the exact geometry before it leaves document flow
  const nodeRect = node.getBoundingClientRect();
  const distanceToBottom =
    distance !== undefined ? distance : window.innerHeight - nodeRect.top;

  return {
    delay,
    duration,
    easing,
    css: (t: number, u: number) => `
      position: fixed;
      top: ${nodeRect.top}px;
      left: ${nodeRect.left}px;
      width: ${nodeRect.width}px;
      height: ${nodeRect.height}px;
      margin: 0;
      pointer-events: none;
      transform: ${transform} translateY(${u * distanceToBottom}px);
      opacity: ${targetOpacity * t};
    `,
  };
}
export function flyInFromLeft(
  node: Element,
  {
    duration = 280,
    delay = 0,
    easing = expoOut,
    distance,
  }: {
    duration?: number;
    delay?: number;
    easing?: (t: number) => number;
    distance?: number;
  } = {},
) {
  const style = getComputedStyle(node);
  const parsedOpacity = parseFloat(style.opacity);
  const targetOpacity = parsedOpacity === 0 ? 1 : parsedOpacity;
  const transform = style.transform === "none" ? "" : style.transform;

  const nodeRect = node.getBoundingClientRect();
  // Pushes the element left by exactly enough pixels to hide its rightmost edge (or use explicit short distance)
  const startX = distance !== undefined ? -distance : -nodeRect.right;

  return {
    delay,
    duration,
    easing,
    css: (t: number, u: number) => `
      transform: ${transform} translateX(${u * startX}px);
      opacity: ${targetOpacity * t};
    `,
  };
}
export function flyOutToRight(
  node: Element,
  {
    duration = 220,
    delay = 0,
    easing = expoIn,
    distance,
  }: {
    duration?: number;
    delay?: number;
    easing?: (t: number) => number;
    distance?: number;
  } = {},
) {
  const style = getComputedStyle(node);
  const parsedOpacity = parseFloat(style.opacity);
  const targetOpacity = parsedOpacity === 0 ? 1 : parsedOpacity;
  const transform = style.transform === "none" ? "" : style.transform;

  // Capture the exact geometry of the card right before death
  const nodeRect = node.getBoundingClientRect();
  const distanceToRight =
    distance !== undefined ? distance : window.innerWidth - nodeRect.left;

  return {
    delay,
    duration,
    easing,
    css: (t: number, u: number) => `
      position: fixed;
      top: ${nodeRect.top}px;
      left: ${nodeRect.left}px;
      width: ${nodeRect.width}px;
      height: ${nodeRect.height}px;
      margin: 0;
      pointer-events: none;
      transform: ${transform} translateX(${u * distanceToRight}px);
      opacity: ${targetOpacity * t};
    `,
  };
}

/**
 * Spring-pop entrance for modals and toasts.
 * Scales up from 0.88 and slides up 20px with a backOut overshoot.
 */
export function popIn(
  node: Element,
  { duration = 420, delay = 0, easing = backOut } = {},
) {
  return {
    delay,
    duration,
    easing,
    css: (t: number) => `
      transform: scale(${0.88 + 0.12 * t}) translateY(${(1 - t) * 20}px);
      opacity: ${t < 0.5 ? t * 2 : 1};
    `,
  };
}

/**
 * Slow zoom+fade in for chat messages — starts sluggish, accelerates in.
 * Enter: scale 0.88→1, opacity 0→1 over 2000ms with a cubic-in-out feel.
 * Exit: reverse — scale 1→0.88, opacity 1→0 over 1800ms.
 */
export function msgIn(node: Element, { duration = 2000, delay = 0 } = {}) {
  // Ease: slow start, accelerates (approximated with a manual cubic)
  const easing = (t: number) => t * t * (3 - 2 * t); // smoothstep — slow→fast→slow end
  return {
    delay,
    duration,
    easing,
    css: (t: number) => `
      transform: scale(${0.88 + 0.12 * t});
      opacity: ${t};
    `,
  };
}

export function msgOut(node: Element, { duration = 1800, delay = 0 } = {}) {
  const easing = (t: number) => t * t; // slow start → fast exit
  return {
    delay,
    duration,
    easing,
    css: (t: number) => `
      transform: scale(${0.88 + 0.12 * t});
      opacity: ${t};
    `,
  };
}
