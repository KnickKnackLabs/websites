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

# --- extractInviteUrl ---

@test "extractInviteUrl: extracts Mercury invite URL from sanitized invite email" {
  run_js "
    import { extractInviteUrl } from '$SCRIPTS_DIR/auth.mjs';
    const email = \`From: Mercury <hello@mercury.com>\nSubject: Activate your Mercury profile\n\nOr invited you to a Mercury account.\n\nYou can activate your profile by setting up your password and two-factor authentication.\n\nhttps://app.mercury.com/signup/invite?email=c0da%40ricon.family&inviteCode=deadbeef-1234-5678-90ab-feedfacecafe\n\nThis link will expire on April 30, 2026.\`;
    console.log(extractInviteUrl(email));
  "
  [ "$output" = "https://app.mercury.com/signup/invite?email=c0da%40ricon.family&inviteCode=deadbeef-1234-5678-90ab-feedfacecafe" ]
}

@test "extractInviteUrl: strips trailing punctuation from formatted email text" {
  run_js "
    import { extractInviteUrl } from '$SCRIPTS_DIR/auth.mjs';
    const email = 'Activate here: https://app.mercury.com/signup/invite?email=agent%40ricon.family&inviteCode=abc123.';
    console.log(extractInviteUrl(email));
  "
  [ "$output" = "https://app.mercury.com/signup/invite?email=agent%40ricon.family&inviteCode=abc123" ]
}

@test "extractInviteUrl: returns null when no Mercury invite URL is present" {
  run_js "
    import { extractInviteUrl } from '$SCRIPTS_DIR/auth.mjs';
    console.log(extractInviteUrl('No invite link here.'));
  "
  [ "$output" = "null" ]
}

# --- isAuthenticatedMercuryUrl ---

@test "isAuthenticatedMercuryUrl: recognizes authenticated Mercury app URL" {
  run_js "
    import { isAuthenticatedMercuryUrl } from '$SCRIPTS_DIR/auth.mjs';
    console.log(isAuthenticatedMercuryUrl('https://app.mercury.com/dashboard'));
  "
  [ "$output" = "true" ]
}

@test "isAuthenticatedMercuryUrl: rejects Mercury signup URL" {
  run_js "
    import { isAuthenticatedMercuryUrl } from '$SCRIPTS_DIR/auth.mjs';
    console.log(isAuthenticatedMercuryUrl('https://app.mercury.com/signup/invite?foo=bar'));
  "
  [ "$output" = "false" ]
}

# --- isMercuryAuthPage ---

@test "isMercuryAuthPage: recognizes Mercury login URL" {
  run_js "
    import { isMercuryAuthPage } from '$SCRIPTS_DIR/auth.mjs';
    console.log(isMercuryAuthPage('https://app.mercury.com/login', ''));
  "
  [ "$output" = "true" ]
}

@test "isMercuryAuthPage: recognizes Mercury activation text even without URL context" {
  run_js "
    import { isMercuryAuthPage } from '$SCRIPTS_DIR/auth.mjs';
    console.log(isMercuryAuthPage('not-a-url', 'Activate your Mercury profile\nSet up your password\nTwo-factor authentication'));
  "
  [ "$output" = "true" ]
}

@test "isMercuryAuthPage: rejects authenticated dashboard page" {
  run_js "
    import { isMercuryAuthPage } from '$SCRIPTS_DIR/auth.mjs';
    console.log(isMercuryAuthPage('https://app.mercury.com/dashboard', 'Mercury balance\nChecking ••9145'));
  "
  [ "$output" = "false" ]
}
