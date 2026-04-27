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
  local body="$1"
  cat > "$TMPBIN/browser" <<EOF
#!/usr/bin/env bash
$body
EOF
  chmod +x "$TMPBIN/browser"
}

@test "github:token:list passes TSV separator to gum table" {
  write_fake_browser 'printf "%s\n" "login diagnostic" "TOKENS_JSON:[{\"id\":\"123\",\"name\":\"ikma\",\"status\":[\"Expired\"]}]"'
  cat > "$TMPBIN/gum" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$BATS_TEST_TMPDIR/gum-args"
cat > "$BATS_TEST_TMPDIR/gum-stdin"
printf 'gum output\n'
EOF
  chmod +x "$TMPBIN/gum"

  run --separate-stderr websites github:token:list

  [ "$status" -eq 0 ]
  [ "$output" = "gum output" ]
  grep -q -- '--separator' "$BATS_TEST_TMPDIR/gum-args"
  grep -q $'123\tikma\tExpired' "$BATS_TEST_TMPDIR/gum-stdin"
  [[ "$stderr" == *"login diagnostic"* ]]
}

@test "github:token:list --json emits only JSON on stdout" {
  write_fake_browser 'printf "%s\n" "login diagnostic" "TOKENS_JSON:[{\"id\":\"123\",\"name\":\"ikma\",\"status\":[]}]"'

  run --separate-stderr websites github:token:list --json

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.[0].name')" = "ikma" ]
  [[ "$stderr" == *"login diagnostic"* ]]
}

@test "github:token:rotate reports explicit extraction error when TOKEN line is missing" {
  write_fake_browser 'printf "%s\n" "browser succeeded but emitted no token"'

  run --separate-stderr websites github:token:rotate ikma

  [ "$status" -ne 0 ]
  [[ "$stderr" == *"ERROR: Could not extract token from script output"* ]]
}
