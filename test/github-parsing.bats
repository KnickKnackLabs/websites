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

# --- GitHub login OTP challenge handling ---

@test "classifyOtpChallenge: detects authenticator two-factor challenge" {
  run_js "
    import { classifyOtpChallenge } from '$SCRIPTS_DIR/login.mjs';
    console.log(classifyOtpChallenge({
      url: 'https://github.com/sessions/two-factor',
      text: 'Two-factor authentication Enter the authentication code from your authenticator app.'
    }));
  "
  [ "$output" = "totp" ]
}

@test "classifyOtpChallenge: detects email device verification" {
  run_js "
    import { classifyOtpChallenge } from '$SCRIPTS_DIR/login.mjs';
    console.log(classifyOtpChallenge({
      url: 'https://github.com/login/device',
      text: 'Verify your device. We sent a code to your email address.'
    }));
  "
  [ "$output" = "device" ]
}

@test "resolveGitHubTotpCode: prefers explicit one-time code env" {
  run_js "
    import { resolveGitHubTotpCode } from '$SCRIPTS_DIR/login.mjs';
    const code = resolveGitHubTotpCode('zeke', { env: { GITHUB_TOTP_CODE: '123456' } });
    console.log(code);
  "
  [ "$output" = "123456" ]
}

@test "resolveGitHubTotpCode: requires caller-injected code" {
  run_js "
    import { resolveGitHubTotpCode } from '$SCRIPTS_DIR/login.mjs';
    try {
      resolveGitHubTotpCode('zeke', { env: {} });
      console.log('no error');
    } catch (error) {
      console.log(error.message);
    }
  "
  [[ "$output" == *"set GITHUB_TOTP_CODE"* ]]
  [[ "$output" != *"secrets"* ]]
}

@test "resolveGitHubTotpCode: fails closed on invalid generated code" {
  run_js "
    import { resolveGitHubTotpCode } from '$SCRIPTS_DIR/login.mjs';
    try {
      resolveGitHubTotpCode('zeke', { env: { GITHUB_TOTP_CODE: 'abc123' } });
      console.log('no error');
    } catch (error) {
      console.log(error.message);
    }
  "
  [[ "$output" == *"not a 6-8 digit value"* ]]
}

# --- GitHub two-factor enrollment helpers ---

@test "extractTwoFactorSetupKey: extracts setup key without trailing prose" {
  run_js "
    import { extractTwoFactorSetupKey } from '$SCRIPTS_DIR/two-factor.mjs';
    const text = 'Your two-factor secret JBSW Y3DP EHPK 3PXP to manually configure your authenticator app.';
    console.log(extractTwoFactorSetupKey(text));
  "
  [ "$output" = "JBSWY3DPEHPK3PXP" ]
}

@test "extractTwoFactorSetupKey: returns null without a valid seed" {
  run_js "
    import { extractTwoFactorSetupKey } from '$SCRIPTS_DIR/two-factor.mjs';
    console.log(extractTwoFactorSetupKey('Your two-factor secret not available yet'));
  "
  [ "$output" = "null" ]
}

@test "extractRecoveryCodesFromText: extracts unique recovery codes" {
  run_js "
    import { extractRecoveryCodesFromText } from '$SCRIPTS_DIR/two-factor.mjs';
    const codes = extractRecoveryCodesFromText('save a1b2c-3d4e5 and f6g7h-8i9j0 and a1b2c-3d4e5');
    console.log(JSON.stringify(codes));
  "
  [ "$output" = '["a1b2c-3d4e5","f6g7h-8i9j0"]' ]
}

@test "generateTotpCode: matches RFC 6238 SHA1 test vector" {
  run_js "
    import { generateTotpCode } from '$SCRIPTS_DIR/two-factor.mjs';
    console.log(generateTotpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { now: 59000, digits: 8 }));
  "
  [ "$output" = "94287082" ]
}

@test "sanitizeTwoFactorText: redacts setup and recovery secrets" {
  run_js "
    import { sanitizeTwoFactorText } from '$SCRIPTS_DIR/two-factor.mjs';
    console.log(sanitizeTwoFactorText('seed JBSWY3DPEHPK3PXP recovery a1b2c-3d4e5 token github_pat_abc123'));
  "
  [[ "$output" == *"[BASE32]"* ]]
  [[ "$output" == *"[RECOVERY_CODE]"* ]]
  [[ "$output" == *"[GITHUB_TOKEN]"* ]]
  [[ "$output" != *"JBSWY3DPEHPK3PXP"* ]]
  [[ "$output" != *"a1b2c-3d4e5"* ]]
}

@test "reserveEnrollmentOutput: claims output path before browser mutations" {
  out="$BATS_TEST_TMPDIR/enrollment.json"
  run_js "
    import { existsSync, statSync } from 'node:fs';
    import { reserveEnrollmentOutput } from '$SCRIPTS_DIR/two-factor.mjs';
    const output = reserveEnrollmentOutput('$out');
    console.log(existsSync('$out'));
    console.log((statSync('$out').mode & 0o777).toString(8));
    output.write({ status: 'enrolled', totp_seed: 'JBSWY3DPEHPK3PXP', recovery_codes: ['a1b2c-3d4e5'] });
    console.log(statSync('$out').size > 0);
    try {
      reserveEnrollmentOutput('$out');
      console.log('no error');
    } catch (error) {
      console.log(error.code);
    }
  "
  [ "$(echo "$output" | sed -n '1p')" = "true" ]
  [ "$(echo "$output" | sed -n '2p')" = "600" ]
  [ "$(echo "$output" | sed -n '3p')" = "true" ]
  [ "$(echo "$output" | sed -n '4p')" = "EEXIST" ]
}

@test "reserveEnrollmentOutput: removes empty reservation after failed enrollment" {
  out="$BATS_TEST_TMPDIR/enrollment.json"
  run_js "
    import { existsSync } from 'node:fs';
    import { reserveEnrollmentOutput } from '$SCRIPTS_DIR/two-factor.mjs';
    const output = reserveEnrollmentOutput('$out');
    console.log(existsSync('$out'));
    output.discard();
    console.log(existsSync('$out'));
  "
  [ "$(echo "$output" | sed -n '1p')" = "true" ]
  [ "$(echo "$output" | sed -n '2p')" = "false" ]
}

@test "normalizeTwoFactorEntrypoint: defaults and validates values" {
  run_js "
    import { normalizeTwoFactorEntrypoint } from '$SCRIPTS_DIR/two-factor.mjs';
    console.log(normalizeTwoFactorEntrypoint(''));
    console.log(normalizeTwoFactorEntrypoint('SETTINGS'));
    try {
      normalizeTwoFactorEntrypoint('mystery');
      console.log('no error');
    } catch (error) {
      console.log(error.message);
    }
  "
  [ "$(echo "$output" | sed -n '1p')" = "auto" ]
  [ "$(echo "$output" | sed -n '2p')" = "settings" ]
  [[ "$(echo "$output" | sed -n '3p')" == *"auto, settings, token"* ]]
}

@test "classifyTwoFactorSettingsText: distinguishes enabled from available setup" {
  run_js "
    import { classifyTwoFactorSettingsText } from '$SCRIPTS_DIR/two-factor.mjs';
    console.log(classifyTwoFactorSettingsText('Two-factor authentication is enabled. View recovery codes.'));
    console.log(classifyTwoFactorSettingsText('Protect your account. Enable two-factor authentication.'));
    console.log(classifyTwoFactorSettingsText('Recovery codes Two-factor authentication is not enabled yet. Enable two-factor authentication.'));
    console.log(classifyTwoFactorSettingsText('Password and authentication'));
  "
  [ "$(echo "$output" | sed -n '1p')" = "enabled" ]
  [ "$(echo "$output" | sed -n '2p')" = "available" ]
  [ "$(echo "$output" | sed -n '3p')" = "available" ]
  [ "$(echo "$output" | sed -n '4p')" = "unknown" ]
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

@test "parseTokenFromText: extracts github_pat tokens" {
  run_js "
    import { parseTokenFromText } from '$SCRIPTS_DIR/token-rotate.mjs';
    console.log(parseTokenFromText('Your token is github_pat_11ABC_def456'));
  "
  [ "$output" = "github_pat_11ABC_def456" ]
}

# --- findClassicTokenByName ---

@test "findClassicTokenByName: requires exact token name match" {
  run_js "
    import { findClassicTokenByName } from '$SCRIPTS_DIR/tokens.mjs';
    const tokens = [{ id: '1', name: 'ikma-old' }, { id: '2', name: 'ikma' }];
    console.log(JSON.stringify(findClassicTokenByName(tokens, 'ikma')));
  "
  [ "$output" = '{"id":"2","name":"ikma"}' ]
}

@test "findClassicTokenByName: does not substring match" {
  run_js "
    import { findClassicTokenByName } from '$SCRIPTS_DIR/tokens.mjs';
    const tokens = [{ id: '1', name: 'or-personal' }];
    console.log(findClassicTokenByName(tokens, 'or'));
  "
  [ "$output" = "null" ]
}

# --- token creation helpers ---

@test "tokenCreationUrl: preselects description and scopes" {
  run_js "
    import { tokenCreationUrl } from '$SCRIPTS_DIR/token-create.mjs';
    const url = new URL(tokenCreationUrl('c0da'));
    console.log(url.pathname);
    console.log(url.searchParams.get('description'));
    console.log(url.searchParams.get('scopes').includes('repo'));
    console.log(url.searchParams.get('scopes').includes('workflow'));
  "
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | sed -n '1p')" = "/settings/tokens/new" ]
  [ "$(echo "$output" | sed -n '2p')" = "c0da" ]
  [ "$(echo "$output" | sed -n '3p')" = "true" ]
  [ "$(echo "$output" | sed -n '4p')" = "true" ]
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

# --- parseProjectArgs (project-view.mjs) ---

@test "parseProjectArgs: extracts owner, project number, and optional view" {
  run_js "
    import { parseProjectArgs } from '$SCRIPTS_DIR/project-view.mjs';
    console.log(JSON.stringify(parseProjectArgs(['ricon-family', '8', 'Current Sprint'])));
  "
  [ "$output" = '{"owner":"ricon-family","projectNumber":"8","viewName":"Current Sprint"}' ]
}

@test "parseProjectArgs: works without optional view name" {
  run_js "
    import { parseProjectArgs } from '$SCRIPTS_DIR/project-view.mjs';
    console.log(JSON.stringify(parseProjectArgs(['ricon-family', '8'])));
  "
  [ "$output" = '{"owner":"ricon-family","projectNumber":"8"}' ]
}

@test "parseProjectArgs: returns null when missing required args" {
  run_js "
    import { parseProjectArgs } from '$SCRIPTS_DIR/project-view.mjs';
    console.log(parseProjectArgs(['ricon-family']));
  "
  [ "$output" = "null" ]
}

@test "parseProjectArgs: returns null for empty args" {
  run_js "
    import { parseProjectArgs } from '$SCRIPTS_DIR/project-view.mjs';
    console.log(parseProjectArgs([]));
  "
  [ "$output" = "null" ]
}
