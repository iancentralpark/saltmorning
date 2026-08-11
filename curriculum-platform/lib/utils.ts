import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugId(...parts: Array<string | number | null | undefined>) {
  return parts
    .filter((p) => p !== null && p !== undefined && `${p}`.length > 0)
    .join("__")
    .replace(/[^a-zA-Z0-9_\-가-힣]/g, "_");
}
