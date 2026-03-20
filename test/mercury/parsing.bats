#!/usr/bin/env bats

# Tests for pure parsing functions in scripts/mercury/

SCRIPTS_DIR="$BATS_TEST_DIRNAME/../../scripts/mercury"

run_js() {
  run node --input-type=module -e "$1"
}

# --- parseAccountLine ---

@test "parseAccountLine: parses account name and balance" {
  run_js "
    import { parseAccountLine } from '$SCRIPTS_DIR/home.mjs';
    const result = parseAccountLine('Checking ••9145  \$4,593.59');
    console.log(JSON.stringify(result));
  "
  [ "$(echo "$output" | jq -r '.name')" = "Checking ••9145" ]
  [ "$(echo "$output" | jq -r '.balance')" = "\$4,593.59" ]
}

@test "parseAccountLine: returns null for unparseable text" {
  run_js "
    import { parseAccountLine } from '$SCRIPTS_DIR/home.mjs';
    console.log(parseAccountLine('No balance here'));
  "
  [ "$output" = "null" ]
}
