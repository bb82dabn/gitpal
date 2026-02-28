#!/usr/bin/env bash
# GitPal shell integration installer
# Run this once, then: source ~/.bashrc

GITPAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASHRC="$HOME/.bashrc"
MARKER="# GitPal shell integration"

# Check if already installed
if grep -q "$MARKER" "$BASHRC" 2>/dev/null; then
  echo "  GitPal shell integration already installed in ~/.bashrc"
  exit 0
fi

cat >> "$BASHRC" << SHELLEOF

$MARKER
_gitpal_cd() {
  builtin cd "\$@" || return
  # Silently run GitPal shell hook in background (detects ungitted dirs + starts watcher)
  command -v gp &>/dev/null && gp _shell_hook 2>/dev/null &
}
alias cd='_gitpal_cd'
SHELLEOF

echo "  GitPal shell integration added to ~/.bashrc"
echo "  Run: source ~/.bashrc"
