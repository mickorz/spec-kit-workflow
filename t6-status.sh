#!/bin/bash
d=specs/lprd-manual-1
chunks=$(ls $d/intake/chunks/CHUNK-*.md 2>/dev/null | wc -l)
claims=$(ls $d/intake/claims/CHUNK-*.json 2>/dev/null | wc -l)
reviews=$(ls $d/intake/reviews/CHUNK-*.json 2>/dev/null | wc -l)
merge=$([ -f $d/intake/merge-report.json ] && echo 1 || echo 0)
sem=$([ -f $d/intake/semantic.json ] && echo 1 || echo 0)
spec=$([ -f $d/spec.md ] && echo 1 || echo 0)
smap=$([ -f $d/source-map.json ] && echo 1 || echo 0)
plan=$([ -f $d/plan.md ] && echo 1 || echo 0)
tasks=$([ -f $d/tasks.md ] && echo 1 || echo 0)
evid=$([ -f $d/evidence.json ] && echo 1 || echo 0)
rr=$([ -f $d/intake/run-report.json ] && echo 1 || echo 0)
echo "$(date +%H:%M:%S) chunks=$chunks claims=$claims/$chunks reviews=$reviews merge=$merge sem=$sem spec=$spec smap=$smap plan=$plan tasks=$tasks evid=$evid runreport=$rr"
