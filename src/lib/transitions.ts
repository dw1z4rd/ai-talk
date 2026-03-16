import { cubicOut, cubicIn } from "svelte/easing";

export function flyInFromTop(
  node: Element,
  { duration = 400, delay = 0, easing = cubicOut } = {},
) {
  // 1. Grab the element's computed styles
  const style = getComputedStyle(node);
  const parsedOpacity = parseFloat(style.opacity);
  const targetOpacity = parsedOpacity === 0 ? 1 : parsedOpacity;
  const transform = style.transform === "none" ? "" : style.transform;

  // 2. Calculate the distance to the viewport top
  const nodeRect = node.getBoundingClientRect();
  const startY = -nodeRect.top;
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
  { duration = 350, delay = 0, easing = cubicIn } = {},
) {
  const style = getComputedStyle(node);
  const parsedOpacity = parseFloat(style.opacity);
  const targetOpacity = parsedOpacity === 0 ? 1 : parsedOpacity;
  const transform = style.transform === "none" ? "" : style.transform;

  // Capture the exact geometry before it leaves document flow
  const nodeRect = node.getBoundingClientRect();
  const distanceToBottom = window.innerHeight - nodeRect.top;

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
  { duration = 350, delay = 0, easing = cubicOut } = {},
) {
  const style = getComputedStyle(node);
  const parsedOpacity = parseFloat(style.opacity);
  const targetOpacity = parsedOpacity === 0 ? 1 : parsedOpacity;
  const transform = style.transform === "none" ? "" : style.transform;

  const nodeRect = node.getBoundingClientRect();
  // Pushes the element left by exactly enough pixels to hide its rightmost edge
  const startX = -nodeRect.right;

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
  { duration = 300, delay = 0, easing = cubicIn } = {},
) {
  const style = getComputedStyle(node);
  const parsedOpacity = parseFloat(style.opacity);
  const targetOpacity = parsedOpacity === 0 ? 1 : parsedOpacity;
  const transform = style.transform === "none" ? "" : style.transform;

  // Capture the exact geometry of the card right before death
  const nodeRect = node.getBoundingClientRect();
  const distanceToRight = window.innerWidth - nodeRect.left;

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