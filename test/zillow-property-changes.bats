#!/usr/bin/env bats
REPO_DIR="${REPO_DIR:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup() {
  local directory="$BATS_TEST_TMPDIR/saved"
  mkdir -p "$directory"
  node --input-type=module - "$directory" <<'JS'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const directory = process.argv[2];
const property = {
  recordType: 'individual_property', id: '123',
  url: 'https://www.zillow.com/homedetails/example/123_zpid/',
  checked: '2026-10-01T12:00:00Z',
  price: { kind: 'monthly_rent', amount: 1500 },
  sections: {}, calculator: {},
};
writeFileSync(join(directory, 'before.json'), JSON.stringify(property));
writeFileSync(join(directory, 'after.json'), JSON.stringify({
  ...property, price: { kind: 'monthly_rent', amount: 1600 },
}));
JS
}

@test "Zillow property changes reads saved files relative to caller and prints JSON" {
  cd "$REPO_DIR"
  run env WEBSITES_CALLER_PWD="$BATS_TEST_TMPDIR/saved" mise run zillow:property:changes -- before.json after.json
  [ "$status" -eq 0 ]
  [[ "$output" == *'"changed": true'* ]]
  [[ "$output" == *'"amount": 1600'* ]]
}

@test "Zillow property changes returns success for unchanged evidence" {
  cd "$REPO_DIR"
  run mise run zillow:property:changes -- "$BATS_TEST_TMPDIR/saved/before.json" "$BATS_TEST_TMPDIR/saved/before.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"changed": false'* ]]
}

@test "Zillow property changes rejects invalid JSON without success output" {
  cd "$REPO_DIR"
  printf '%s' 'not JSON' > "$BATS_TEST_TMPDIR/saved/broken.json"
  run mise run zillow:property:changes -- "$BATS_TEST_TMPDIR/saved/broken.json" "$BATS_TEST_TMPDIR/saved/after.json"
  [ "$status" -ne 0 ]
  [[ "$output" == *'zillow property changes:'* ]]
  [[ "$output" != *'"changed"'* ]]
}

@test "Zillow property changes rejects a missing file" {
  cd "$REPO_DIR"
  run mise run zillow:property:changes -- "$BATS_TEST_TMPDIR/missing.json" "$BATS_TEST_TMPDIR/saved/after.json"
  [ "$status" -ne 0 ]
  [[ "$output" == *'zillow property changes:'* ]]
}

@test "Zillow property changes exposes its two saved-file arguments in help" {
  cd "$REPO_DIR"
  run mise run zillow:property:changes --help
  [ "$status" -eq 0 ]
  [[ "$output" == *'<before>'* ]]
  [[ "$output" == *'<after>'* ]]
}
