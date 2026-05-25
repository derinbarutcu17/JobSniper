#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TIMEOUT_SECS="${SNIPER_DAILY_TIMEOUT:-900}" # 15 minutes default
DRY_RUN="${SNIPER_DAILY_DRY_RUN:-1}"

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

SNIPER_CMD=(npm run sniper -- automate daily)
if [ "$DRY_RUN" = "1" ]; then
  # Fast report-only path: summarize from DB state without crawling.
  SNIPER_CMD+=(--dry-run)
  SNIPER_CMD+=("$@")
else
  # Full queue path: discover, generate artifacts, then sync mirrors.
  SNIPER_CMD+=("$@")
fi

run_with_timeout "$TIMEOUT_SECS" "${SNIPER_CMD[@]}"

if [ "$DRY_RUN" != "1" ]; then
  npm run sniper -- sheet sync
  npm run live:sync
fi
