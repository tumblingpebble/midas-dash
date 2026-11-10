#!/bin/sh
# Trusted owner-operated startup only; never a public signup endpoint.
set -eu
LC_ALL=C
export LC_ALL
host=${MIDAS_PRIVATE_HOST-}
case "$host" in
    *[!a-z0-9.-]*|"")
        echo 'MIDAS_PRIVATE_HOST must be a lowercase DNS hostname without scheme, port or path' >&2
        exit 78
        ;;
esac
if [ "${#host}" -gt 253 ] || ! printf '%s\n' "$host" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'; then
    echo 'MIDAS_PRIVATE_HOST must be a lowercase DNS hostname without scheme, port or path' >&2
    exit 78
fi
if [ ! -f /run/midas-auth/users.caddy ] || [ ! -r /run/midas-auth/users.caddy ]; then
    echo 'A readable owner-controlled users.caddy file is required' >&2
    exit 78
fi
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
