#!/usr/bin/env bats

# Tests for pure parsing functions in scripts/github/

SCRIPTS_DIR="$BATS_TEST_DIRNAME/../scripts/github"

# Helper: run a JS expression that imports from our modules and prints the result
run_js() {
  run node --input-type=module -e "$1"
}

# --- parseVerificationCode ---

@test "parseVerificationCode: extracts code after 'Verification code:'" {
  run_js "
    import { parseVerificationCode } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(parseVerificationCode('Your verification code: 847293'));
  "
  [ "$output" = "847293" ]
}

@test "parseVerificationCode: extracts code after 'Verify'" {
  run_js "
    import { parseVerificationCode } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(parseVerificationCode('Verify your device using this code: 123456'));
  "
  [ "$output" = "123456" ]
}

@test "parseVerificationCode: extracts code before 'is your verification code'" {
  run_js "
    import { parseVerificationCode } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(parseVerificationCode('987654 is your verification code'));
  "
  [ "$output" = "987654" ]
}

@test "parseVerificationCode: extracts standalone code on its own line" {
  run_js "
    import { parseVerificationCode } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(parseVerificationCode('Here is your code:\n  482019\nDo not share it.'));
  "
  [ "$output" = "482019" ]
}

@test "parseVerificationCode: ignores timestamps that look like numbers" {
  run_js "
    import { parseVerificationCode } from '$SCRIPTS_DIR/email-code.mjs';
    const email = 'Sent at 20260317 from IP 1234567. Your verification code: 839201';
    console.log(parseVerificationCode(email));
  "
  [ "$output" = "839201" ]
}

@test "parseVerificationCode: ignores inline IDs, picks contextual code" {
  run_js "
    import { parseVerificationCode } from '$SCRIPTS_DIR/email-code.mjs';
    const email = 'Request ID: 98765432. OTP: 654321. Thanks.';
    console.log(parseVerificationCode(email));
  "
  [ "$output" = "654321" ]
}

@test "parseVerificationCode: returns null when no code present" {
  run_js "
    import { parseVerificationCode } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(parseVerificationCode('Hello, this is a normal email with no codes.'));
  "
  [ "$output" = "null" ]
}

@test "parseVerificationCode: handles 8-digit codes" {
  run_js "
    import { parseVerificationCode } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(parseVerificationCode('Your verification code is 12345678'));
  "
  [ "$output" = "12345678" ]
}

# --- isVerificationEmail ---

@test "isVerificationEmail: matches GitHub verification subject" {
  run_js "
    import { isVerificationEmail } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(isVerificationEmail('| 384 | * | [GitHub] Please verify your device | noreply@github.com |'));
  "
  [ "$output" = "true" ]
}

@test "isVerificationEmail: matches sign-in keyword" {
  run_js "
    import { isVerificationEmail } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(isVerificationEmail('| 100 | * | GitHub sign-in verification | noreply@github.com |'));
  "
  [ "$output" = "true" ]
}

@test "isVerificationEmail: rejects unrelated email" {
  run_js "
    import { isVerificationEmail } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(isVerificationEmail('| 200 | * | Weekly digest | digest@example.com |'));
  "
  [ "$output" = "false" ]
}

# --- parseEmailId ---

@test "parseEmailId: extracts ID from table line" {
  run_js "
    import { parseEmailId } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(parseEmailId('| 384 | * | Some subject | sender@example.com |'));
  "
  [ "$output" = "384" ]
}

@test "parseEmailId: handles large IDs" {
  run_js "
    import { parseEmailId } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(parseEmailId('|  12345  |   | Another subject | x@y.com |'));
  "
  [ "$output" = "12345" ]
}

@test "parseEmailId: returns null for non-table line" {
  run_js "
    import { parseEmailId } from '$SCRIPTS_DIR/email-code.mjs';
    console.log(parseEmailId('This is not a table line'));
  "
  [ "$output" = "null" ]
}

# --- parseTokenFromText ---

@test "parseTokenFromText: extracts ghp_ token from text" {
  run_js "
    import { parseTokenFromText } from '$SCRIPTS_DIR/token-rotate.mjs';
    console.log(parseTokenFromText('Your new token is ghp_abc123XYZ456 — save it now.'));
  "
  [ "$output" = "ghp_abc123XYZ456" ]
}

@test "parseTokenFromText: returns null when no token present" {
  run_js "
    import { parseTokenFromText } from '$SCRIPTS_DIR/token-rotate.mjs';
    console.log(parseTokenFromText('No tokens here, just regular text.'));
  "
  [ "$output" = "null" ]
}

@test "parseTokenFromText: extracts first token if multiple present" {
  run_js "
    import { parseTokenFromText } from '$SCRIPTS_DIR/token-rotate.mjs';
    console.log(parseTokenFromText('Old: ghp_oldtoken123 New: ghp_newtoken456'));
  "
  [ "$output" = "ghp_oldtoken123" ]
}

# --- parseTokenId ---

@test "parseTokenId: extracts ID from settings URL" {
  run_js "
    import { parseTokenId } from '$SCRIPTS_DIR/token-rotate.mjs';
    console.log(parseTokenId('/settings/tokens/12345'));
  "
  [ "$output" = "12345" ]
}

@test "parseTokenId: extracts ID from full href" {
  run_js "
    import { parseTokenId } from '$SCRIPTS_DIR/token-rotate.mjs';
    console.log(parseTokenId('https://github.com/settings/tokens/99887'));
  "
  [ "$output" = "99887" ]
}

@test "parseTokenId: returns null for non-matching href" {
  run_js "
    import { parseTokenId } from '$SCRIPTS_DIR/token-rotate.mjs';
    console.log(parseTokenId('/settings/profile'));
  "
  [ "$output" = "null" ]
}

# --- parseIssueRef (project-view.mjs) ---

@test "parseIssueRef: extracts repo and number from issue URL path" {
  run_js "
    import { parseIssueRef } from '$SCRIPTS_DIR/project-view.mjs';
    console.log(JSON.stringify(parseIssueRef('/KnickKnackLabs/shimmer/issues/608')));
  "
  [ "$output" = '{"repo":"KnickKnackLabs/shimmer","number":608}' ]
}

@test "parseIssueRef: works with full GitHub URL" {
  run_js "
    import { parseIssueRef } from '$SCRIPTS_DIR/project-view.mjs';
    console.log(JSON.stringify(parseIssueRef('https://github.com/ricon-family/or/issues/42')));
  "
  [ "$output" = '{"repo":"ricon-family/or","number":42}' ]
}

@test "parseIssueRef: returns null for non-issue paths" {
  run_js "
    import { parseIssueRef } from '$SCRIPTS_DIR/project-view.mjs';
    console.log(parseIssueRef('/KnickKnackLabs/shimmer/pull/123'));
  "
  [ "$output" = "null" ]
}
