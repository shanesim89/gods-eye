export type TelegramDeliverySummary = {
  ran: boolean;
  users: number;
  generated: number;
  skipped: number;
  attempted: number;
  sent: number;
  failed: number;
};

type DigestUser = { user_id: string };

export async function deliverPortfolioDigests(
  users: DigestUser[],
  buildDigest: (userId: string) => Promise<string>,
  send: (message: string) => Promise<boolean>,
): Promise<TelegramDeliverySummary> {
  const summary: TelegramDeliverySummary = {
    ran: true,
    users: users.length,
    generated: 0,
    skipped: 0,
    attempted: 0,
    sent: 0,
    failed: 0,
  };

  for (const { user_id } of users) {
    let message: string | null;
    try {
      message = await buildDigest(user_id);
    } catch (err) {
      console.error(
        `[portfolio-digest] ${user_id} generation failed:`,
        err instanceof Error ? err.message : err,
      );
      summary.skipped += 1;
      summary.failed += 1;
      continue;
    }

    if (!message) {
      summary.skipped += 1;
      continue;
    }

    summary.generated += 1;
    summary.attempted += 1;
    try {
      if (await send(message)) summary.sent += 1;
      else summary.failed += 1;
    } catch (err) {
      console.error(
        `[portfolio-digest] ${user_id} send failed:`,
        err instanceof Error ? err.message : err,
      );
      summary.failed += 1;
    }
  }

  summary.ran = summary.failed === 0;
  return summary;
}
