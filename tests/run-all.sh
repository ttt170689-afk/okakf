#!/usr/bin/env bash
# Прогон всех автотестов проекта. Запуск: bash tests/run-all.sh
cd "$(dirname "$0")/.."
fail=0
echo "=== СИНТАКСИС ==="
for f in src/*.js; do node --check "$f" || { echo "FAIL $f"; fail=1; }; done
echo "  все src/*.js разобраны"
for t in physics-v2 bodies-v3 boot world species shader save-compat; do
  echo; echo "=== $t ==="
  node "tests/$t.test.js" 2>&1 | grep -v "deprecated" || fail=1
done
echo; echo "=== ПРОИЗВОДИТЕЛЬНОСТЬ ==="
node tests/perf.bench.js 2>&1 | grep -v "deprecated"
exit $fail
