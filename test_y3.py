import httpx
import asyncio

async def main():
    async with httpx.AsyncClient() as client:
        try:
            r1 = await client.get("https://api.yalidine.app/v1/wilayas/")
            print("PROD .app/v1:", r1.status_code)
        except Exception as e:
            print("PROD .app/v1 ERROR:", e)
        try:
            r2 = await client.get("https://api.yalidine.com/v1/wilayas/")
            print("PROD .com/v1:", r2.status_code)
        except Exception as e:
            print("PROD .com/v1 ERROR:", e)

asyncio.run(main())
