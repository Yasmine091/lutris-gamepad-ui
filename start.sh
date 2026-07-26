#!/usr/bin/env bash

set -xe

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

pushd "$SCRIPT_DIR"
npm run start:prod
popd
