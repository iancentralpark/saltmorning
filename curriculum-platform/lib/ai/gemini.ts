/**
 * Google Gemini via official SDK (`@google/genai`).
 *
 * - gemini-2.5-pro  — complex reasoning / lesson planning
 * - gemini-2.5-flash — fast quiz / worksheet generation
 */

import { GoogleGenAI } from "@google/genai";

export const GEMINI_MODEL_PRO = "gemini-2.5-pro";
export const GEMINI_MODEL_FLASH = "gemini-2.5-flash";

export function isGeminiConfigured() {
  return Boolean(String(process.env.GEMINI_API_KEY || "").trim());
}

/** Default model when callers omit one (flash for speed). */
export function defaultGeminiModel() {
  return process.env.GEMINI_MODEL || GEMINI_MODEL_FLASH;
}

export function lessonPlanModel() {
  return process.env.GEMINI_MODEL_PRO || GEMINI_MODEL_PRO;
}

export function materialsModel() {
  return process.env.GEMINI_MODEL_FLASH || GEMINI_MODEL_FLASH;
}

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  return new GoogleGenAI({ apiKey });
}

type AskOptions = {
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Request JSON-only replies when possible */
  json?: boolean;
};

export async function askGemini(
  prompt: string,
  options: AskOptions = {}
): Promise<{ text: string; model: string }> {
  const model = options.model || defaultGeminiModel();
  const ai = getClient();

  const response = await ai.models.generateContent({
    model,
    contents: String(prompt || ""),
    config: {
      ...(options.systemInstruction
        ? { systemInstruction: options.systemInstruction }
        : {}),
      ...(options.temperature != null
        ? { temperature: options.temperature }
        : {}),
      ...(options.maxOutputTokens != null
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
      ...(options.json ? { responseMimeType: "application/json" } : {}),
    },
  });

  const text = String(response.text || "").trim();
  if (!text) throw new Error("Empty response from Gemini.");

  return { text, model };
}

/** Parse JSON from a Gemini reply (strips ``` fences if present). */
export function parseGeminiJson<T = Record<string, unknown>>(raw: string): T {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}
