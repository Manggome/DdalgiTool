#!/bin/zsh
# 딸기툴 릴리스 자동화: 버전 태그 + dmg/exe 빌드 + GitHub 릴리스 업로드
# 사용: ./build/release.sh  (package.json 의 현재 버전 기준)
set -e
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
echo "▶ 딸기툴 v$VER 릴리스"
rm -rf dist-app
npm run dist:mac
npm run dist:win
git tag -f "v$VER" && git push -f origin "v$VER"
gh release create "v$VER" \
  "dist-app/Ddalgi-$VER-arm64.dmg" \
  "dist-app/Ddalgi-$VER-x64-setup.exe" \
  --title "딸기툴 $VER" \
  --notes "패치노트는 앱 사이드바의 버전을 눌러 확인하세요." \
  --latest
echo "✅ 완료 — 팀원 앱이 12시간 내 자동 감지합니다"
