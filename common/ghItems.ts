/** Collapsed statusCheckRollup: any failure wins, else any unfinished check → pending. */
export type CiState = "passing" | "failing" | "pending" | "none";
