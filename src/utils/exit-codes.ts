export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  AUTH_FAILURE: 2,
  NETWORK_ERROR: 3,
  INVALID_ARGUMENT: 4,
  TASK_NOT_COMPLETED: 8,
  USER_INTERRUPT: 130,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
