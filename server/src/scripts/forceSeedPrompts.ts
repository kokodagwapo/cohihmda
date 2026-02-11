/**
 * One-off script: Force re-seed all default AI prompts (upsert).
 * Run with: npx tsx server/src/scripts/forceSeedPrompts.ts
 */
import { pool as managementPool } from "../config/managementDatabase.js";
import { DEFAULT_PROMPT_CONFIGS } from "../config/defaultPromptConfigs.js";

async function main() {
  console.log(
    `Force-seeding ${DEFAULT_PROMPT_CONFIGS.length} default prompts...`
  );

  const client = await managementPool.connect();
  let upserted = 0;

  try {
    await client.query("BEGIN");

    for (const prompt of DEFAULT_PROMPT_CONFIGS) {
      await client.query(
        `
        INSERT INTO ai_prompt_configs (
          id, name, description, category,
          system_prompt, user_prompt_template,
          model, temperature, max_tokens, json_mode,
          available_variables,
          default_system_prompt, default_user_prompt_template,
          default_model, default_temperature, default_max_tokens,
          is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $5, $6, $7, $8, $9, true)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          system_prompt = EXCLUDED.system_prompt,
          model = EXCLUDED.model,
          temperature = EXCLUDED.temperature,
          max_tokens = EXCLUDED.max_tokens,
          json_mode = EXCLUDED.json_mode,
          available_variables = EXCLUDED.available_variables,
          default_system_prompt = EXCLUDED.default_system_prompt,
          default_model = EXCLUDED.default_model,
          default_temperature = EXCLUDED.default_temperature,
          default_max_tokens = EXCLUDED.default_max_tokens,
          updated_at = NOW()
        `,
        [
          prompt.id,
          prompt.name,
          prompt.description,
          prompt.category,
          prompt.system_prompt,
          prompt.user_prompt_template || null,
          prompt.model,
          prompt.temperature,
          prompt.max_tokens,
          prompt.json_mode,
          JSON.stringify(prompt.available_variables),
        ]
      );
      console.log(`  ✓ ${prompt.id}`);
      upserted++;
    }

    await client.query("COMMIT");
    console.log(`\nDone — ${upserted} prompts force-seeded.`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error:", error);
    process.exit(1);
  } finally {
    client.release();
    await managementPool.end();
  }
}

main();
