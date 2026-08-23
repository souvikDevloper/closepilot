# ClosePilot public envelope

This directory is a zero-build Vercel reverse-proxy project for the public
ClosePilot evaluator deployment. Set this directory as the Vercel project's
root directory.

The wildcard rewrite preserves the visible Vercel hostname while forwarding
the application, static assets, health check, OpenAPI document and evaluation
API to the production origin. Vercel external rewrites are not cached by
default, so reconciliation responses remain dynamic.
