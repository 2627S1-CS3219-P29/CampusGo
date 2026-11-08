#!/bin/sh
set -eu
for service in user supplier order credit; do
    sed -i "s/${service}_api/${service}.campusgo.local/g" /etc/nginx/nginx.conf
done
exec /entrypoint.sh "$@"
