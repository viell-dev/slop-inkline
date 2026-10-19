#!/bin/sh
# Runs the end-to-end suite on Linux. Without a display, it starts Xvfb as a
# virtual X server and herbstluftwm as the window manager, which Obsidian needs
# for focus and window events. CI and the Docker image both run this script;
# arguments go to `wdio run`.
set -eu

if [ -z "${DISPLAY:-}" ]; then
  export DISPLAY=:99
  Xvfb "$DISPLAY" -screen 0 1600x1000x24 -nolisten tcp -noreset \
    >/tmp/inkline-xvfb.log 2>&1 &
  tries=0
  until xset q >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -gt 40 ]; then
      echo "Xvfb did not start:" >&2
      cat /tmp/inkline-xvfb.log >&2
      exit 1
    fi
    sleep 0.25
  done
  herbstluftwm >/tmp/inkline-wm.log 2>&1 &
fi

exec npx wdio run test/e2e/wdio.conf.mts "$@"
