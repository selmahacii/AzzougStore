import httpx
import asyncio

async def test_url(url):
    async with httpx.AsyncClient(verify=False) as client:
        try:
            r = await client.get(url, headers={'X-API-ID': 'test', 'X-API-TOKEN': 'test'})
            print(f"{url} -> {r.status_code}")
        except Exception as e:
            print(f"{url} -> Error: {e}")

async def main():
    await test_url("https://api.yalidine.app/v1/wilayas/")
    await test_url("https://api.yalidine.app/api/v1/wilayas/")
    await test_url("https://dev.yalidine.app/v1/wilayas/")
    await test_url("https://dev.yalidine.app/api/v1/wilayas/")

asyncio.run(main())
