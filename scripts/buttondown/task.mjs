// Shared helpers for Buttondown mise task entrypoints.

export function optionalUsageEnv(name) {
  const value = process.env[`usage_${name}`];
  return value && value.length > 0 ? value : undefined;
}

export async function printJsonTask(callback) {
  try {
    const output = await callback();
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: ${message}`);
    process.exit(1);
  }
}
