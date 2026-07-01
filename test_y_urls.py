import httpx
import asyncio

async def main():
    async with httpx.AsyncClient(verify=False) as client:
        try:
            r1 = await client.get("https://api.yalidine.app/v1/wilayas/", headers={"X-API-ID": "fake", "X-API-TOKEN": "fake"})
            print("V1:", r1.status_code)
        except Exception as e:
            print("V1 Error", e)
        try:
            r2 = await client.get("https://api.yalidine.app/api/v1/wilayas/", headers={"X-API-ID": "fake", "X-API-TOKEN": "fake"})
            print("API V1:", r2.status_code)
        except Exception as e:
            print("API V1 Error", e)

asyncio.run(main())
