#!/bin/sh
set -eu

envsubst '${VITE_SUPABASE_URL} ${VITE_SUPABASE_PUBLISHABLE_KEY} ${VITE_UMAMI_SCRIPT_URL} ${VITE_UMAMI_WEBSITE_ID}' \
  < /etc/ombrelune/config.js.template \
  > /usr/share/nginx/html/config.js
