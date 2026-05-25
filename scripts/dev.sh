#!/bin/bash
# Wrapper to ensure Node 22 (via nvm) is used.
export PATH=/Users/maverick/.nvm/versions/node/v22.14.0/bin:$PATH
exec npm run dev
