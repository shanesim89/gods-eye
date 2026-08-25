import { describe, expect, it, vi } from "vitest";
import { deliverPortfolioDigests } from "./telegram-delivery";

const users = [{ user_id: "one" }, { user_id: "two" }, { user_id: "three" }];

describe("Telegram portfolio delivery accounting", () => {
  it("counts successful sends without contacting Telegram", async () => {
    const build = vi.fn(async (userId: string) => `digest:${userId}`);
    const send = vi.fn(async () => true);

    await expect(deliverPortfolioDigests(users, build, send)).resolves.toEqual({
      ran: true,
      users: 3,
      generated: 3,
      skipped: 0,
      attempted: 3,
      sent: 3,
      failed: 0,
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("reports false and thrown send outcomes honestly", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("network failure"));

    await expect(deliverPortfolioDigests(
      users,
      async (userId) => `digest:${userId}`,
      send,
    )).resolves.toEqual({
      ran: false,
      users: 3,
      generated: 3,
      skipped: 0,
      attempted: 3,
      sent: 1,
      failed: 2,
    });
  });

  it("reports digest generation failures instead of silently succeeding", async () => {
    const build = vi.fn(async (userId: string) => {
      if (userId !== "three") throw new Error("database unavailable");
      return "digest:three";
    });
    const send = vi.fn(async () => true);

    await expect(deliverPortfolioDigests(users, build, send)).resolves.toEqual({
      ran: false,
      users: 3,
      generated: 1,
      skipped: 2,
      attempted: 1,
      sent: 1,
      failed: 2,
    });
    expect(send).toHaveBeenCalledOnce();
  });
});
