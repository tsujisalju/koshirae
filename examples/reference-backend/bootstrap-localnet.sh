#!/bin/sh
# 1. Fresh local network (terminal 1)
sui start --with-faucet --force-regenesis

# 2. Create .env.localnet
cd ../examples/reference-backend
cp .env.localnet.example .env.localnet
# then fill OWNER_PRIVATE_KEY and OPERATOR_PRIVATE_KEY

# 3. run bootstrap command
pnpm localnet:up
