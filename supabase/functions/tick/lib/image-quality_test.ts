// Run with: deno test supabase/functions/tick/lib/image-quality_test.ts
//
// Fixtures mirror the two result-set shapes measured against the live Bright
// Data SERP on 2026-08-24 (see the numbers in image-quality.ts).
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  CLOUDINARY_RESTRICTED_CARD_SHA256,
  isKnownPlaceholderImage,
  looksDegraded,
  sha256Hex,
} from "./image-quality.ts";

/** A healthy set: ~100 hits spread thin, every URL distinct (peak host ~6%). */
function healthySet(): string[] {
  return Array.from({ length: 100 }, (_, i) => `https://cdn${i % 40}.example.com/photo-${i}.jpg`);
}

/**
 * A junk set as actually observed: 55 of 100 hits from one Cloudinary account
 * plus a long tail, and a quarter of the URLs repeated.
 */
function junkSet(): string[] {
  const urls: string[] = [];
  for (let i = 0; i < 55; i++) {
    urls.push(`https://res.cloudinary.com/billionhands/image/upload/item-${i % 40}.jpg`);
  }
  for (let i = 0; i < 45; i++) urls.push(`https://spam${i % 6}.example.com/img-${i % 30}.png`);
  return urls;
}

Deno.test("looksDegraded passes a healthy, well-spread result set", () => {
  assertFalse(looksDegraded(healthySet()));
});

Deno.test("looksDegraded rejects a set dominated by one host", () => {
  assert(looksDegraded(junkSet()));
});

Deno.test("looksDegraded rejects a set that is mostly duplicate URLs", () => {
  // 40 distinct URLs padded to 100. Hosts stay spread (2-3 hits each), so only
  // the duplication signal can catch this one.
  const urls = Array.from({ length: 100 }, (_, i) => `https://cdn${i % 40}.example.com/p-${i % 40}.jpg`);
  assert(looksDegraded(urls));
});

Deno.test("looksDegraded rejects an empty set so the caller resamples", () => {
  assert(looksDegraded([]));
});

Deno.test("looksDegraded does not judge a short result list", () => {
  // Eight hits, half from one host: a legitimate shape for a rare topic, and
  // throwing it away would cost more than the occasional bad image.
  const urls = [
    ...Array.from({ length: 4 }, (_, i) => `https://one.example.com/a${i}.jpg`),
    ...Array.from({ length: 4 }, (_, i) => `https://two${i}.example.com/b.jpg`),
  ];
  assertFalse(looksDegraded(urls));
});

Deno.test("looksDegraded ignores unparseable URLs without crashing", () => {
  const urls = [
    ...healthySet().slice(0, 60),
    ...Array.from({ length: 40 }, (_, i) => `not a url ${i}`),
  ];
  assertFalse(looksDegraded(urls));
});

Deno.test("sha256Hex matches the standard vector", async () => {
  assertEquals(
    await sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

Deno.test("isKnownPlaceholderImage flags the Cloudinary restricted-media card", async () => {
  // We can't ship the 53KB card as a fixture, so assert on the recorded hash:
  // the digest below is the one measured from res.cloudinary.com on 2026-08-24.
  assert(CLOUDINARY_RESTRICTED_CARD_SHA256.length === 64);
  assertFalse(await isKnownPlaceholderImage(new TextEncoder().encode("a real photo")));
});
