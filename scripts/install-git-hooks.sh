#!/bin/bash
# .git/hooks isn't tracked by git, so hooks live in hooks/ and get symlinked in.
set -e
cd "$(git rev-parse --show-toplevel)"
chmod +x hooks/post-commit
ln -sf ../../hooks/post-commit .git/hooks/post-commit
echo "installed post-commit hook"
