#!/usr/bin/env bats

# Tests for pure parsing functions in scripts/wave/

SCRIPTS_DIR="$BATS_TEST_DIRNAME/../../scripts/wave"

run_js() {
  run node --input-type=module -e "$1"
}

# --- parseBusinessId ---

@test "parseBusinessId: extracts UUID from Wave URL" {
  run_js "
    import { parseBusinessId } from '$SCRIPTS_DIR/utils.mjs';
    console.log(parseBusinessId('https://next.waveapps.com/a1b2c3d4-e5f6-7890-abcd-ef1234567890/dashboard'));
  "
  [ "$output" = "a1b2c3d4-e5f6-7890-abcd-ef1234567890" ]
}

@test "parseBusinessId: returns null for non-Wave URL" {
  run_js "
    import { parseBusinessId } from '$SCRIPTS_DIR/utils.mjs';
    console.log(parseBusinessId('https://example.com/dashboard'));
  "
  [ "$output" = "null" ]
}

@test "parseBusinessId: returns null for Wave URL without business ID" {
  run_js "
    import { parseBusinessId } from '$SCRIPTS_DIR/utils.mjs';
    console.log(parseBusinessId('https://next.waveapps.com/login'));
  "
  [ "$output" = "null" ]
}
