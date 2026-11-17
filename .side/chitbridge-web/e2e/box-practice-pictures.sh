#!/bin/sh
# box-practice-pictures.sh - REP-66: run e2e/box-practice-pictures.cjs ON sit-grund against a throwaway web container (rep66-web on 127.0.0.1:3997, this checkout's public/ mounted) and the seede api.
# The OTP is read on the box from ~/seede/env.run, never written to a file here. Usage (laptop): scp this checkout's public/ to ~/rep66/public, docker run the web (see the PR), then: sh box-practice-pictures.sh
mkdir -p ~/rep66/out; rm -f ~/rep66/out/walk66.log
CODE=$(grep '^TESTER_CODE=' ~/seede/env.run | cut -d= -f2-)
DAY=$(date +%y%m%d); CODE=$(echo "$CODE" | sed "s/{yymmdd}/$DAY/; s/{yyyymmdd}/20$DAY/")
docker run --rm --network host --ipc=host -e CODE="$CODE" -e NODE_PATH=/pw/node_modules -v ~/qa-sit/pw-1.47.2/node_modules:/pw/node_modules:ro -v ~/rep66:/w:ro -v ~/rep66/out:/out mcr.microsoft.com/playwright:v1.47.2-jammy node /w/walk66.cjs > ~/rep66/out/run.out 2>&1
echo exit=$? >> ~/rep66/out/run.out
