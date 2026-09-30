#!/bin/sh
# 1. Fresh local network (terminal 1)
sui start --with-faucet --force-regenesis

# 2. Publish from the owner address (terminal 2)
sui client switch --env localnet
sui client active-address        # must be the owner
sui client faucet
cd move && rm -f Pub.localnet.toml
sui client test-publish --build-env testnet --publish-unpublished-deps --pubfile-path Pub.localnet.toml

# 3. Bootstrap, then the two pool scripts
cd ../examples/reference-backend
cp .env.localnet.example .env.localnet    # then fill in both private keys
pnpm provision:localnet >> .env.localnet
pnpm tsx --env-file=.env.localnet src/provision/create-mock-pool.ts    # add MOCK_POOL_ID=… to .env.localnet
pnpm tsx --env-file=.env.localnet src/provision/create-cetus-pool.ts   # add CETUS_POOL_ID=… to .env.localnet

# 4. API against localnet (copy the IDs into packages/api/.env.localnet first)
cd ../../packages/api
pnpm db:migrate:localnet
pnpm dev:localnet

# 5. Scenarios
cd ../../examples/reference-backend
pnpm run:localnet transfer
