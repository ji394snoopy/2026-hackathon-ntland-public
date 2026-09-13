import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  computeBackoffDelayMs,
  isRetryableClaudeError,
  BASE_DELAY_MS,
} from "../../src/shared/retry.js";

test("computeBackoffDelayMs: doubles the base delay each attempt", () => {
  assert.equal(computeBackoffDelayMs(0), BASE_DELAY_MS);
  assert.equal(computeBackoffDelayMs(1), BASE_DELAY_MS * 2);
  assert.equal(computeBackoffDelayMs(2), BASE_DELAY_MS * 4);
});

test("isRetryableClaudeError: true for a connection error", () => {
  assert.equal(isRetryableClaudeError(new Anthropic.APIConnectionError({})), true);
});

test("isRetryableClaudeError: true for a connection timeout error", () => {
  assert.equal(isRetryableClaudeError(new Anthropic.APIConnectionTimeoutError()), true);
});

test("isRetryableClaudeError: true for a 429 API error", () => {
  const err = new Anthropic.APIError(429, {}, "rate limited", new Headers());
  assert.equal(isRetryableClaudeError(err), true);
});

test("isRetryableClaudeError: true for a 500 API error", () => {
  const err = new Anthropic.APIError(500, {}, "internal error", new Headers());
  assert.equal(isRetryableClaudeError(err), true);
});

test("isRetryableClaudeError: false for a 400 API error", () => {
  const err = new Anthropic.APIError(400, {}, "bad request", new Headers());
  assert.equal(isRetryableClaudeError(err), false);
});

test("isRetryableClaudeError: false for a plain non-Anthropic error", () => {
  assert.equal(isRetryableClaudeError(new Error("boom")), false);
});
