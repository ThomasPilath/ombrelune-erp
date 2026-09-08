#!/bin/sh
set -eu

envsubst '${VITE_SUPABASE_URL} ${VITE_SUPABASE_PUBLISHABLE_KEY}' \
  < /etc/ombrelune/config.js.template \
  > /usr/share/nginx/html/config.js
