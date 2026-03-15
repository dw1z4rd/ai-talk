import { expoOut } from "svelte/easing";

export function flyInFromTop(
  node: Element,
  { duration = 1000, delay = 0, easing = expoOut } = {},
) {
  // 1. Grab the element's computed styles
  const style = getComputedStyle(node);
  const parsedOpacity = parseFloat(style.opacity);
  const targetOpacity = parsedOpacity === 0 ? 1 : parsedOpacity;
  const transform = style.transform === "none" ? "" : style.transform;

  // 2. Calculate the distance to the viewport top
  const nodeRect = node.getBoundingClientRect();
  const startY = -nodeRect.top;
  console.log({
    node: node.tagName,
    startY,
    targetOpacity,
    easingIsDefined: !!easing,
    classes: node.className,
  });
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
  { duration = 1000, delay = 0, easing = expoOut } = {},
) {
  const style = getComputedStyle(node);
  const parsedOpacity = parseFloat(style.opacity);
  const targetOpacity = parsedOpacity === 0 ? 1 : parsedOpacity;
  const transform = style.transform === "none" ? "" : style.transform;

  // We must capture the exact dimensions before it leaves the document flow
  const nodeRect = node.getBoundingClientRect();
  const distanceToBottom = window.innerHeight - nodeRect.top;

  return {
    delay,
    duration,
    easing,
    css: (t: number, u: number) => `
      position: absolute;
      width: ${nodeRect.width}px;
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
