#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

SCRIPTS_DIR="$BATS_TEST_DIRNAME/../scripts/github"

run_js_file() {
  local file="$BATS_TEST_TMPDIR/test.mjs"
  cat > "$file"
  run --separate-stderr node "$file"
}

@test "post-2FA gate returns false when no interstitial is visible" {
  run_js_file <<EOF
import { handlePost2faVerificationInterstitial } from '$SCRIPTS_DIR/sensitive-page-gate.mjs';

let clicked = false;
const page = {
  locator() {
    return { first: () => ({ isVisible: async () => false, click: async () => { clicked = true; } }) };
  },
};

const handled = await handlePost2faVerificationInterstitial(page, {
  agent: 'ikma',
  totpResolver: async () => '111111',
});
console.log(JSON.stringify({ handled, clicked }));
EOF

  [ "$status" -eq 0 ]
  [ "$output" = '{"handled":false,"clicked":false}' ]
}

@test "post-2FA gate submits a fresh TOTP through app_otp and never clicks skip" {
  run_js_file <<EOF
import { handlePost2faVerificationInterstitial } from '$SCRIPTS_DIR/sensitive-page-gate.mjs';

const calls = [];
let filled = null;
let usedAppOtpSelector = false;
let resolverCalls = 0;
const page = {
  title: async () => 'Verify two-factor authentication',
  waitForLoadState: async state => calls.push(['wait', state]),
  locator(selector) {
    if (selector.includes('skip 2FA verification')) throw new Error('skip selector must not be used');
    return { first: () => ({
      isVisible: async () => selector.includes('Verify 2FA now'),
      click: async () => calls.push(['click', selector]),
      waitFor: async options => calls.push(['waitFor', selector, options.state]),
      fill: async value => { filled = value; usedAppOtpSelector = selector.includes('input[name="app_otp"]'); calls.push(['fill', selector]); },
    }) };
  },
};

const handled = await handlePost2faVerificationInterstitial(page, {
  agent: 'ikma',
  loginTotpCode: '111111',
  freshTotpTimeoutMs: 5000,
  freshTotpPollMs: 1,
  sleep: async () => calls.push(['sleep']),
  totpResolver: async agent => {
    resolverCalls += 1;
    calls.push(['resolve', agent]);
    return resolverCalls === 1 ? '111111' : '222222';
  },
});

console.log(JSON.stringify({ handled, filled, usedAppOtpSelector, resolverCalls, slept: calls.some(call => call[0] === 'sleep') }));
EOF

  [ "$status" -eq 0 ]
  [ "$output" = '{"handled":true,"filled":"222222","usedAppOtpSelector":true,"resolverCalls":2,"slept":true}' ]
}

@test "fresh TOTP resolver refuses to replay login-consumed code with sanitized error" {
  run_js_file <<EOF
import { resolveFreshGitHubTotpCode } from '$SCRIPTS_DIR/sensitive-page-gate.mjs';

try {
  await resolveFreshGitHubTotpCode({
    agent: 'c0da',
    previousCode: '123456',
    timeoutMs: 0,
    pollMs: 0,
    sleep: async () => {},
    totpResolver: async () => '123456',
  });
  console.log('no error');
} catch (error) {
  console.log(error.message);
}
EOF

  [ "$status" -eq 0 ]
  [[ "$output" == *"refusing to replay"* ]]
  [[ "$output" != *"123456"* ]]
}

@test "openGitHubSensitivePage revisits target after clearing interstitial" {
  run_js_file <<EOF
import { openGitHubSensitivePage } from '$SCRIPTS_DIR/sensitive-page-gate.mjs';

const gotos = [];
let verifyVisible = true;
const page = {
  title: async () => 'Verify two-factor authentication',
  goto: async url => gotos.push(url),
  waitForLoadState: async () => {},
  locator(selector) {
    return { first: () => ({
      isVisible: async () => selector.includes('Verify 2FA now') && verifyVisible,
      click: async () => { if (selector.includes('Verify')) verifyVisible = false; },
      waitFor: async () => {},
      fill: async () => {},
    }) };
  },
};

const result = await openGitHubSensitivePage(page, 'https://github.com/settings/tokens/new?description=ikma', {
  agent: 'ikma',
  totpResolver: async () => '333333',
});
console.log(JSON.stringify({ gotos, result }));
EOF

  [ "$status" -eq 0 ]
  [ "$output" = '{"gotos":["https://github.com/settings/tokens/new?description=ikma","https://github.com/settings/tokens/new?description=ikma"],"result":{"clearedPost2faVerification":true}}' ]
}
