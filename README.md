# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hertzhzzz/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hertzhzzz/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: pre-token protocols ranked by implied value. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

The radar-2 model calibrates each category's value multiple from the live protocols in the same snapshot (median market-cap-to-TVL, shrunk toward the global median), then scores every pre-token protocol from its TVL, seven-day growth and age with no token. The board covers all 40 watchlist protocols plus every rankable pre-token protocol below the floor, each with a concrete seven-step farm plan.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=trpdktbz&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
