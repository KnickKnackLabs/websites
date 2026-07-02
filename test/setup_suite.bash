setup_suite() {
  export REPO_DIR="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  eval "$(cd "$REPO_DIR" && mise env)"

  # mise's generated PATH points at bats-core/bin, while bats invokes helpers
  # from libexec/bats-core by bare command name after setup_suite runs.
  # Preserve that helper path so setup_suite does not make the runner lose
  # bats-exec-file for the rest of the suite.
  local bats_bin bats_root bats_libexec
  bats_bin="$(command -v bats || true)"
  if [ -n "$bats_bin" ]; then
    bats_root="$(cd "$(dirname "$bats_bin")/.." && pwd)"
    bats_libexec="$bats_root/libexec/bats-core"
    if [ -x "$bats_libexec/bats-exec-file" ]; then
      export PATH="$bats_libexec:$PATH"
    fi
  fi
}
