export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  AUTH_FAILURE: 2,
  NETWORK_ERROR: 3,
  CONFIG_ERROR: 4,
  USER_INTERRUPT: 130,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
