#!/bin/sh
# ci-browser.sh: install Chromium for Playwright on a GitHub runner. Every workflow that drives a browser calls it from e2e/.
# --with-deps needs apt and the Ubuntu mirrors. On 11 Nov 2026 the runners could not resolve them on 24.04 or 26.04
# ("Temporary failure resolving 'azure.archive.ubuntu.com'"), so every walk and the proof went red with no code fault,
# and apt's own retries ran past the walk job's 25-minute limit before any fallback could start.
# So: look the mirrors up first (seconds). Reachable: one install with the system packages. Not reachable, or that install
# fails: the browser alone, from Playwright's own download host, on the libraries the hosted image already carries.
set -u
mirrors_resolve() {
  for h in archive.ubuntu.com security.ubuntu.com; do getent hosts "$h" >/dev/null 2>&1 || return 1; done
  return 0
}
if mirrors_resolve; then
  timeout 600 sh -c 'sudo apt-get -o Acquire::Retries=2 update -qq && npx playwright install --with-deps chromium' && exit 0
  echo "browser install with system packages failed"
else
  echo "the Ubuntu mirrors do not resolve on this runner"
fi
echo "installing the browser alone and using the image's own libraries"
npx playwright install chromium
