/*
 * electron-builder afterPack hook, for the Linux AppImage only (MAPLE_APPIMAGE=1, see the
 * "dist:linux" script).
 *
 * Ubuntu 24.04 and newer don't let apps that aren't installed use Chromium's sandbox, so an
 * AppImage would not start. Here the program is renamed maple-iptv-bin, and a small maple-iptv
 * script starts it with --no-sandbox when it runs from an AppImage.
 *
 * The .deb is built separately without this: when it is installed, it sets the sandbox up
 * (an AppArmor profile for /opt/Maple IPTV/maple-iptv).
 */
'use strict';
const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'linux' || process.env.MAPLE_APPIMAGE !== '1') return;
  const name = context.packager.executableName;
  const program = path.join(context.appOutDir, name);
  fs.renameSync(program, program + '-bin');
  fs.writeFileSync(program, [
    '#!/bin/sh',
    'HERE="$(dirname "$(readlink -f "$0")")"',
    'if [ -n "$APPIMAGE" ]; then exec "$HERE/' + name + '-bin" --no-sandbox "$@"; fi',
    'exec "$HERE/' + name + '-bin" "$@"',
    '',
  ].join('\n'), { mode: 0o755 });
};
