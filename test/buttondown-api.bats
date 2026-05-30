#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

SCRIPTS_DIR="$BATS_TEST_DIRNAME/../scripts/buttondown"
REPO_DIR="${REPO_DIR:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

run_js() {
  run node --input-type=module -e "$1"
}

websites() {
  cd "$REPO_DIR" && mise run -q "$@"
}

@test "buttondown:api:subscribers help exposes usage flags from TypeScript task" {
  run websites buttondown:api:subscribers --help

  [ "$status" -eq 0 ]
  [[ "$output" == *"--tag <tag>"* ]]
  [[ "$output" == *"--type <type>"* ]]
  [[ "$output" == *"--referrer-url <referrer_url>"* ]]
}

@test "buttondown:api tasks print concise errors for operator failures" {
  run env -u BUTTONDOWN_API_KEY bash -c 'cd "$REPO_DIR" && mise run -q buttondown:api:newsletters'

  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: BUTTONDOWN_API_KEY env var is required"* ]]
  [[ "$output" != *" at "* ]]
  [[ "$output" != *"scripts/buttondown/api.mjs"* ]]
}

@test "sanitizeListPayload: newsletters omit private account fields" {
  run_js "
    import { sanitizeListPayload } from '$SCRIPTS_DIR/api.mjs';
    const payload = [{
      id: 'news_123',
      name: 'KKL Stories',
      username: 'knickknacklabs',
      api_key: 'secret',
      from_email: 'private@example.com',
      reply_to_address: 'private@example.com',
      subscription_redirect_url: 'https://stories.knacklabs.co/subscribed/',
      test_mode: false
    }];
    console.log(JSON.stringify(sanitizeListPayload('newsletters', payload)));
  "

  [ "$status" -eq 0 ]
  [[ "$output" == *'"name":"KKL Stories"'* ]]
  [[ "$output" == *'"subscription_redirect_url":"https://stories.knacklabs.co/subscribed/"'* ]]
  [[ "$output" != *'secret'* ]]
  [[ "$output" != *'private@example.com'* ]]
}

@test "sanitizeListPayload: subscribers omit email addresses and IDs" {
  run_js "
    import { sanitizeListPayload } from '$SCRIPTS_DIR/api.mjs';
    const payload = {
      count: 1,
      next: null,
      previous: null,
      results: [{
        id: 'sub_123',
        email_address: 'subscriber@example.com',
        creation_date: '2026-05-30T06:13:35Z',
        type: 'regular',
        source: 'embedded_form',
        referrer_url: 'https://stories.knacklabs.co/',
        metadata: { email: 'nested@example.com' }
      }]
    };
    console.log(JSON.stringify(sanitizeListPayload('subscribers', payload)));
  "

  [ "$status" -eq 0 ]
  [[ "$output" == *'"count":1'* ]]
  [[ "$output" == *'"type":"regular"'* ]]
  [[ "$output" == *'"source":"embedded_form"'* ]]
  [[ "$output" != *'subscriber@example.com'* ]]
  [[ "$output" != *'nested@example.com'* ]]
  [[ "$output" != *'sub_123'* ]]
}

@test "tagIdFromTagsPayload: resolves exact tag names to Buttondown tag IDs" {
  run_js "
    import { tagIdFromTagsPayload } from '$SCRIPTS_DIR/api.mjs';
    const payload = {
      results: [
        { id: 'sub_tag_wrong', name: 'stories' },
        { id: 'sub_tag_abc123', name: 'stories-site' }
      ]
    };
    console.log(tagIdFromTagsPayload(payload, 'stories-site'));
  "

  [ "$status" -eq 0 ]
  [ "$output" = "sub_tag_abc123" ]
}

@test "buildSubscriberParams: uses resolved tag ID rather than tag name" {
  run_js "
    import { buildSubscriberParams } from '$SCRIPTS_DIR/api.mjs';
    const params = buildSubscriberParams({
      ordering: '-creation_date',
      limit: '10',
      type: 'regular',
      tag: 'stories-site',
      dateStart: '2026-05-30',
      referrerUrl: 'stories.knacklabs.co'
    }, 'sub_tag_abc123');
    console.log(JSON.stringify(params));
  "

  [ "$status" -eq 0 ]
  [ "$output" = '{"ordering":"-creation_date","limit":"10","type":"regular","tag":"sub_tag_abc123","date__start":"2026-05-30","referrer_url":"stories.knacklabs.co"}' ]
}
