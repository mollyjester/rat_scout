#!/usr/bin/env bash
# test/run-all.sh — Run all JS unit tests and report a combined pass/fail.
#
# Usage: bash test/run-all.sh  (or npm test)
#
# Each test/*.test.js file is executed with `node`. The runner collects the
# exit codes and prints a final summary. Exits 0 only when all tests pass.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

passed_files=0
failed_files=0
failed_names=()

echo "=== Running all test files ==="
echo

for test_file in "${SCRIPT_DIR}"/*.test.js; do
    name="$(basename "${test_file}")"
    if node "${test_file}"; then
        passed_files=$((passed_files + 1))
    else
        failed_files=$((failed_files + 1))
        failed_names+=("${name}")
    fi
    echo
done

echo "=== Summary ==="
echo "  Passed: ${passed_files}"
echo "  Failed: ${failed_files}"

if [[ ${failed_files} -gt 0 ]]; then
    echo
    echo "Failed test files:"
    for name in "${failed_names[@]}"; do
        echo "  - ${name}"
    done
    exit 1
fi

exit 0
