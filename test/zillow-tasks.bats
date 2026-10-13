#!/usr/bin/env bats
REPO_DIR="${REPO_DIR:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

@test "Zillow native tests" {
  run node --test "$REPO_DIR"/test/zillow/*.test.mjs
  [ "$status" -eq 0 ]
}

@test "Zillow search-url JSON stdin and help" {
  cd "$REPO_DIR"
  run bash -c 'printf '\''{"region":{"id":123,"type":6}}'\'' | mise run zillow:search-url -- --format json -'
  [ "$status" -eq 0 ]
  [[ "$output" == *"https://www.zillow.com/homes/for_rent/?searchQueryState="* ]]
  run mise run zillow:search-url --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--format"* ]]
}

@test "Zillow search-url TOML stdin and invalid input" {
  cd "$REPO_DIR"
  run bash -c 'printf "[region]\nid = 123\ntype = 6\n" | mise run zillow:search-url -- -'
  [ "$status" -eq 0 ]
  [[ "$output" == *"https://www.zillow.com/"* ]]
  run bash -c 'printf "{}" | mise run zillow:search-url -- --format json -'
  [ "$status" -ne 0 ]
  [[ "$output" == *"Specify region"* ]]
}

@test "Zillow search uses explicit browser selection and prints only framed JSON" {
  cd "$REPO_DIR"
  local bin="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$bin"
  printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "$@" > "$ZILLOW_TEST_ARGS"' 'echo "Running browser script"' 'echo '\''WEBSITES_ZILLOW_RESULT={"complete":true,"listings":[]}'\''' > "$bin/browser"
  chmod +x "$bin/browser"
  local url='https://www.zillow.com/homes/for_rent/?searchQueryState={"regionSelection":[{"regionId":123,"regionType":6}],"filterState":{"isForRent":{"value":true}}}'
  run env PATH="$bin:$PATH" ZILLOW_TEST_ARGS="$BATS_TEST_TMPDIR/args" mise run zillow:search -- --browser b-test --headed "$url"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"complete": true'* ]]
  run grep -Fx -- '--browser' "$BATS_TEST_TMPDIR/args"
  [ "$status" -eq 0 ]
  run grep -Fx -- 'b-test' "$BATS_TEST_TMPDIR/args"
  [ "$status" -eq 0 ]
  run grep -Fx -- '--headed' "$BATS_TEST_TMPDIR/args"
  [ "$status" -eq 0 ]
  run grep -Fx -- '--site' "$BATS_TEST_TMPDIR/args"
  [ "$status" -ne 0 ]
}

@test "Zillow search fails without success output when browser command fails" {
  cd "$REPO_DIR"
  local bin="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$bin"
  printf '%s\n' '#!/usr/bin/env bash' 'echo '\''WEBSITES_ZILLOW_RESULT={"complete":true}'\''' 'exit 2' > "$bin/browser"
  chmod +x "$bin/browser"
  local url='https://www.zillow.com/?searchQueryState={"regionSelection":[{"regionId":123,"regionType":6}],"filterState":{}}'
  run env PATH="$bin:$PATH" mise run zillow:search -- "$url"
  [ "$status" -ne 0 ]
  [[ "$output" == *'browser run failed'* ]]
  [[ "$output" != *'"complete"'* ]]
  run mise run zillow:search --help
  [ "$status" -eq 0 ]
  [[ "$output" == *'--browser'* ]]
}

@test "Zillow listing CLI forwards calculator and validates URLs before launching" {
  cd "$REPO_DIR"
  local bin="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$bin"
  printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "$@" > "$ZILLOW_TEST_ARGS"' 'echo '\''WEBSITES_ZILLOW_RESULT={"listing":{"id":"123"},"calculator":{"clicked":false}}'\''' > "$bin/browser"
  chmod +x "$bin/browser"
  run env PATH="$bin:$PATH" ZILLOW_TEST_ARGS="$BATS_TEST_TMPDIR/args" mise run zillow:listing -- --calculator --browser b-test 'https://www.zillow.com/homedetails/example/123_zpid/'
  [ "$status" -eq 0 ]
  [[ "$output" == *'"id": "123"'* ]]
  run grep -Fx -- '--calculator' "$BATS_TEST_TMPDIR/args"
  [ "$status" -eq 0 ]
  rm "$BATS_TEST_TMPDIR/args"
  run env PATH="$bin:$PATH" ZILLOW_TEST_ARGS="$BATS_TEST_TMPDIR/args" mise run zillow:listing -- 'https://example.test/'
  [ "$status" -ne 0 ]
  [ ! -f "$BATS_TEST_TMPDIR/args" ]
  run mise run zillow:listing --help
  [ "$status" -eq 0 ]
  [[ "$output" == *'--calculator'* ]]
}

@test "Zillow intervention CLI help and invalid handle are safe" {
  cd "$REPO_DIR"
  run mise run zillow:listing --help
  [ "$status" -eq 0 ]
  [[ "$output" == *'--intervene'* ]]
  run mise run zillow:search --help
  [ "$status" -eq 0 ]
  [[ "$output" == *'--intervene'* ]]
  run mise run zillow:intervention:resume --help
  [ "$status" -eq 0 ]
  [[ "$output" == *'<handle>'* ]]
  run mise run zillow:intervention:cancel --help
  [ "$status" -eq 0 ]
  run mise run zillow:intervention:resume -- '../bad'
  [ "$status" -ne 0 ]
  [[ "$output" == *'Invalid Zillow resume handle'* ]]
  run mise run zillow:listing -- --intervene --browser b-test 'https://www.zillow.com/homedetails/example/123_zpid/'
  [ "$status" -ne 0 ]
  [[ "$output" == *'cannot combine'* ]]
}

@test "Zillow property show exposes help and rejects invalid URLs before browser launch" {
  cd "$REPO_DIR"
  run mise run zillow:property:show --help
  [ "$status" -eq 0 ]
  [[ "$output" == *'--intervene'* ]]
  run mise run zillow:property:show -- 'https://evil.test/123_zpid/'
  [ "$status" -ne 0 ]
}

@test "Shared browser helper drops obsolete site and resets arguments" {
  run bash -c 'browser() { if [[ "$1" == list ]]; then echo "b-test running"; fi; }; source "$1/lib/browser.sh"; setup_browser true github.com; [[ "${BROWSER_ARGS[*]}" == "--browser b-test" ]] || exit 1; setup_browser false zillow.com; [[ ${#BROWSER_ARGS[@]} == 0 ]]' _ "$REPO_DIR"
  [ "$status" -eq 0 ]
}
