// wave/utils.mjs — Wave-specific utility functions

// Extract business ID from a Wave URL.
export function parseBusinessId(url) {
  const match = url.match(/waveapps\.com\/([a-f0-9-]{36})/);
  return match ? match[1] : null;
}
