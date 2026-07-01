import httpx
import asyncio

async def main():
    async with httpx.AsyncClient(verify=False) as client:
        try:
            r3 = await client.get("https://api.yalidine.app/api/v1/wilayas/")
            print("PROD /api/v1:", r3.status_code)
        except Exception as e:
            print("PROD /api/v1 ERROR:", e)

asyncio.run(main())
