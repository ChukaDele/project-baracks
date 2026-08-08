#!/usr/bin/env python3
import argparse
import asyncio

from google.antigravity import Agent, LocalAgentConfig


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    args = parser.parse_args()

    config = LocalAgentConfig()
    async with Agent(config) as agent:
        response = await agent.chat(args.prompt)
        print(await response.text())


if __name__ == "__main__":
    asyncio.run(main())
