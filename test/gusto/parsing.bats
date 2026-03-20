#!/usr/bin/env bats

# Tests for pure parsing functions in scripts/gusto/

SCRIPTS_DIR="$BATS_TEST_DIRNAME/../../scripts/gusto"

run_js() {
  run node --input-type=module -e "$1"
}

# --- parseTaskText ---

@test "parseTaskText: extracts title, description, and due date" {
  run_js "
    import { parseTaskText } from '$SCRIPTS_DIR/home.mjs';
    const result = parseTaskText('Due Apr 14\nRun payroll\nTime to make employees happy');
    console.log(JSON.stringify(result));
  "
  [ "$(echo "$output" | jq -r '.due')" = "Apr 14" ]
  [ "$(echo "$output" | jq -r '.title')" = "Run payroll" ]
  [ "$(echo "$output" | jq -r '.description')" = "Time to make employees happy" ]
}

@test "parseTaskText: handles missing due date" {
  run_js "
    import { parseTaskText } from '$SCRIPTS_DIR/home.mjs';
    const result = parseTaskText('Run payroll\nTime to make employees happy');
    console.log(JSON.stringify(result));
  "
  [ "$(echo "$output" | jq -r '.due')" = "null" ]
  [ "$(echo "$output" | jq -r '.title')" = "Run payroll" ]
}

@test "parseTaskText: strips Start button text" {
  run_js "
    import { parseTaskText } from '$SCRIPTS_DIR/home.mjs';
    const result = parseTaskText('Due Apr 14\nRun payroll\nStart >\nSome description');
    console.log(JSON.stringify(result));
  "
  [ "$(echo "$output" | jq -r '.title')" = "Run payroll" ]
  [ "$(echo "$output" | jq -r '.description')" = "Some description" ]
}

# --- normalizeText (via payroll-history) ---

@test "normalizeText: collapses whitespace" {
  run_js "
    import { normalizeText } from '$BATS_TEST_DIRNAME/../../scripts/utils.mjs';
    console.log(normalizeText('  hello\n  world  '));
  "
  [ "$output" = "hello world" ]
}

# --- parseStatus ---

@test "parseStatus: extracts Complete from cell with extra text" {
  run_js "
    import { parseStatus } from '$SCRIPTS_DIR/payroll-history.mjs';
    console.log(parseStatus('Complete\nAdjust payroll'));
  "
  [ "$output" = "Complete" ]
}

@test "parseStatus: extracts Pending" {
  run_js "
    import { parseStatus } from '$SCRIPTS_DIR/payroll-history.mjs';
    console.log(parseStatus('Pending'));
  "
  [ "$output" = "Pending" ]
}

@test "parseStatus: returns original text when no known status" {
  run_js "
    import { parseStatus } from '$SCRIPTS_DIR/payroll-history.mjs';
    console.log(parseStatus('Unknown status'));
  "
  [ "$output" = "Unknown status" ]
}

# --- parsePayrollRow ---

@test "parsePayrollRow: parses a complete row" {
  run_js "
    import { parsePayrollRow } from '$SCRIPTS_DIR/payroll-history.mjs';
    const result = parsePayrollRow(['Mar 16, 2026', 'Regular', 'Mar 1–31', 'Direct deposit', 'Complete\nAdjust', '\$11,812.41']);
    console.log(JSON.stringify(result));
  "
  [ "$(echo "$output" | jq -r '.payday')" = "Mar 16, 2026" ]
  [ "$(echo "$output" | jq -r '.status')" = "Complete" ]
  [ "$(echo "$output" | jq -r '.total')" = "\$11,812.41" ]
}

@test "parsePayrollRow: returns null for short rows" {
  run_js "
    import { parsePayrollRow } from '$SCRIPTS_DIR/payroll-history.mjs';
    console.log(parsePayrollRow(['Mar 16', 'Regular']));
  "
  [ "$output" = "null" ]
}

# --- parseDollars ---

@test "parseDollars: parses dollar amount to cents" {
  run_js "
    import { parseDollars } from '$SCRIPTS_DIR/payroll-history.mjs';
    console.log(parseDollars('\$11,812.41'));
  "
  [ "$output" = "1181241" ]
}

@test "parseDollars: returns null for non-numeric" {
  run_js "
    import { parseDollars } from '$SCRIPTS_DIR/payroll-history.mjs';
    console.log(parseDollars('N/A'));
  "
  [ "$output" = "null" ]
}
