#!/bin/sh
set -eu
umask 077
mkdir -p /run/clamav /tmp/clamav /var/lib/clamav
chown clamav:clamav /run/clamav /tmp/clamav /var/lib/clamav
# Initialize/verify official signatures before accepting any stream.
freshclam --config-file=/etc/clamav/freshclam.conf --quiet
freshclam --config-file=/etc/clamav/freshclam.conf --daemon --foreground &
exec clamd --config-file=/etc/clamav/clamd.conf --foreground
