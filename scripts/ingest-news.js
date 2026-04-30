const dotenv = require("dotenv");
dotenv.config();

const ctx = require("../lib/context");
const { ingestNews } = require("../lib/news-ingest");

async function main() {
  if (!ctx.usePostgres) {
    throw new Error("DATABASE_URL is required for production news ingest. Refusing to use local JSON storage.");
  }

  const pool = await ctx.buildPgPool();
  ctx.setPgPool(pool);
  try {
    await ctx.initStorage();
    const result = await ingestNews(ctx, {
      daysBack: Number(process.env.NEWS_INGEST_DAYS_BACK || 14),
      maxRecords: Number(process.env.NEWS_INGEST_MAX_RECORDS || 25)
    });
    await ctx.storageAudit({
      action: "news.ingest.cli",
      actorId: "system",
      targetType: "news_items",
      targetId: "gdelt",
      metadata: result,
      ip: ""
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
