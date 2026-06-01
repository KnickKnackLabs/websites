#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

REPO_DIR="${REPO_DIR:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup() {
  TMPBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$TMPBIN"
  export TMPBIN
  export GITHUB_USERNAME="test-user"
  export GITHUB_PASSWORD="test-pass"
  export GIT_AUTHOR_NAME="tester"
}

websites() {
  cd "$REPO_DIR" && PATH="$TMPBIN:$PATH" mise run -q "$@"
}

write_fake_browser() {
  cat > "$TMPBIN/browser" <<'EOF'
#!/usr/bin/env bash
printf '<%s>\n' "$@" > "$BATS_TEST_TMPDIR/browser-args"
printf 'TWO_FACTOR_RESULT:enrolled\n'
EOF
  chmod +x "$TMPBIN/browser"
}

@test "github:2fa:enroll defaults token name to login id despite inherited usage_token_name" {
  write_fake_browser

  usage_token_name=stale run --separate-stderr websites github:2fa:enroll ikma

  [ "$status" -eq 0 ]
  [ "$output" = "TWO_FACTOR_RESULT:enrolled" ]
  tail -2 "$BATS_TEST_TMPDIR/browser-args" > "$BATS_TEST_TMPDIR/final-args"
  grep -q '^<ikma>$' "$BATS_TEST_TMPDIR/final-args"
  ! grep -q '^<stale>$' "$BATS_TEST_TMPDIR/browser-args"
}

@test "github:2fa:enroll forwards explicit token name" {
  write_fake_browser

  run --separate-stderr websites github:2fa:enroll ikma --token-name ikma-ci

  [ "$status" -eq 0 ]
  tail -2 "$BATS_TEST_TMPDIR/browser-args" > "$BATS_TEST_TMPDIR/final-args"
  grep -q '^<ikma>$' "$BATS_TEST_TMPDIR/final-args"
  grep -q '^<ikma-ci>$' "$BATS_TEST_TMPDIR/final-args"
}

@test "github:2fa:enroll requires username and password" {
  write_fake_browser
  unset GITHUB_PASSWORD

  run --separate-stderr websites github:2fa:enroll ikma

  [ "$status" -ne 0 ]
  [[ "$stderr" == *"GITHUB_USERNAME and GITHUB_PASSWORD env vars required"* ]]
}
