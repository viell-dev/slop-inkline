#!/bin/sh
# Runs the end-to-end suite on Linux. Without a display, it starts Xvfb as a
# virtual X server and herbstluftwm as the window manager, which Obsidian needs
# for focus and window events. CI and the Docker image both run this script;
# arguments go to `wdio run`.
set -eu

# Each Obsidian version gets a display of its own, as test/e2e/wdio.conf.mts
# picks: on a shared display, the window manager tiles the windows, and every
# window that opens resizes the others in the middle of their tests.
if [ -z "${DISPLAY:-}" ]; then
  INKLINE_E2E_DISPLAYS=""
  for number in 99 100 101 102; do
    display=":$number"
    Xvfb "$display" -screen 0 1600x1000x24 -nolisten tcp -noreset \
      >"/tmp/inkline-xvfb-$number.log" 2>&1 &
    tries=0
    until DISPLAY="$display" xset q >/dev/null 2>&1; do
      tries=$((tries + 1))
      if [ "$tries" -gt 40 ]; then
        echo "Xvfb did not start on $display:" >&2
        cat "/tmp/inkline-xvfb-$number.log" >&2
        exit 1
      fi
      sleep 0.25
    done
    DISPLAY="$display" herbstluftwm >"/tmp/inkline-wm-$number.log" 2>&1 &
    INKLINE_E2E_DISPLAYS="$INKLINE_E2E_DISPLAYS $display"
  done
  export DISPLAY=:99
  export INKLINE_E2E_DISPLAYS
fi

exec npx wdio run test/e2e/wdio.conf.mts "$@"
