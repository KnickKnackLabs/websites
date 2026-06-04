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
args=("$@")
out="${args[$((${#args[@]} - 2))]}"
printf '{"status":"enrolled","totp_seed":"JBSWY3DPEHPK3PXP","recovery_codes":["a1b2c-3d4e5"]}\n' > "$out"
printf 'TWO_FACTOR_RESULT:enrolled\n'
EOF
  chmod +x "$TMPBIN/browser"
}

@test "github:2fa:enroll defaults token name and entrypoint despite inherited usage values" {
  write_fake_browser

  out="$BATS_TEST_TMPDIR/enrollment.json"
  usage_token_name=stale usage_entrypoint=token run --separate-stderr websites github:2fa:enroll ikma --out "$out"

  [ "$status" -eq 0 ]
  [ "$output" = "TWO_FACTOR_RESULT:enrolled" ]
  tail -4 "$BATS_TEST_TMPDIR/browser-args" > "$BATS_TEST_TMPDIR/final-args"
  grep -q '^<ikma>$' "$BATS_TEST_TMPDIR/final-args"
  grep -q "^<$out>$" "$BATS_TEST_TMPDIR/final-args"
  grep -q '^<auto>$' "$BATS_TEST_TMPDIR/final-args"
  grep -q 'JBSWY3DPEHPK3PXP' "$out"
  ! grep -q '^<stale>$' "$BATS_TEST_TMPDIR/browser-args"
  ! grep -q '^<token>$' "$BATS_TEST_TMPDIR/browser-args"
}

@test "github:2fa:enroll forwards explicit token name" {
  write_fake_browser

  out="$BATS_TEST_TMPDIR/enrollment.json"
  run --separate-stderr websites github:2fa:enroll ikma --token-name ikma-ci --out "$out"

  [ "$status" -eq 0 ]
  tail -4 "$BATS_TEST_TMPDIR/browser-args" > "$BATS_TEST_TMPDIR/final-args"
  grep -q '^<ikma>$' "$BATS_TEST_TMPDIR/final-args"
  grep -q '^<ikma-ci>$' "$BATS_TEST_TMPDIR/final-args"
  grep -q "^<$out>$" "$BATS_TEST_TMPDIR/final-args"
  grep -q '^<auto>$' "$BATS_TEST_TMPDIR/final-args"
}

@test "github:2fa:enroll forwards explicit entrypoint" {
  write_fake_browser

  out="$BATS_TEST_TMPDIR/enrollment.json"
  run --separate-stderr websites github:2fa:enroll ikma --entrypoint settings --out "$out"

  [ "$status" -eq 0 ]
  tail -4 "$BATS_TEST_TMPDIR/browser-args" > "$BATS_TEST_TMPDIR/final-args"
  grep -q '^<ikma>$' "$BATS_TEST_TMPDIR/final-args"
  grep -q "^<$out>$" "$BATS_TEST_TMPDIR/final-args"
  grep -q '^<settings>$' "$BATS_TEST_TMPDIR/final-args"
}

@test "github:2fa:enroll rejects invalid entrypoint" {
  write_fake_browser

  run --separate-stderr websites github:2fa:enroll ikma --entrypoint mystery --out "$BATS_TEST_TMPDIR/enrollment.json"

  [ "$status" -ne 0 ]
  [[ "$stderr" == *"--entrypoint must be one of"* ]]
}

@test "github:2fa:enroll requires output path" {
  write_fake_browser

  run --separate-stderr websites github:2fa:enroll ikma

  [ "$status" -ne 0 ]
  [[ "$stderr" == *"--out <path> is required"* ]]
}

@test "github:2fa:enroll refuses existing output path" {
  write_fake_browser
  out="$BATS_TEST_TMPDIR/enrollment.json"
  touch "$out"

  run --separate-stderr websites github:2fa:enroll ikma --out "$out"

  [ "$status" -ne 0 ]
  [[ "$stderr" == *"--out path already exists"* ]]
}

@test "github:2fa:enroll requires username and password" {
  write_fake_browser
  unset GITHUB_PASSWORD

  run --separate-stderr websites github:2fa:enroll ikma --out "$BATS_TEST_TMPDIR/enrollment.json"

  [ "$status" -ne 0 ]
  [[ "$stderr" == *"GITHUB_USERNAME and GITHUB_PASSWORD env vars required"* ]]
}
