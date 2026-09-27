#!/bin/sh
set -eu

SETUP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$SETUP_DIR/.library-setup" "$@"
