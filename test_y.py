import httpx
import asyncio

async def main():
    async with httpx.AsyncClient(verify=False) as client:
        try:
            r1 = await client.get("https://dev.yalidine.app/api/v1/wilayas/")
            print("DEV /api/v1:", r1.status_code)
        except Exception as e:
            print("DEV /api/v1 ERROR:", e)
        try:
            r2 = await client.get("https://api.yalidine.app/v1/wilayas/")
            print("PROD /v1:", r2.status_code)
        except Exception as e:
            print("PROD /v1 ERROR:", e)

asyncio.run(main())
