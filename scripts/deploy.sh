#!/usr/bin/env sh
# Deploy: push into the working tree on the server (receive.denyCurrentBranch=updateInstead)
# and rebuild the stack. .env lives only on the server and never enters git.
set -eu

# Git remote and SSH host of the server: from the environment or from the untracked .deploy.env.
[ -f .deploy.env ] && . ./.deploy.env
REMOTE=${DEPLOY_REMOTE:?set DEPLOY_REMOTE (git remote of the server) in .deploy.env}
HOST=${DEPLOY_HOST:?set DEPLOY_HOST (ssh host of the server) in .deploy.env}
DIR=${DEPLOY_DIR:-server/sites/npm-monitor}

git push "$REMOTE" HEAD:main
ssh "$HOST" "cd $DIR && docker compose up -d --build --remove-orphans && docker compose ps"
