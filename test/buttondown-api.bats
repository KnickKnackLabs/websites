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
  [[ "$output" == *"--json"* ]]
}

@test "buttondown:api:emails:create help exposes file-backed and JSON flags" {
  run websites buttondown:api:emails:create --help

  [ "$status" -eq 0 ]
  [[ "$output" == *"--body-file <body_file>"* ]]
  [[ "$output" == *"--dry-run"* ]]
  [[ "$output" == *"--json"* ]]
}

@test "buttondown:api:emails:update help exposes file-backed and JSON flags" {
  run websites buttondown:api:emails:update --help

  [ "$status" -eq 0 ]
  [[ "$output" == *"--id <id>"* ]]
  [[ "$output" == *"--body-file <body_file>"* ]]
  [[ "$output" == *"--dry-run"* ]]
  [[ "$output" == *"--json"* ]]
}

@test "buttondown:api:emails:send help exposes live-send confirmation flag" {
  run websites buttondown:api:emails:send --help

  [ "$status" -eq 0 ]
  [[ "$output" == *"--id <id>"* ]]
  [[ "$output" == *"--i-understand-this-sends-to-subscribers"* ]]
  [[ "$output" == *"--dry-run"* ]]
  [[ "$output" == *"--json"* ]]
}

@test "buttondown:api tasks print concise errors for operator failures" {
  run env -u BUTTONDOWN_API_KEY bash -c 'cd "$REPO_DIR" && mise run -q buttondown:api:newsletters'

  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: BUTTONDOWN_API_KEY env var is required"* ]]
  [[ "$output" != *" at "* ]]
  [[ "$output" != *"scripts/buttondown/api.mjs"* ]]
}

@test "buttondown:api:emails:create dry-run builds draft payload without API key" {
  body="$BATS_TEST_TMPDIR/body.md"
  cat > "$body" <<'EOF'
Hello **newsletter** readers.
EOF

  run env -u BUTTONDOWN_API_KEY bash -c 'cd "$REPO_DIR" && mise run -q buttondown:api:emails:create --subject "Hello" --canonical-url "https://example.com/story" --body-file "$0" --dry-run --json' "$body"

  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.dry_run == true' >/dev/null
  echo "$output" | jq -e '.payload.subject == "Hello"' >/dev/null
  echo "$output" | jq -e '.payload.status == "draft"' >/dev/null
  echo "$output" | jq -e '.payload.canonical_url == "https://example.com/story"' >/dev/null
  echo "$output" | jq -e '.payload.body | startswith("<!-- buttondown-editor-mode: plaintext -->")' >/dev/null
}

@test "buttondown:api:emails:create rejects frontmatter before API calls" {
  body="$BATS_TEST_TMPDIR/frontmatter.md"
  cat > "$body" <<'EOF'
---
title: Nope
---

Body.
EOF

  run env -u BUTTONDOWN_API_KEY bash -c 'cd "$REPO_DIR" && mise run -q buttondown:api:emails:create --subject "Nope" --body-file "$0" --dry-run' "$body"

  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: Email body appears to start with YAML frontmatter"* ]]
  [[ "$output" != *"BUTTONDOWN_API_KEY"* ]]
}

@test "buttondown:api:emails:update dry-run builds patch payload without API key" {
  body="$BATS_TEST_TMPDIR/update-body.md"
  cat > "$body" <<'EOF'
Updated **newsletter** body.
EOF

  run env -u BUTTONDOWN_API_KEY bash -c 'cd "$REPO_DIR" && mise run -q buttondown:api:emails:update --id email_123 --body-file "$0" --dry-run --json' "$body"

  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.dry_run == true' >/dev/null
  echo "$output" | jq -e '.id == "email_123"' >/dev/null
  echo "$output" | jq -e '.payload.body | startswith("<!-- buttondown-editor-mode: plaintext -->")' >/dev/null
}

@test "buttondown:api:emails:send dry-run reports live-send transition without API key" {
  run env -u BUTTONDOWN_API_KEY bash -c 'cd "$REPO_DIR" && mise run -q buttondown:api:emails:send --id email_123 --dry-run --json'

  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.dry_run == true' >/dev/null
  echo "$output" | jq -e '.id == "email_123"' >/dev/null
  echo "$output" | jq -e '.status == "about_to_send"' >/dev/null
}

@test "buttondown:api:emails:send requires explicit live-send confirmation before API key" {
  run env -u BUTTONDOWN_API_KEY bash -c 'cd "$REPO_DIR" && mise run -q buttondown:api:emails:send --id email_123'

  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: --i-understand-this-sends-to-subscribers is required"* ]]
  [[ "$output" != *"BUTTONDOWN_API_KEY"* ]]
}

@test "buttondown:api:emails:send-draft dry-run reports count without recipient addresses" {
  run websites buttondown:api:emails:send-draft --id email_123 --recipient test@example.com --dry-run --json

  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.dry_run == true' >/dev/null
  echo "$output" | jq -e '.recipient_count == 1' >/dev/null
  [[ "$output" != *"test@example.com"* ]]
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

@test "sanitizeListPayload: emails omit bodies by default" {
  run_js "
    import { sanitizeListPayload } from '$SCRIPTS_DIR/api.mjs';
    const payload = {
      count: 1,
      results: [{
        id: 'email_123',
        subject: 'Hello',
        status: 'draft',
        body: 'secret draft body',
        canonical_url: 'https://example.com/story',
        absolute_url: 'https://buttondown.com/example/archive/hello/'
      }]
    };
    console.log(JSON.stringify(sanitizeListPayload('emails', payload)));
  "

  [ "$status" -eq 0 ]
  [[ "$output" == *'"subject":"Hello"'* ]]
  [[ "$output" == *'"status":"draft"'* ]]
  [[ "$output" != *'secret draft body'* ]]
}

@test "buildEmailCreatePayload: creates explicit drafts and rejects Buttondown auto-send default" {
  run_js "
    import { buildEmailCreatePayload } from '$SCRIPTS_DIR/api.mjs';
    const payload = buildEmailCreatePayload({
      subject: 'Hello',
      body: 'Body',
      canonicalUrl: 'https://example.com/story'
    });
    console.log(JSON.stringify(payload));
  "

  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.subject == "Hello"' >/dev/null
  echo "$output" | jq -e '.status == "draft"' >/dev/null
  echo "$output" | jq -e '.canonical_url == "https://example.com/story"' >/dev/null
  echo "$output" | jq -e '.body == "<!-- buttondown-editor-mode: plaintext -->\nBody"' >/dev/null
}

@test "updateEmail: patches sanitized draft fields" {
  run_js "
    import { updateEmail } from '$SCRIPTS_DIR/api.mjs';
    const calls = [];
    const patch = async (path, body) => {
      calls.push({ path, body });
      return { id: 'email_123', subject: body.subject, status: 'draft', body: body.body };
    };
    const output = await updateEmail('email_123', { subject: 'Updated', body: 'Body' }, { patch });
    console.log(JSON.stringify({ output, calls }));
  "

  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.output.id == "email_123"' >/dev/null
  echo "$output" | jq -e '.output.subject == "Updated"' >/dev/null
  echo "$output" | jq -e '.output.body == null' >/dev/null
  echo "$output" | jq -e '.calls[0].path == "/emails/email_123"' >/dev/null
  echo "$output" | jq -e '.calls[0].body.body == "<!-- buttondown-editor-mode: plaintext -->\nBody"' >/dev/null
}

@test "sendEmail: patches draft status to about_to_send" {
  run_js "
    import { sendEmail } from '$SCRIPTS_DIR/api.mjs';
    const calls = [];
    const patch = async (path, body) => {
      calls.push({ path, body });
      return { id: 'email_123', subject: 'Hello', status: body.status, body: 'secret' };
    };
    const output = await sendEmail('email_123', { patch });
    console.log(JSON.stringify({ output, calls }));
  "

  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.output.id == "email_123"' >/dev/null
  echo "$output" | jq -e '.output.status == "about_to_send"' >/dev/null
  echo "$output" | jq -e '.output.body == null' >/dev/null
  echo "$output" | jq -e '.calls[0].path == "/emails/email_123"' >/dev/null
  echo "$output" | jq -e '.calls[0].body.status == "about_to_send"' >/dev/null
}

@test "sendDraftEmail: posts recipients to Buttondown draft endpoint" {
  run_js "
    import { sendDraftEmail } from '$SCRIPTS_DIR/api.mjs';
    const calls = [];
    const post = async (path, body) => {
      calls.push({ path, body });
      return null;
    };
    const output = await sendDraftEmail('email_123', ['test@example.com'], { post });
    console.log(JSON.stringify({ output, calls }));
  "

  [ "$status" -eq 0 ]
  [ "$output" = '{"output":{"action":"send-draft","id":"email_123","recipient_count":1},"calls":[{"path":"/emails/email_123/send-draft","body":{"recipients":["test@example.com"]}}]}' ]
}
