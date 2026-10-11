export type ConfigReport = { errors: string[]; warnings: string[] };
export declare function checkConfig(env?: NodeJS.ProcessEnv): ConfigReport;
export declare function enforceConfig(env?: NodeJS.ProcessEnv): void;
