#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TIMEOUT_SECS="${SNIPER_DAILY_TIMEOUT:-900}" # 15 minutes default
DEEP_MODE="${SNIPER_DAILY_DEEP:-0}"
REFRESH_PROFILE="${SNIPER_DAILY_REFRESH_PROFILE:-0}"
NO_SHEET="${SNIPER_DAILY_NO_SHEET:-0}"

if [ ! -d "$REPO_DIR" ]; then
  echo "Job Sniper repo directory was not found: $REPO_DIR" >&2
  exit 1
fi

cd "$REPO_DIR"

if [ -f "$HOME/.hermes/.env" ]; then
  set -a
  . "$HOME/.hermes/.env"
  set +a
fi

if [ ! -f "$REPO_DIR/profile/cv.md" ]; then
  echo "Job Sniper profile is missing. Run onboarding before automation." >&2
  exit 1
fi

run_with_timeout() {
  local timeout_secs="$1"
  shift

  perl -e '
    my $timeout = shift @ARGV;
    my @cmd = @ARGV;
    my $pid = fork();
    die "fork failed: $!" unless defined $pid;
    if ($pid == 0) {
      exec @cmd or die "exec failed: $!";
    }
    local $SIG{ALRM} = sub {
      kill "TERM", $pid;
      sleep 2;
      kill "KILL", $pid;
      waitpid($pid, 0);
      exit 124;
    };
    alarm $timeout;
    waitpid($pid, 0);
    alarm 0;
    my $status = $?;
    my $signal = $status & 127;
    exit($signal ? 128 + $signal : ($status >> 8));
  ' "$timeout_secs" "$@"
}

SNIPER_CMD=(npm run sniper -- daily)

if [ "$DEEP_MODE" = "1" ]; then
  SNIPER_CMD+=(--deep)
fi

if [ "$REFRESH_PROFILE" = "1" ]; then
  SNIPER_CMD+=(--refresh-profile)
fi

if [ "$NO_SHEET" = "1" ]; then
  SNIPER_CMD+=(--no-sheet)
fi

SNIPER_CMD+=("$@")

run_with_timeout "$TIMEOUT_SECS" "${SNIPER_CMD[@]}"
