const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function testEndpoints() {
  try {
    // 1. Get stores list to find store ID
    const storeRes = await get("http://localhost:8003/api/v1/stores");
    const stores = JSON.parse(storeRes.body);
    const storeId = stores[0]?.id || stores.data?.[0]?.id;
    console.log(`Using Store ID: ${storeId}`);

    // 2. Fetch delivery partners with empty productIds
    const url = `http://localhost:8003/api/v1/delivery-partners/availability?storeId=${storeId}&productIds=`;
    console.log(`Fetching delivery partners with empty productIds from: ${url}`);
    const partnerRes = await get(url);
    console.log(`FastAPI response status: ${partnerRes.status}`);
    console.log(`FastAPI response body: ${partnerRes.body}`);
  } catch (err) {
    console.error("Error in query script:", err);
  }
}

testEndpoints();
