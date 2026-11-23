#!/usr/bin/env bash
set -euo pipefail

task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$task_root"

if [[ ! -f .env.local || ! -f .lab/java-cacerts ]]; then
    echo "缺少 lab 环境配置或 Java CA 信任库，请先按 docs/idone-integration.md 配置。" >&2
    exit 1
fi

docker compose --env-file .env.local -f compose.local.yaml -f compose.lab.yaml up -d --build
