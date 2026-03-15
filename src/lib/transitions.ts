import { expoOut } from "svelte/easing";

export function flyInFromTop(
  node: Element,
  { duration = 3000, delay = 0, easing = expoOut } = {},
) {
  // 1. Grab the element's computed styles
  const style = getComputedStyle(node);
  const targetOpacity = parseFloat(style.opacity);
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
  { duration = 3000, delay = 0, easing = expoOut } = {},
) {
  // 1. Grab the computed styles so we don't destroy natural CSS
  const style = getComputedStyle(node);
  const targetOpacity = parseFloat(style.opacity);
  const transform = style.transform === "none" ? "" : style.transform;

  // 2. Calculate the exact distance to push the element off-screen
  const nodeRect = node.getBoundingClientRect();

  // We subtract the element's top position from the viewport height.
  // This calculates the exact number of pixels needed to move the
  // top edge of the element down until it hits the bottom viewport edge.
  const distanceToBottom = window.innerHeight - nodeRect.top;

  return {
    delay,
    duration,
    easing,
    css: (t: number, u: number) => `
      transform: ${transform} translateY(${u * distanceToBottom}px);
      opacity: ${targetOpacity * t};
    `,
  };
}

export function spinFly(
  node: Element,
  { duration = 1500, delay = 0, easing = expoOut, y = "100vh", spins = 1 } = {},
) {
  return {
    delay,
    duration,
    easing,
    css: (t: number) => {
      // Calculate vertical position
      const yOffset =
        typeof y === "number" ? `${(1 - t) * y}px` : `calc(${1 - t} * ${y})`;

      // Calculate rotation.
      // t=0 (hidden): rotation is spins * 360deg
      // t=1 (rendered): rotation is 0deg
      const rotation = (1 - t) * spins * 360;

      return `
        opacity: ${t}; 
        transform: translateX(${yOffset}) rotate(${rotation}deg);
      `;
    },
  };
}
