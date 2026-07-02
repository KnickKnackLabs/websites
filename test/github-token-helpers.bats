#!/usr/bin/env bats

SCRIPTS_DIR="$BATS_TEST_DIRNAME/../scripts/github"

run_js() {
  run node --input-type=module -e "$1"
}

@test "captureGitHubTokenFromPage captures input token value" {
  run_js "
    import { captureGitHubTokenFromPage } from '$SCRIPTS_DIR/token-capture.mjs';
    const page = fakePage({ 'input#new-oauth-token': [{ value: 'ghp_inputToken_123' }] });
    console.log(await captureGitHubTokenFromPage(page));

    function fakePage(map) {
      return { locator: selector => fakeLocator(map[selector] || []), evaluate: async () => null };
    }
    function fakeLocator(elements) {
      return { count: async () => elements.length, nth: i => fakeElement(elements[i]) };
    }
    function fakeElement(attrs) {
      return {
        getAttribute: async name => attrs[name] || null,
        textContent: async () => attrs.text || '',
      };
    }
  "
  [ "$output" = "ghp_inputToken_123" ]
}

@test "captureGitHubTokenFromPage captures data-clipboard-text token" {
  run_js "
    import { captureGitHubTokenFromPage } from '$SCRIPTS_DIR/token-capture.mjs';
    const page = fakePage({ '[data-clipboard-text]': [{ 'data-clipboard-text': 'ghp_clipboardToken_123' }] });
    console.log(await captureGitHubTokenFromPage(page));

    function fakePage(map) { return { locator: selector => fakeLocator(map[selector] || []), evaluate: async () => null }; }
    function fakeLocator(elements) { return { count: async () => elements.length, nth: i => fakeElement(elements[i]) }; }
    function fakeElement(attrs) { return { getAttribute: async name => attrs[name] || null, textContent: async () => attrs.text || '' }; }
  "
  [ "$output" = "ghp_clipboardToken_123" ]
}

@test "captureGitHubTokenFromPage captures clipboard-copy text token" {
  run_js "
    import { captureGitHubTokenFromPage } from '$SCRIPTS_DIR/token-capture.mjs';
    const page = fakePage({ 'clipboard-copy': [{ text: 'Copy github_pat_11ABC_def456' }] });
    console.log(await captureGitHubTokenFromPage(page));

    function fakePage(map) { return { locator: selector => fakeLocator(map[selector] || []), evaluate: async () => null }; }
    function fakeLocator(elements) { return { count: async () => elements.length, nth: i => fakeElement(elements[i]) }; }
    function fakeElement(attrs) { return { getAttribute: async name => attrs[name] || null, textContent: async () => attrs.text || '' }; }
  "
  [ "$output" = "github_pat_11ABC_def456" ]
}

@test "captureGitHubTokenFromPage broad DOM fallback returns only token" {
  run_js "
    import { captureGitHubTokenFromPage } from '$SCRIPTS_DIR/token-capture.mjs';
    const page = { locator: () => ({ count: async () => 0 }), evaluate: async () => 'ghp_fallbackToken_123' };
    console.log(await captureGitHubTokenFromPage(page));
  "
  [ "$output" = "ghp_fallbackToken_123" ]
}

@test "safe diagnostics are structure-first and redact defense-in-depth" {
  run_js "
    import { formatPageFacts } from '$SCRIPTS_DIR/page-diagnostics.mjs';
    const rendered = formatPageFacts({
      url: 'https://github.com/settings/tokens/new?secret=ghp_urlToken_123#github_pat_hash_456',
      title: 'Token page for dev@example.com',
      headings: ['New personal access token ghp_headingToken_123'],
      alerts: ['Verification code 123456 and recovery a1b2c-3d4e5'],
      buttons: ['Generate token'],
      controls: [{
        tag: 'input', type: 'text', id: 'new-oauth-token', name: 'token',
        labels: ['Personal access token'], value: 'sk_futureTokenShape_should_not_leak',
      }, {
        tag: 'button', type: 'submit', id: 'submit', name: '', text: 'Generate token ghp_buttonToken_123',
      }],
    });
    console.log(rendered);
  "
  [[ "$output" == *'"value": "[present]"'* ]]
  [[ "$output" == *'Generate token [REDACTED_GITHUB_TOKEN]'* ]]
  [[ "$output" == *'[REDACTED_EMAIL]'* ]]
  [[ "$output" == *'[REDACTED_RECOVERY_CODE]'* ]]
  [[ "$output" == *'[REDACTED_CODE]'* ]]
  [[ "$output" != *'sk_futureTokenShape_should_not_leak'* ]]
  [[ "$output" != *'ghp_headingToken_123'* ]]
  [[ "$output" != *'dev@example.com'* ]]
  [[ "$output" != *'a1b2c-3d4e5'* ]]
  [[ "$output" != *'123456'* ]]
}
