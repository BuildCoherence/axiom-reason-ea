// shadcn baseline: `cn()` merges Tailwind class strings while resolving
// conflicts (e.g., later `px-4` wins over earlier `px-2`). Used by every
// shadcn-derived component in `src/components/ui/` and may be used by
// product components that compose Tailwind classes conditionally.

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
