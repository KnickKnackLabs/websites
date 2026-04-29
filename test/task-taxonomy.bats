#!/usr/bin/env bats

REPO_DIR="${REPO_DIR:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

@test "task taxonomy: dashboard tasks replace home tasks" {
  [ -f "$REPO_DIR/.mise/tasks/mercury/dashboard" ]
  [ -f "$REPO_DIR/.mise/tasks/gusto/dashboard" ]
  [ -f "$REPO_DIR/.mise/tasks/wave/dashboard" ]

  [ ! -e "$REPO_DIR/.mise/tasks/mercury/home" ]
  [ ! -e "$REPO_DIR/.mise/tasks/gusto/home" ]
  [ ! -e "$REPO_DIR/.mise/tasks/wave/home" ]
}

@test "task taxonomy: explicit tasks replace default aliases" {
  [ -f "$REPO_DIR/.mise/tasks/nytimes/headlines" ]
  [ -f "$REPO_DIR/.mise/tasks/github/issue/open" ]
  [ -f "$REPO_DIR/.mise/tasks/github/project/view" ]

  [ ! -e "$REPO_DIR/.mise/tasks/nytimes/_default" ]
  [ ! -e "$REPO_DIR/.mise/tasks/github/issue/_default" ]
  [ ! -e "$REPO_DIR/.mise/tasks/github/project/_default" ]
}

@test "task taxonomy: renamed dashboard scripts are the implementation targets" {
  [ -f "$REPO_DIR/scripts/mercury/dashboard.mjs" ]
  [ -f "$REPO_DIR/scripts/gusto/dashboard.mjs" ]
  [ -f "$REPO_DIR/scripts/wave/dashboard.mjs" ]

  ! grep -R "scripts/mercury/home.mjs" "$REPO_DIR/.mise/tasks"
  ! grep -R "scripts/gusto/home.mjs" "$REPO_DIR/.mise/tasks"
  ! grep -R "scripts/wave/home.mjs" "$REPO_DIR/.mise/tasks"
}
