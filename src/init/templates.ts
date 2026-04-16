// src/init/templates.ts
//
// Static YAML template strings for `xci init` scaffold files.

export const CONFIG_YML = `\
# .xci/config.yml
# Project-level parameters. Safe to commit.
# These values are available as \${PARAM_NAME} in commands.yml.
#
# Example:
# registry: https://my-registry.example.com
# app_name: my-app
`;

export const COMMANDS_YML = `\
# .xci/commands.yml
# Define command aliases for this project.

hello:
  description: Say hello — run with \`xci hello\`
  cmd: ["node", "-e", "console.log('hello from xci')"]

# Sequential: runs steps in order, stops at first failure
# check-and-build:
#   description: Typecheck then build
#   steps:
#     - ["npx", "tsc", "--noEmit"]
#     - ["npx", "tsup"]

# Parallel: runs members concurrently, kills others on first failure
# lint-all:
#   description: Run all linters in parallel
#   group:
#     - ["npx", "biome", "check", "."]
#     - ["npx", "tsc", "--noEmit"]
#   failMode: fast
`;

export const SECRETS_EXAMPLE_YML = `\
# .xci/secrets.yml.example
# Copy this file to secrets.yml and fill in real values.
# secrets.yml is gitignored and never committed.
#
# api_token: your-token-here
`;

export const LOCAL_EXAMPLE_YML = `\
# .xci/local.yml.example
# Copy this file to local.yml for per-machine overrides.
# local.yml is gitignored and never committed.
#
# registry: http://localhost:5000
`;
