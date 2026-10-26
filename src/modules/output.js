export function successEnvelope(data, meta = {}) {
  return {
    ok: true,
    data,
    meta: withDefaults(meta)
  };
}

export function errorEnvelope(error, meta = {}) {
  return {
    ok: false,
    error: toErrorShape(error),
    meta: withDefaults(meta)
  };
}

export function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function toErrorShape(error) {
  return {
    code: error?.code ?? 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
    ...(error?.hint ? { hint: error.hint } : {}),
    ...(error?.details ? { details: error.details } : {})
  };
}

function withDefaults(meta) {
  return {
    cli: 'stdu-cli',
    backend: process.env.STDU_BROWSER_BACKEND === 'mock' ? 'mock' : 'playwright',
    ...meta
  };
}
