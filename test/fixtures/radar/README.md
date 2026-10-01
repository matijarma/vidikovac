# The DHMZ radar composite (R3)

`kompozit-20261001T020410Z.png` is https://vrijeme.hr/kompozit-stat.png as served, byte for byte, fetched once on 1 Oct 2026 at 02:07:21 UTC with the product's User-Agent (`Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)`, `worker/feed/http.ts`).

| Field | Value |
|---|---|
| HTTP status | 200, `Content-Type: image/png` |
| `Last-Modified` | `Thu, 01 Oct 2026 02:04:10 GMT` (the file name's stamp) |
| `ETag` | `"6abdbf9a-5d0da"` |
| Bytes | 381,146 |
| sha256 | `925e4c28d77d10062fa0103294b8841c528f8e10295f37267995bb2ea5cb9324` |
| Image | 720 × 751, 8-bit RGB, non-interlaced |

The image is dry around Zagreb (0 rain pixels in the near square and in the 120-pixel inset). No rainy composite was fetched: the rainy cases of `test/feed/dhmz-radar.test.ts` paint pixels of a scale colour (`00c6c6`) into a decoded copy and re-encode it in the test; nothing rainy is saved here. robots.txt answers 404 on vrijeme.hr; DHMZ's terms (NN 66/19, art. 17) allow reuse with "Izvor: DHMZ".

`worker/data/radar-calibration.json` was derived from this image with `node scripts/radar-calibrate.mjs --image test/fixtures/radar/kompozit-20261001T020410Z.png`.
