#!/usr/bin/env python3
import argparse
import asyncio

from google.antigravity import Agent, LocalAgentConfig
from google.antigravity.hooks.policy import allow


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    args = parser.parse_args()

    # Major owns the project/worktree boundary and owner-only action policy.
    # Allow Antigravity's built-in project tools so this worker can actually
    # implement and test bounded delegated work without interactive prompts.
    config = LocalAgentConfig(policies=[allow("*")])
    async with Agent(config) as agent:
        response = await agent.chat(args.prompt)
        print(await response.text())


if __name__ == "__main__":
    asyncio.run(main())
