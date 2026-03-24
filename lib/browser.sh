# browser.sh — Shared browser setup for websites tasks
#
# Requires: KnickKnackLabs/browser (install via `shiv install browser`)
#
# Source this file and call setup_browser to get BROWSER_ARGS populated.
#
# Usage:
#   source "$MISE_CONFIG_ROOT/lib/browser.sh"
#   setup_browser "${usage_keep:-false}"
#   browser run "${BROWSER_ARGS[@]}" "$script" ...

if ! command -v browser &>/dev/null; then
  echo "ERROR: 'browser' not found. Install it with: shiv install browser" >&2
  exit 1
fi

BROWSER_ARGS=()

# Populate BROWSER_ARGS based on --keep flag.
# If keep is true: reuse a running browser or launch a new headed one.
# Reports browser ID on stderr so the caller knows which browser to use later.
setup_browser() {
  local keep="${1:-false}"

  if [ "$keep" = "true" ]; then
    local browser_id
    # Reuse existing browser if one is running
    browser_id=$(browser list 2>/dev/null | awk '/^b-.*running/ {print $1; exit}')
    if [ -z "$browser_id" ]; then
      browser_id=$(browser launch --headed 2>/dev/null | head -1)
    fi
    if [ -n "$browser_id" ]; then
      BROWSER_ARGS+=(--browser "$browser_id")
      echo "Browser: $browser_id (will stay open)" >&2
    else
      BROWSER_ARGS+=(--headed)
      echo "Warning: could not launch persistent browser, using headed ephemeral" >&2
    fi
  fi
}
