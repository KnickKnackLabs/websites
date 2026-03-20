// utils.mjs — Shared utility functions for website extraction scripts

// Normalize whitespace: collapse newlines and multiple spaces into single spaces.
export function normalizeText(str) {
  return str.replace(/\s+/g, ' ').trim();
}
