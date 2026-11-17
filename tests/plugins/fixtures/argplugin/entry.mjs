import process from 'node:process';

export const handlers = {
  // Never-resolving async handler — simulates a hung plugin.
  hang: () => new Promise(() => {}),
  echo: async (ctx, opts, positional) => {
    process.stdout.write(
      JSON.stringify({
        ctxKeys: Object.keys(ctx),
        configKeys: Object.keys(ctx?.config ?? {}),
        optsType: typeof opts,
        optsCtor: opts?.constructor?.name ?? null,
        opts,
        positional,
        positionalTypes: positional.map((p) => p?.constructor?.name ?? typeof p),
      }),
    );
  },
};
