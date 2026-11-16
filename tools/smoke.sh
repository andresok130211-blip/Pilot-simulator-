#!/bin/bash
# Автопроверка: прогоняет сценарии Godot на ПК, собирает ошибки и скриншоты.
# Запуск: tools/smoke.sh [папка_отчёта]
OUT=${1:-/tmp/smoke}; mkdir -p "$OUT"; cd "$(dirname "$0")/../godot"
G=${GODOT:-/home/claude/godot/Godot_v4.3-stable_linux.x86_64}
fail=0; : > "$OUT/report.txt"
run() { # имя, флаги...
  n=$1; shift
  timeout 110 xvfb-run -a -s "-screen 0 1600x900x24" $G --path . --rendering-driver opengl3 --resolution 1280x640 -- --auto "$@" --wait=6 --shot="$OUT/$n.png" > "$OUT/$n.log" 2>&1
  e=$(grep -c "SCRIPT ERROR\|Parse Error\|Failed to load\|Cannot open" "$OUT/$n.log")
  ok=$([ -s "$OUT/$n.png" ] && echo 1 || echo 0)
  if [ "$e" != 0 ] || [ "$ok" != 1 ]; then echo "FAIL $n (ошибок: $e, скрин: $ok)" >> "$OUT/report.txt"; fail=1; else echo "ok   $n" >> "$OUT/report.txt"; fi
}
for p in a320 b737 b789 a350 a380; do
  run fly_$p --plane=$p
  run cockpit_$p --plane=$p --cam=1
  run view_$p --view=$p
done
run walk --screen=walk
for c in 0 2 3 4 5 6 7; do run cam$c --cam=$c; done
cat "$OUT/report.txt"; exit $fail
