#!/bin/bash
# Get the directory where this script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Run the AppImage with --no-sandbox
"$DIR/Printventory-0.8.0.AppImage" --no-sandbox "$@" 